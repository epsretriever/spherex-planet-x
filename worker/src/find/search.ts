/**
 * The precovery search behind GET /api/find: every SPHEREx frame a solar-system body passed
 * through, from JPL's orbit for it.
 *
 *  1. JPL SBDB resolves the name to one object (orbit class, size and albedo if measured).
 *  2. JPL Horizons gives a daily geocentric ephemeris over the survey, with the solar
 *     elongation. SPHEREx points 82-126 deg from the Sun (the range of all our own
 *     detections), so only days in a padded version of that range are searched.
 *  3. IRSA TAP (spherex.obscore) lists exposures whose footprint centre lies in a padded box
 *     around the track on those days, in one query; each footprint (s_region) is then tested
 *     against the predicted position at the exposure midpoint.
 *  4. Horizons gives exact positions, as seen from SPHEREx itself, at the midpoints of the
 *     frames that matched; frames still inside their footprint are kept.
 *  5. Frames our own pipeline measured (objects JPL identified as this body) get our measured
 *     position, flux and S/N.
 */
import type { Deps, Env } from "../env";
import { ApiError, UpstreamError } from "../errors";
import type { InjectionStudy, InjectionStudyIndex } from "../contract";
import { readStaticJson } from "../static-data";
import { SCHEMA_VERSION, workerVersion } from "../version";
import { catalogMatches } from "./catalog";
import type { FindBrightness, FindFrame, FindObject, FindPrediction, FindResult, FindVisit } from "./contract";
import { type Polygon, inPolygon, interpolate, offsetArcsec, parsePolygon, unwrapRa } from "./geometry";
import { EXACT_CHUNK, type EphemRow, HORIZONS, dailyEphemeris, exactEphemeris, horizonsCommand } from "./horizons";
import { SBDB, sbdbLookup } from "./sbdb";
import { S3_NAME, level2Paths, segmentVersion } from "./s3";
import { type Box, IRSA_TAP, type ObscoreRow, queryObscore } from "./tap";
import { brightnessNote, summaryPlain, whyItMatters } from "./text";

/** A little before the first SPHEREx Level 2 image IRSA lists (MJD 60789.75, 2025-04-25). */
export const SURVEY_START_MJD = 60788;
/** Solar elongations searched: our detections span 82-126 deg; padded for safety. */
export const ELONG_MIN_DEG = 78;
export const ELONG_MAX_DEG = 130;
/** Footprint centre to corner of one SPHEREx detector (2040 x 6.15" pixels) is ~2.5 deg. */
export const FOOTPRINT_PAD_DEG = 2.7;
/** Largest track span (deg) and duration (days) covered by one search box. */
export const BOX_SPAN_DEG = 3;
export const BOX_DAYS = 12;
export const MAX_BOXES_PER_QUERY = 40;
export const MAX_TAP_QUERIES = 4;
export const MAX_FRAMES = 800;
export const MAX_EXACT_CHUNKS = 7;
/** Exposures this close in time belong to one visit. */
export const VISIT_GAP_DAYS = 30 / 1440;

