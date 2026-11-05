/**
 * IRSA TAP (spherex.obscore) for the precovery search.
 *
 * IRSA's TAP rejects INTERSECTS and OR-ed geometry functions on SPHEREx footprints, so the
 * query selects exposures whose footprint centre (s_ra, s_dec) falls in a padded box around
 * the predicted track during each time window, OR-ed into one query (one round trip takes
 * about 11 s whatever the number of boxes). The exact footprint test (s_region) is done here.
 */
import type { Deps } from "../env";
import { UpstreamError } from "../errors";
import { parseCsv } from "../irsa";
import { IRSA_TAP_SYNC } from "../upstreams";
import { upstreamText } from "./http";

export const IRSA_TAP = "IRSA TAP";
export const TAP_TIMEOUT_MS = 90_000;
export const TAP_MAX_ROWS = 20_000;

export interface Box {
  mjd0: number;
  mjd1: number;
  dec0: number;
  dec1: number;
  /** null: every RA (near a pole). ra0 > ra1 means the box wraps through RA 0. */
  ra0: number | null;
  ra1: number | null;
}

const f = (x: number, d = 5) => x.toFixed(d);

export function boxClause(b: Box): string {
  const t = `t_min BETWEEN ${f(b.mjd0)} AND ${f(b.mjd1)} AND s_dec BETWEEN ${f(b.dec0, 4)} AND ${f(b.dec1, 4)}`;
  if (b.ra0 === null || b.ra1 === null) return `(${t})`;
  if (b.ra0 <= b.ra1) return `(${t} AND s_ra BETWEEN ${f(b.ra0, 4)} AND ${f(b.ra1, 4)})`;
  return `(${t} AND (s_ra >= ${f(b.ra0, 4)} OR s_ra <= ${f(b.ra1, 4)}))`;
}

export function obscoreQuery(boxes: Box[]): string {
  return (
    `SELECT TOP ${TAP_MAX_ROWS} obs_id, energy_bandpassname, t_min, t_max, t_exptime, em_min, em_max, s_ra, s_dec, access_url, s_region ` +
    `FROM spherex.obscore WHERE ${boxes.map(boxClause).join(" OR ")}`
  );
}

export interface ObscoreRow {
  obs_id: string;
  bandpass: string | null;
  detector: number | null;
  release: string | null;
  t_min: number;
  t_max: number;
  exptime_s: number | null;
  em_min_m: number | null;
  em_max_m: number | null;
  s_ra: number;
  s_dec: number;
  access_url: string;
  s_region: string;
}

export function parseObscore(csv: string): ObscoreRow[] {
  if (/<VOTABLE/i.test(csv.slice(0, 600)) && /QUERY_STATUS"?\s+value="ERROR/i.test(csv)) {
    const msg = /QUERY_STATUS"?\s+value="ERROR"\s*>([^<]*)</i.exec(csv)?.[1]?.trim();
    throw new UpstreamError(IRSA_TAP, "invalid_response", `IRSA TAP rejected the query${msg ? `: ${msg.slice(0, 160)}` : ""}`);
  }
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const h = rows[0]!.map((x) => x.trim().toLowerCase());
  const c = (n: string) => h.indexOf(n);
  const need = ["obs_id", "t_min", "s_ra", "s_dec", "s_region"];
  if (need.some((n) => c(n) < 0)) throw new UpstreamError(IRSA_TAP, "invalid_response", "IRSA TAP answer is missing expected columns");
  const num = (r: string[], n: string) => {
    const i = c(n);
    const x = i < 0 ? Number.NaN : Number.parseFloat(r[i] ?? "");
    return Number.isFinite(x) ? x : null;
  };
  const str = (r: string[], n: string) => (c(n) < 0 ? "" : (r[c(n)] ?? "").trim());
  const out: ObscoreRow[] = [];
  for (const r of rows.slice(1)) {
    const tMin = num(r, "t_min");
    const ra = num(r, "s_ra");
    const dec = num(r, "s_dec");
    const obsId = str(r, "obs_id");
    if (tMin === null || ra === null || dec === null || !/^\d{4}W\d{2}_\d[A-Z]_\d{4}_\d+$/.test(obsId)) continue;
    const bandpass = str(r, "energy_bandpassname") || null;
    const access = str(r, "access_url");
    const det = /D([1-6])\b/.exec(bandpass ?? "")?.[1] ?? /\/D([1-6])\b/.exec(access)?.[1];
    out.push({
      obs_id: obsId,
      bandpass,
      detector: det ? Number(det) : null,
      release: /spherex_(qr\d+)/i.exec(access)?.[1]?.toLowerCase() ?? null,
      t_min: tMin,
      t_max: num(r, "t_max") ?? tMin,
      exptime_s: num(r, "t_exptime"),
      em_min_m: num(r, "em_min"),
      em_max_m: num(r, "em_max"),
      s_ra: ra,
      s_dec: dec,
      access_url: access,
      s_region: str(r, "s_region"),
    });
  }
  return out;
}

export async function queryObscore(deps: Deps, boxes: Box[]) {
  const form = new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "csv", QUERY: obscoreQuery(boxes) });
  const res = await upstreamText(deps, IRSA_TAP, IRSA_TAP_SYNC, { form, timeoutMs: TAP_TIMEOUT_MS, ttlSeconds: 24 * 3600 });
  const rows = parseObscore(res.body);
  return { rows, truncated: rows.length >= TAP_MAX_ROWS, cached: res.cached };
}
