/**
 * Request-time known-object enrichment (docs/api-contract.md, "Known-object enrichment").
 *
 * The offline pipeline cannot reach JPL, so every candidate arrives with
 * known_object.checked = false. This module asks JPL SBIdent which catalogued small bodies were
 * near each detection, refines the best few with Horizons (geocentric RA/Dec + distance,
 * corrected to SPHEREx's own position), and decides whether one object explains every epoch.
 */
import type { CandidateDetail, CatalogName, Detection, KnownObject } from "./contract";
import type { CacheLike, Deps } from "./env";
import { UpstreamError } from "./errors";
import {
  HORIZONS,
  SBIDENT,
  type SbidentObject,
  horizonsEphemeris,
  sbidentQuery,
  separationArcsec,
  topocentric,
} from "./jpl";

/** A detection is "explained" by an object predicted within this distance. */
export const MATCH_RADIUS_ARCSEC = 15;
/** Geocentric SBIdent positions can be off by SPHEREx's parallax; prefilter generously. */
const PREFILTER_ARCSEC = 120;
const MAX_HORIZONS_OBJECTS = 3;
const MAX_PARALLEL = 6;
/**
 * SBIdent queries per candidate. A Worker on the free plan may make only 50 subrequests per
 * request (fetches and Cache API calls both count), so instead of one query per exposure we
 * query once per SPHEREx visit: exposures minutes apart see the same objects. Horizons then
 * checks every detection.
 */
export const MAX_SBIDENT_QUERIES = 6;
/** Exposures closer together than this belong to the same visit. */
const VISIT_GAP_HOURS = 1;
/** Fewest SBIdent visits that must answer before we trust the search. */
const MIN_ANSWERED_VISITS = 2;

/** One representative detection per visit (the middle exposure), at most `max`, spread evenly. */
export function sbidentSample<T extends { mjd: number }>(dets: T[], max = MAX_SBIDENT_QUERIES): T[] {
  const sorted = [...dets].sort((a, b) => a.mjd - b.mjd);
  const visits: T[][] = [];
  for (const d of sorted) {
    const last = visits.at(-1);
    if (last && (d.mjd - last.at(-1)!.mjd) * 24 < VISIT_GAP_HOURS) last.push(d);
    else visits.push([d]);
  }
  const reps = visits.map((v) => v[Math.floor(v.length / 2)]!);
  if (reps.length <= max) return reps;
  return Array.from({ length: max }, (_, i) => reps[Math.round((i * (reps.length - 1)) / (max - 1))]!);
}