const mjdToIso = (mjd: number) => new Date(Math.round((mjd - 40587) * 86400000)).toISOString();
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Group consecutive in-elongation days into search boxes (exported for tests). */
export function searchBoxes(rows: EphemRow[]): Box[] {
  const ok = rows.map((r) => r.elong_deg === null || (r.elong_deg >= ELONG_MIN_DEG && r.elong_deg <= ELONG_MAX_DEG));
  const boxes: Box[] = [];
  let i = 0;
  while (i < rows.length) {
    if (!ok[i]) {
      i++;
      continue;
    }
    let j = i;
    // Extend while the track stays compact.
    while (j + 1 < rows.length && ok[j + 1]) {
      const span = rows.slice(i, j + 2);
      const ras = unwrapRa(span.map((r) => r.ra_deg));
      const decs = span.map((r) => r.dec_deg);
      const cosd = Math.max(0.05, Math.cos((Math.max(...decs.map(Math.abs)) * Math.PI) / 180));
      const raSpan = (Math.max(...ras) - Math.min(...ras)) * cosd;
      const decSpan = Math.max(...decs) - Math.min(...decs);
      if (Math.max(raSpan, decSpan) > BOX_SPAN_DEG || rows[j + 1]!.mjd - rows[i]!.mjd > BOX_DAYS) break;
      j++;
    }
    // The box covers half a day either side, so include the neighbouring samples' positions.
    const lo = Math.max(0, i - 1);
    const hi = Math.min(rows.length - 1, j + 1);
    const span = rows.slice(lo, hi + 1);
    const ras = unwrapRa(span.map((r) => r.ra_deg));
    const decs = span.map((r) => r.dec_deg);
    const dec0 = Math.min(...decs) - FOOTPRINT_PAD_DEG;
    const dec1 = Math.max(...decs) + FOOTPRINT_PAD_DEG;
    const maxAbs = Math.max(Math.abs(dec0), Math.abs(dec1));
    let ra0: number | null = null;
    let ra1: number | null = null;
    if (maxAbs < 85) {
      const pad = FOOTPRINT_PAD_DEG / Math.cos((maxAbs * Math.PI) / 180);
      const a = Math.min(...ras) - pad;
      const b = Math.max(...ras) + pad;
      if (b - a < 360) {
        ra0 = ((a % 360) + 360) % 360;
        ra1 = ((b % 360) + 360) % 360;
      }
    }
    boxes.push({
      mjd0: rows[i]!.mjd - 0.5,
      mjd1: rows[j]!.mjd + 0.5,
      dec0: Math.max(-90, dec0),
      dec1: Math.min(90, dec1),
      ra0,
      ra1,
    });
    i = j + 1;
  }
  return boxes;
}

interface Hit {
  row: ObscoreRow;
  mid: number;
  poly: Polygon;
  detector: number;
  release: string;
  segment: string;
  predicted: FindPrediction;
}

function nearestDaily(rows: EphemRow[], mjd: number): EphemRow | null {
  let best: EphemRow | null = null;
  for (const r of rows) if (!best || Math.abs(r.mjd - mjd) < Math.abs(best.mjd - mjd)) best = r;
  return best;
}

/** Footprint test against the interpolated daily ephemeris (exported for tests). */
export function matchRows(rows: ObscoreRow[], daily: EphemRow[]): Hit[] {
  const byFrame = new Map<string, Hit>();
  for (const row of rows) {
    if (!row.detector) continue;
    const mid = (row.t_min + row.t_max) / 2;
    const p = interpolate(daily, mid);
    if (!p) continue;
    const poly = parsePolygon(row.s_region, [row.s_ra, row.s_dec]);
    if (!poly || !inPolygon(p.ra_deg, p.dec_deg, poly)) continue;
    const near = nearestDaily(daily, mid);
    const hit: Hit = {
      row,
      mid,
      poly,
      detector: row.detector,
      release: row.release ?? "qr2",
      segment: row.obs_id.slice(0, 10),
      predicted: {
        ra_deg: round(p.ra_deg, 6),
        dec_deg: round(p.dec_deg, 6),
        ra_3sigma_arcsec: near?.ra_3sigma_arcsec ?? null,
        dec_3sigma_arcsec: near?.dec_3sigma_arcsec ?? null,
        vmag: near?.vmag ?? null,
        delta_au: near?.delta_au ?? null,
        method: "interpolated_daily",
        observer: "geocenter",
      },
    };
    const key = `${row.obs_id}D${row.detector}`;
    const prev = byFrame.get(key);
    // The same exposure in two releases: keep the newer release.
    if (!prev || hit.release > prev.release) byFrame.set(key, hit);
  }
  return [...byFrame.values()].sort((a, b) => a.mid - b.mid);
}

