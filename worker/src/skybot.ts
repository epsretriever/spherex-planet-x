/**
 * IMCCE SkyBoT cone search: a second catalog of known solar-system objects, independent of JPL
 * (https://ssp.imcce.fr/webservices/skybot/). Positions are geocentric, so each is shifted to
 * SPHEREx's vantage point with the object's distance (`dg`) before the 15″ test, exactly as the
 * JPL Horizons predictions are (jpl.ts topocentric).
 */
import type { Detection } from "./contract";
import type { Deps } from "./env";
import { UpstreamError } from "./errors";
import { parseDec, parseRa, separationArcsec, topocentric } from "./jpl";
import { IMCCE_SKYBOT } from "./upstreams";
import { USER_AGENT } from "./version";

export const SKYBOT = "IMCCE SkyBoT";
/** Cone radius: wide enough for SPHEREx's parallax on a nearby object (same as the JPL prefilter). */
export const SKYBOT_RADIUS_ARCSEC = 120;
/** SkyBoT calls per candidate: one per SPHEREx visit, at most this many. */
export const SKYBOT_VISITS = 3;
export const SKYBOT_TIMEOUT_MS = 20_000;
const MATCH_RADIUS_ARCSEC = 15;

export function skybotUrl(timeUtc: string, raDeg: number, decDeg: number, radiusArcsec = SKYBOT_RADIUS_ARCSEC): string {
  const iso = timeUtc.endsWith("Z") || /[+-]\d\d:\d\d$/.test(timeUtc) ? timeUtc : `${timeUtc}Z`;
  const q = new URLSearchParams({
    "-ep": new Date(iso).toISOString(),
    "-ra": String(raDeg),
    "-dec": String(decDeg),
    "-rs": String(radiusArcsec),
    "-mime": "json",
    "-output": "basic",
    "-observer": "500",
    "-filter": "0",
    "-objFilter": "111",
    "-from": "Driftnet",
  });
  return `${IMCCE_SKYBOT}?${q.toString()}`;
}

export interface SkybotObject {
  designation: string;
  ra_deg: number;
  dec_deg: number;
  /** Geocentric distance, au; null when SkyBoT did not give one. */
  dg_au: number | null;
  vmag: number | null;
}

const num = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(x) ? x : null;
};

/** "764" + "Gedania" -> "764 Gedania"; unnumbered objects keep their name ("2019 AB12"). */
export function skybotDesignation(numField: unknown, name: unknown): string {
  const n = String(numField ?? "").trim();
  const nm = String(name ?? "").trim();
  return n && n !== "-" && n !== "0" ? `${n} ${nm}`.trim() : nm;
}

/**
 * Objects in a SkyBoT JSON answer. An empty field of view is an empty list (SkyBoT answers
 * with an empty array, or with a "no solar system object" message). null: not a SkyBoT answer.
 */
export function parseSkybot(body: unknown): SkybotObject[] | null {
  if (typeof body === "string") {
    if (/no solar system object/i.test(body)) return [];
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const data = (body as { data?: unknown }).data;
    if (Array.isArray(data)) body = data;
    else return /no solar system object/i.test(JSON.stringify(body)) ? [] : null;
  }
  if (!Array.isArray(body)) return null;
  const out: SkybotObject[] = [];
  for (const r of body) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const key = (re: RegExp) => Object.keys(row).find((k) => re.test(k));
    const ra = parseRa(row[key(/^RA\b/i) ?? ""]);
    const dec = parseDec(row[key(/^DEC\b/i) ?? ""]);
    const designation = skybotDesignation(row.Num, row.Name);
    if (ra === null || dec === null || !designation) continue;
    out.push({
      designation,
      ra_deg: ra,
      dec_deg: dec,
      dg_au: num(row[key(/^dg\b/i) ?? ""]),
      vmag: num(row[key(/^VMag/i) ?? ""]),
    });
  }
  return out;
}

/** Identifiers in a designation: "764 Gedania (A913 SF)" -> n:764, d:gedania, d:a913 sf. */
export function identKeys(designation: string): Set<string> {
  const keys = new Set<string>();
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  let rest = designation.trim();
  for (const m of rest.matchAll(/\(([^()]*)\)/g)) if (m[1]!.trim()) keys.add(/^\d+$/.test(m[1]!.trim()) ? `n:${m[1]!.trim()}` : `d:${norm(m[1]!)}`);
  rest = rest.replace(/\([^()]*\)/g, " ").trim();
  if (/^\d{4} [A-Z]{2}\d*$/.test(rest) || /^[A-Z]\d{3} [A-Z]{2}\d*$/.test(rest)) {
    keys.add(`d:${norm(rest)}`); // provisional designation, not a number + name
    return keys;
  }
  const m = /^(\d+[PDI]?)(?:[\s/]+(.*))?$/.exec(rest);
  if (m) {
    keys.add(`n:${m[1]!.toLowerCase()}`);
    if (m[2]?.trim()) keys.add(`d:${norm(m[2])}`);
  } else if (rest) keys.add(`d:${norm(rest)}`);
  return keys;
}