export interface Enrichment {
  known_object: KnownObject;
  /** classification after enrichment (known_object when matched, otherwise unchanged) */
  matched: boolean;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function notCheckedKnownObject(reason: string, prev?: KnownObject): KnownObject {
  return {
    checked: false,
    not_checked_reason: reason,
    matched: false,
    catalogs_checked: [],
    search_radius_arcsec: MATCH_RADIUS_ARCSEC,
    designation: null,
    predicted_vmag: null,
    per_epoch: [],
    nearest: null,
    observer: null,
    query_utc: prev?.query_utc ?? null,
    enrichment: "static",
  };
}

/** Observer used for the SBIdent search: SPHEREx's own position, read from each image's FITS header. */
const SBIDENT_OBSERVER = "SPHEREx (spacecraft position from the FITS headers, sent to JPL SBIdent as xobs)";

export async function enrichKnownObject(deps: Deps, cand: CandidateDetail): Promise<Enrichment> {
  const dets = cand.detections;
  const now = deps.now().toISOString();
  if (cand.classification === "injected") {
    return { matched: false, known_object: { ...cand.known_object, enrichment: "static" } };
  }
  if (dets.length === 0) {
    return { matched: false, known_object: notCheckedKnownObject("No detections to check.") };
  }

  // 1. SBIdent once per visit (see MAX_SBIDENT_QUERIES).
  let allCached = true;
  const sample = sbidentSample(dets);
  const sb = await mapLimit(sample, MAX_PARALLEL, async (d) => {
    try {
      const r = await sbidentQuery(deps, d.time_utc, d.ra_deg, d.dec_deg, d.spacecraft_geocentric_km);
      allCached &&= r.cached;
      return r.objects;
    } catch (err) {
      if (err instanceof UpstreamError) return err;
      throw err;
    }
  });
  const failures = sb.filter((r): r is UpstreamError => r instanceof UpstreamError);
  // Horizons checks every detection afterwards, so two answered visits are enough to find
  // candidates; only give up when fewer than that came back.
  const answered = sample.flatMap((d, i) => (sb[i] instanceof UpstreamError ? [] : [{ d, objs: sb[i] as SbidentObject[] }]));
  if (answered.length < Math.min(MIN_ANSWERED_VISITS, sample.length)) {
    const f = failures[0]!;
    return {
      matched: false,
      known_object: {
        ...notCheckedKnownObject(
          `JPL SBIdent did not answer for ${failures.length} of ${sample.length} visits (${String(f.upstreamStatus)}).`,
        ),
        query_utc: now,
        enrichment: "live",
      },
    };
  }

  // 2. Rank objects by how many visits they appear near the detection.
  const stats = new Map<string, { count: number; seps: number[]; vmag: number | null }>();
  answered.forEach(({ d, objs }) => {
    for (const o of objs) {
      const sep = separationArcsec(d.ra_deg, d.dec_deg, o.ra_deg, o.dec_deg);
      const s = stats.get(o.name) ?? { count: 0, seps: [], vmag: o.vmag };
      s.count += 1;
      s.seps.push(sep);
      stats.set(o.name, s);
    }
  });
  const ranked = [...stats.entries()]
    .map(([name, s]) => ({ name, count: s.count, med: median(s.seps), vmag: s.vmag }))
    .sort((a, b) => b.count - a.count || a.med - b.med);
  const catalogs: CatalogName[] = [SBIDENT];
  const base = {
    checked: true,
    not_checked_reason: null,
    search_radius_arcsec: MATCH_RADIUS_ARCSEC,
    query_utc: now,
    enrichment: allCached ? ("cached" as const) : ("live" as const),
  };
  if (ranked.length === 0) {
    return {
      matched: false,
      known_object: {
        ...base,
        matched: false,
        catalogs_checked: catalogs,
        designation: null,
        predicted_vmag: null,
        per_epoch: [],
        nearest: null,
        observer: SBIDENT_OBSERVER,
      },
    };
  }

  // 3. Horizons for the best few, corrected to SPHEREx's position.
  const shortlist = ranked.filter((r) => r.med <= PREFILTER_ARCSEC).slice(0, MAX_HORIZONS_OBJECTS);
  let horizonsOk = shortlist.length > 0;
  const refined: {
    name: string;
    vmag: number | null;
    per_epoch: KnownObject["per_epoch"];
    maxSep: number;
    medSep: number;
  }[] = [];
  for (const obj of shortlist) {
    try {
      const eph = await horizonsEphemeris(deps, obj.name, dets.map((d) => d.mjd));
      allCached &&= eph.cached;
      if (eph.points.length !== dets.length) {
        horizonsOk = false;
        continue;
      }
      const per = dets.map((d: Detection, i) => {
        const p = eph.points[i]!;
        const t = topocentric(p.ra_deg, p.dec_deg, p.delta_au, d.spacecraft_geocentric_km);
        return {
          epoch_id: d.epoch_id,
          predicted_ra_deg: round(t.ra_deg, 6),
          predicted_dec_deg: round(t.dec_deg, 6),
          separation_arcsec: round(separationArcsec(d.ra_deg, d.dec_deg, t.ra_deg, t.dec_deg), 2),
        };
      });
      const seps = per.map((p) => p.separation_arcsec);
      refined.push({ name: obj.name, vmag: obj.vmag, per_epoch: per, maxSep: Math.max(...seps), medSep: median(seps) });
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err;
      horizonsOk = false;
    }
  }
  if (refined.length > 0) catalogs.push(HORIZONS);
  base.enrichment = allCached ? "cached" : "live";

  refined.sort((a, b) => a.maxSep - b.maxSep);
  const best = refined[0];
  if (best && best.maxSep <= MATCH_RADIUS_ARCSEC) {
    return {
      matched: true,
      known_object: {
        ...base,
        matched: true,
        catalogs_checked: catalogs,
        designation: best.name,
        predicted_vmag: best.vmag,
        per_epoch: best.per_epoch,
        nearest: null,
        observer: "SPHEREx (geocentric JPL predictions corrected with the spacecraft position from the FITS headers)",
      },
    };
  }
  // Not matched: report the nearest object we looked at.
  const nearest = best
    ? { designation: best.name, separation_arcsec: round(best.medSep, 1) }
    : { designation: ranked[0]!.name, separation_arcsec: round(ranked[0]!.med, 1) };
  return {
    matched: false,
    known_object: {
      ...base,
      matched: false,
      catalogs_checked: catalogs,
      designation: null,
      predicted_vmag: null,
      per_epoch: [],
      nearest,
      observer:
        refined.length > 0
          ? "SPHEREx (geocentric JPL predictions corrected with the spacecraft position from the FITS headers)"
          : horizonsOk
            ? SBIDENT_OBSERVER
            : `${SBIDENT_OBSERVER}; JPL Horizons refinement unavailable`,
    },
  };
}

function round(x: number, d: number): number {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}

// --------------------------------------------------------------------------- result cache

const ENRICH_ORIGIN = "https://enrichment.spherex-planet-x.internal";

export const enrichmentKey = (cand: { candidate_id: string; pipeline_version: string }) =>
  new Request(`${ENRICH_ORIGIN}/v1/${encodeURIComponent(cand.pipeline_version)}/${cand.candidate_id}`);

export async function cachedEnrichment(cache: CacheLike | null, cand: { candidate_id: string; pipeline_version: string }) {
  if (!cache) return null;
  const hit = await cache.match(enrichmentKey(cand));
  if (!hit) return null;
  try {
    return (await hit.json()) as Enrichment;
  } catch {
    return null;
  }
}

export async function storeEnrichment(
  cache: CacheLike | null,
  cand: { candidate_id: string; pipeline_version: string },
  e: Enrichment,
) {
  if (!cache || !e.known_object.checked) return; // only successful checks are cached
  await cache.put(
    enrichmentKey(cand),
    new Response(JSON.stringify(e), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" },
    }),
  );
}