export function groupVisits(frames: { mjd: number }[]): number[] {
  const out: number[] = [];
  let v = -1;
  let last = Number.NEGATIVE_INFINITY;
  for (const f of frames) {
    if (f.mjd - last > VISIT_GAP_DAYS) v++;
    out.push(v);
    last = f.mjd;
  }
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Our deepest 50% recovery magnitude, from the newest published injection study. */
export async function pipelineLimit(env: Env): Promise<{ m50_ab: number | null; study_id: string | null }> {
  try {
    const idx = await readStaticJson<InjectionStudyIndex>(env, "injection/index.json");
    const newest = [...(idx?.studies ?? [])].sort((a, b) => b.generated_utc.localeCompare(a.generated_utc))[0];
    if (!newest) return { m50_ab: null, study_id: null };
    const s = await readStaticJson<InjectionStudy>(env, `injection/${newest.study_id}.json`);
    const vals = (s?.m50_by_rate ?? []).map((r) => r.m50_ab).filter((x): x is number => typeof x === "number");
    return { m50_ab: vals.length ? Math.max(...vals) : null, study_id: newest.study_id };
  } catch {
    return { m50_ab: null, study_id: null };
  }
}

export function brightness(frames: FindFrame[], limit: { m50_ab: number | null; study_id: string | null }): FindBrightness {
  const v = frames.map((f) => f.predicted.vmag).filter((x): x is number => typeof x === "number");
  const vmin = v.length ? Math.min(...v) : null;
  const vmax = v.length ? Math.max(...v) : null;
  let verdict: FindBrightness["verdict"] = "unknown";
  if (vmin !== null && limit.m50_ab !== null) {
    if (vmin < limit.m50_ab - 0.5) verdict = "brighter_than_limit";
    else if (vmin <= limit.m50_ab + 0.5) verdict = "near_limit";
    else verdict = "fainter_than_limit";
  }
  const b: FindBrightness = {
    vmag_min: vmin === null ? null : round(vmin, 2),
    vmag_max: vmax === null ? null : round(vmax, 2),
    m50_ab: limit.m50_ab,
    m50_study_id: limit.study_id,
    verdict,
    note_plain: "",
  };
  b.note_plain = brightnessNote(b, frames.length);
  return b;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

const QUERY_RE = /^[\p{L}\p{N} ()/'.,_-]{1,80}$/u;

export function normalizeQuery(q: string | undefined): string {
  const t = (q ?? "").trim().replace(/\s+/g, " ");
  if (!t) throw new ApiError(400, "q is required: an asteroid or comet name, number or designation");
  if (!QUERY_RE.test(t)) throw new ApiError(400, "q may only contain letters, digits, spaces and ( ) / ' . , _ -, up to 80 characters");
  return t;
}

function emptyResult(query: string, status: FindResult["status"], now: Date): FindResult {
  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: workerVersion(),
    query,
    status,
    object: null,
    matches: [],
    n_frames: 0,
    n_visits: 0,
    truncated: false,
    frames: [],
    visits: [],
    catalog: [],
    brightness: null,
    search: null,
    summary_plain: "",
    why_it_matters_plain: whyItMatters(null),
    query_utc: now.toISOString(),
    cached: false,
  };
}

export async function runFind(env: Env, deps: Deps, query: string): Promise<FindResult> {
  const now = deps.now();
  const services = new Set<string>();
  const notes: string[] = [];
  let complete = true;

  const look = await sbdbLookup(deps, query);
  services.add(SBDB);
  if (look.status === "ambiguous") {
    const r = emptyResult(query, "ambiguous", now);
    r.matches = look.matches.slice(0, 20);
    r.summary_plain = `JPL's Small-Body Database knows ${look.matches.length} objects matching “${query}”. Pick one to search for it.`;
    return r;
  }
  if (look.status === "not_found") {
    const r = emptyResult(query, "not_found", now);
    r.summary_plain = `JPL's Small-Body Database has no asteroid or comet matching “${query}”. Try a number (433), a name (Eros) or a designation (2024 YR4).`;
    return r;
  }
  const obj: FindObject = look.object;
  const command = horizonsCommand(obj);
  const nowMjd = now.getTime() / 86400000 + 40587;
  const daily = await dailyEphemeris(deps, command, SURVEY_START_MJD, Math.floor(nowMjd) + 1);
  services.add(HORIZONS);
  if (daily.rows.length < 3) throw new UpstreamError(HORIZONS, "invalid_response", "JPL Horizons returned too short an ephemeris");

  // 3. Coverage.
  const boxes = searchBoxes(daily.rows);
  const chunks: Box[][] = [];
  for (let i = 0; i < boxes.length; i += MAX_BOXES_PER_QUERY) chunks.push(boxes.slice(i, i + MAX_BOXES_PER_QUERY));
  if (chunks.length > MAX_TAP_QUERIES) {
    complete = false;
    notes.push(
      `This object moves fast across the sky, so its track needed ${chunks.length} coverage queries; only the first ${MAX_TAP_QUERIES} were run (until ${mjdToIso(chunks[MAX_TAP_QUERIES - 1]!.at(-1)!.mjd1).slice(0, 10)}).`,
    );
  }
  const run = chunks.slice(0, MAX_TAP_QUERIES);
  const results = await mapLimit(run, 2, (c) => queryObscore(deps, c));
  if (run.length) services.add(IRSA_TAP);
  const rows = results.flatMap((r) => r.rows);
  if (results.some((r) => r.truncated)) {
    complete = false;
    notes.push("IRSA's answer reached its row limit, so some frames may be missing.");
  }
  let hits = matchRows(rows, daily.rows);
  let truncated = false;
  if (hits.length > MAX_FRAMES) {
    truncated = true;
    hits = hits.slice(0, MAX_FRAMES);
  }

  // 4. Exact positions from SPHEREx at each frame midpoint.
  const mids = [...new Set(hits.map((h) => round(h.mid, 6)))];
  const exactChunks: number[][] = [];
  for (let i = 0; i < mids.length && exactChunks.length < MAX_EXACT_CHUNKS; i += EXACT_CHUNK) exactChunks.push(mids.slice(i, i + EXACT_CHUNK));
  const exact = new Map<number, EphemRow>();
  const exactResults = await mapLimit(exactChunks, 3, async (c) => {
    try {
      return (await exactEphemeris(deps, command, c)).rows;
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err;
      return null;
    }
  });
  exactResults.forEach((rowsOrNull, k) => {
    if (!rowsOrNull) return;
    for (const r of rowsOrNull) {
      const m = exactChunks[k]!.find((t) => Math.abs(t - r.mjd) < 2e-5);
      if (m !== undefined) exact.set(m, r);
    }
  });
  const nExact = hits.filter((h) => exact.has(round(h.mid, 6))).length;
  if (nExact < hits.length) {
    notes.push(
      `${hits.length - nExact} of ${hits.length} predicted positions are interpolated from Horizons' daily geocentric table (not computed from SPHEREx's own position), which can be off by several arcseconds for nearby objects.`,
    );
  }
  let dropped = 0;
  hits = hits.filter((h) => {
    const e = exact.get(round(h.mid, 6));
    if (!e) return true;
    if (!inPolygon(e.ra_deg, e.dec_deg, h.poly)) {
      dropped++;
      return false;
    }
    h.predicted = {
      ra_deg: round(e.ra_deg, 6),
      dec_deg: round(e.dec_deg, 6),
      ra_3sigma_arcsec: e.ra_3sigma_arcsec,
      dec_3sigma_arcsec: e.dec_3sigma_arcsec,
      vmag: e.vmag,
      delta_au: e.delta_au,
      method: "horizons_exact",
      observer: "spherex",
    };
    return true;
  });
  if (dropped) notes.push(`${dropped} frames were dropped: the exact position fell just outside the detector.`);

  // 5. File names: the processing version of each week segment, from the public bucket.
  const segs = [...new Set(hits.map((h) => `${h.release}/${h.segment}`))];
  const versions = new Map<string, string | null>();
  await mapLimit(segs, 4, async (s) => {
    const [rel, seg] = s.split("/") as [string, string];
    try {
      versions.set(s, await segmentVersion(deps, rel, seg));
      services.add(S3_NAME);
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err;
      versions.set(s, null);
    }
  });
  const noFile = hits.filter((h) => !versions.get(`${h.release}/${h.segment}`)).length;
  if (noFile) {
    complete = false;
    notes.push(`${noFile} frames are not listed: their files could not be located in the public SPHEREx bucket.`);
  }
  hits = hits.filter((h) => versions.get(`${h.release}/${h.segment}`));

  // 6. Our own measurements.
  const cat = await catalogMatches(env, deps, obj);
  const measuredBy = new Map(cat.detections.map((d) => [`${d.obs_id}D${d.detector}`, d]));

  const visitIdx = groupVisits(hits.map((h) => ({ mjd: h.mid })));
  const frames: FindFrame[] = hits.map((h, k) => {
    const version = versions.get(`${h.release}/${h.segment}`)!;
    const paths = level2Paths(h.release, h.segment, version, h.row.obs_id, h.detector);
    const m = measuredBy.get(`${h.row.obs_id}D${h.detector}`);
    const p = h.predicted;
    return {
      frame_id: `${h.row.obs_id}D${h.detector}`,
      obs_id: h.row.obs_id,
      detector: h.detector,
      planeid: null,
      file: paths.file,
      data_release: h.release.toUpperCase(),
      time_utc: mjdToIso(h.mid),
      mjd: round(h.mid, 7),
      time_start_utc: mjdToIso(h.row.t_min),
      time_end_utc: mjdToIso(h.row.t_max),
      bandpass: h.row.bandpass,
      wavelength_um_range:
        h.row.em_min_m !== null && h.row.em_max_m !== null ? [round(h.row.em_min_m * 1e6, 4), round(h.row.em_max_m * 1e6, 4)] : null,
      visit: visitIdx[k]!,
      predicted: p,
      measured: m
        ? {
            object_id: m.object_id,
            candidate_id: m.candidate_id,
            ra_deg: m.ra_deg,
            dec_deg: m.dec_deg,
            offset_arcsec: round(offsetArcsec(m.ra_deg, m.dec_deg, p.ra_deg, p.dec_deg), 2),
            flux_ujy: m.flux_ujy,
            flux_err_ujy: m.flux_err_ujy,
            snr: m.snr,
            wavelength_um_center: m.wavelength_um_center,
            band_index: m.band_index,
          }
        : null,
      archive_url: paths.archive_url,
      irsa_url: paths.irsa_url,
      irsa_cutout_url: `${paths.irsa_url}?center=${p.ra_deg.toFixed(5)},${p.dec_deg.toFixed(5)}&size=0.1`,
    };
  });

  const visits: FindVisit[] = [];
  for (const f of frames) {
    let v = visits[f.visit];
    if (!v) {
      v = { index: f.visit, start_utc: f.time_utc, end_utc: f.time_utc, n_frames: 0, n_measured: 0, predicted_vmag: null };
      visits[f.visit] = v;
    }
    v.end_utc = f.time_utc;
    v.n_frames++;
    if (f.measured) v.n_measured++;
  }
  for (const v of visits) {
    const mags = frames.filter((f) => f.visit === v.index).map((f) => f.predicted.vmag).filter((x): x is number => typeof x === "number");
    const md = median(mags);
    v.predicted_vmag = md === null ? null : round(md, 2);
  }

  const limit = await pipelineLimit(env);
  const bright = brightness(frames, limit);
  const dataEnd = rows.length ? Math.max(...rows.map((r) => r.t_min)) : null;
  if (!boxes.length) notes.push("SPHEREx never pointed in this object's direction during the survey so far (it was always too close to or too far from the Sun).");

  const result: FindResult = {
    ...emptyResult(query, "found", now),
    object: obj,
    n_frames: frames.length,
    n_visits: visits.length,
    truncated,
    frames,
    visits,
    catalog: cat.links,
    brightness: bright,
    search: {
      start_utc: mjdToIso(daily.rows[0]!.mjd),
      end_utc: mjdToIso(daily.rows.at(-1)!.mjd),
      ephemeris_step_days: 1,
      n_tap_queries: run.length,
      services: [...services],
      complete,
      notes,
    },
    why_it_matters_plain: whyItMatters(obj),
  };
  result.summary_plain = summaryPlain(result, dataEnd === null ? null : mjdToIso(dataEnd));
  return result;
}