/** True when two designations (in JPL's or SkyBoT's naming) are the same body. */
export function sameObject(a: string, b: string): boolean {
  const ka = identKeys(a);
  const kb = identKeys(b);
  const na = [...ka].filter((k) => k.startsWith("n:"));
  const nb = [...kb].filter((k) => k.startsWith("n:"));
  if (na.length > 0 && nb.length > 0) return na.some((k) => kb.has(k));
  return [...ka].some((k) => kb.has(k));
}

/** What one catalog said about a candidate, as stored (crosscheck.ts turns it into a status). */
export interface CatalogResult {
  outcome: "match" | "none" | "failed";
  designation: string | null;
  /** Largest separation over the visits checked (match), or the nearest object's median (none). */
  separation_arcsec: number | null;
  vmag: number | null;
  n_visits: number;
  checked_utc: string;
  detail: string | null;
}

/** One representative detection per visit, at most `max`, spread evenly over the arc. */
export function visitSample<T extends { mjd: number }>(dets: T[], max: number): T[] {
  const sorted = [...dets].sort((a, b) => a.mjd - b.mjd);
  const visits: T[][] = [];
  for (const d of sorted) {
    const last = visits.at(-1);
    if (last && (d.mjd - last.at(-1)!.mjd) * 24 < 1) last.push(d);
    else visits.push([d]);
  }
  const reps = visits.map((v) => v[Math.floor(v.length / 2)]!);
  if (reps.length <= max) return reps;
  if (max === 1) return [reps[Math.floor(reps.length / 2)]!];
  return Array.from({ length: max }, (_, i) => reps[Math.round((i * (reps.length - 1)) / (max - 1))]!);
}

type Det = Pick<Detection, "mjd" | "time_utc" | "ra_deg" | "dec_deg"> & { spacecraft_geocentric_km: readonly number[] };

/** Distance from a detection to a SkyBoT object as SPHEREx would see it. */
export function skybotSeparation(d: Det, o: SkybotObject): number {
  const p = o.dg_au && o.dg_au > 0 ? topocentric(o.ra_deg, o.dec_deg, o.dg_au, d.spacecraft_geocentric_km) : o;
  return separationArcsec(d.ra_deg, d.dec_deg, p.ra_deg, p.dec_deg);
}

/** Decide from per-visit answers (null = that visit's query failed). Pure; used by tests. */
export function decideSkybot(visits: { d: Det; objects: SkybotObject[] | null }[], nowUtc: string): CatalogResult {
  const answered = visits.filter((v): v is { d: Det; objects: SkybotObject[] } => v.objects !== null);
  const base = { designation: null, separation_arcsec: null, vmag: null, n_visits: answered.length, checked_utc: nowUtc };
  if (visits.length === 0 || answered.length < Math.min(2, visits.length)) {
    return { ...base, outcome: "failed", detail: `IMCCE SkyBoT answered for ${answered.length} of ${visits.length} visits.` };
  }
  const seen = new Map<string, { seps: number[]; vmag: number | null }>();
  for (const { d, objects } of answered) {
    for (const o of objects) {
      const s = seen.get(o.designation) ?? { seps: [], vmag: o.vmag };
      s.seps.push(skybotSeparation(d, o));
      seen.set(o.designation, s);
    }
  }
  const round = (x: number) => Math.round(x * 100) / 100;
  const ranked = [...seen.entries()]
    .map(([designation, s]) => ({ designation, vmag: s.vmag, n: s.seps.length, max: Math.max(...s.seps) }))
    .sort((a, b) => b.n - a.n || a.max - b.max);
  const best = ranked.find((r) => r.n === answered.length && r.max <= MATCH_RADIUS_ARCSEC);
  if (best) return { ...base, outcome: "match", designation: best.designation, separation_arcsec: round(best.max), vmag: best.vmag, detail: null };
  const near = ranked[0];
  return {
    ...base,
    outcome: "none",
    detail: near ? `Nearest: ${near.designation}, ${round(near.max)}″ away at its farthest (${near.n} of ${answered.length} visits).` : null,
  };
}

async function skybotQuery(deps: Deps, d: Det): Promise<SkybotObject[]> {
  if (deps.budget.remaining <= 0) throw new UpstreamError(SKYBOT, "budget");
  deps.budget.remaining -= 1;
  let res: Response;
  try {
    // No Cache API here: results are stored in D1, and cache calls count as subrequests.
    res = await deps.fetch(skybotUrl(d.time_utc, d.ra_deg, d.dec_deg), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(SKYBOT_TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new UpstreamError(SKYBOT, timeout ? "timeout" : "unreachable");
  }
  if (!res.ok) throw new UpstreamError(SKYBOT, res.status);
  const objects = parseSkybot(await res.text());
  if (objects === null) throw new UpstreamError(SKYBOT, "invalid_response");
  return objects;
}

/** Ask SkyBoT about a candidate: one cone search per visit (at most SKYBOT_VISITS calls). */
export async function checkSkybot(deps: Deps, dets: Det[]): Promise<CatalogResult> {
  const sample = visitSample(dets, SKYBOT_VISITS);
  const visits = await Promise.all(
    sample.map(async (d) => {
      try {
        return { d, objects: await skybotQuery(deps, d) };
      } catch (err) {
        if (err instanceof UpstreamError) return { d, objects: null };
        throw err;
      }
    }),
  );
  return decideSkybot(visits, deps.now().toISOString());
}
