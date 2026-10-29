/**
 * IRSA TAP queries for SPHEREx coverage (live from the Worker).
 * Tables follow IRSA's SPHEREx tutorials: spherex.plane (footprint, times, band) joined to
 * spherex.artifact (file URI) on planeid.
 */
import type { CoverageEpoch } from "./contract";
import type { Deps } from "./env";
import { fetchUpstream } from "./upstream";
import { IRSA_TAP_SYNC } from "./upstreams";

export const IRSA_TAP = "IRSA TAP";
export const MAX_ROWS = 2000;
const IRSA_BASE = "https://irsa.ipac.caltech.edu/";

export function coverageAdql(ra: number, dec: number, radiusDeg: number): string {
  const geom =
    radiusDeg > 0
      ? `1 = INTERSECTS(CIRCLE('ICRS', ${ra}, ${dec}, ${radiusDeg}), p.poly)`
      : `1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly)`;
  return (
    `SELECT TOP ${MAX_ROWS + 1} a.uri, p.planeid, p.energy_bandpassname, p.time_bounds_lower, p.time_bounds_upper, ` +
    "p.energy_bounds_lower, p.energy_bounds_upper " +
    "FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid " +
    `WHERE ${geom} ORDER BY p.time_bounds_lower`
  );
}

export function coverageUrl(ra: number, dec: number, radiusDeg: number): string {
  const q = new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "csv", QUERY: coverageAdql(ra, dec, radiusDeg) });
  return `${IRSA_TAP_SYNC}?${q.toString()}`;
}

/** RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((c) => c !== "")) rows.push(row);
  }
  return rows;
}

const FILE_RE = /level2_(\d{4}W\d{2}_\d[A-Z]_\d{4}_\d+)D([1-6])_spx/;

export function mjdToIso(mjd: number): string {
  return new Date((mjd - 40587) * 86400000).toISOString();
}

export function coverageRows(csv: string, ra: number, dec: number): CoverageEpoch[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (n: string) => header.indexOf(n);
  const iUri = col("uri");
  const iPlane = col("planeid");
  const iBand = col("energy_bandpassname");
  const iT0 = col("time_bounds_lower");
  const iT1 = col("time_bounds_upper");
  const iE0 = col("energy_bounds_lower");
  const iE1 = col("energy_bounds_upper");
  if (iUri < 0 || iT0 < 0) throw new Error("IRSA TAP response is missing the uri or time_bounds_lower column");
  const num = (r: string[], i: number) => (i < 0 ? Number.NaN : Number.parseFloat(r[i] ?? ""));
  const out: CoverageEpoch[] = [];
  for (const r of rows.slice(1)) {
    const uri = (r[iUri] ?? "").trim();
    const t0 = num(r, iT0);
    if (!uri || !Number.isFinite(t0)) continue;
    const t1 = num(r, iT1);
    const e0 = num(r, iE0);
    const e1 = num(r, iE1);
    const m = FILE_RE.exec(uri);
    const archive = /^https?:/.test(uri) ? uri : IRSA_BASE + uri.replace(/^\/+/, "");
    out.push({
      obs_id: m ? m[1]! : null,
      planeid: iPlane >= 0 ? (r[iPlane] ?? "").trim() || null : null,
      detector: m ? Number(m[2]) : null,
      bandpass: iBand >= 0 ? (r[iBand] ?? "").trim() || null : null,
      time_utc: mjdToIso(t0),
      mjd: t0,
      time_end_utc: Number.isFinite(t1) ? mjdToIso(t1) : null,
      wavelength_um_range:
        Number.isFinite(e0) && Number.isFinite(e1) ? [round(e0 * 1e6, 4), round(e1 * 1e6, 4)] : null,
      archive_url: archive,
      cutout_url: `${archive}?center=${ra},${dec}&size=0.1`,
    });
  }
  return out;
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

export async function queryCoverage(deps: Deps, ra: number, dec: number, radiusDeg: number) {
  const url = coverageUrl(ra, dec, radiusDeg);
  const res = await fetchUpstream<string>(deps, IRSA_TAP, url, { as: "text" });
  if (/^\s*<\?xml|<VOTABLE/i.test(res.data) && /QUERY_STATUS"?\s+value="ERROR/i.test(res.data)) {
    throw new Error("IRSA TAP reported a query error");
  }
  const epochs = coverageRows(res.data, ra, dec);
  return { epochs: epochs.slice(0, MAX_ROWS), truncated: epochs.length > MAX_ROWS, cached: res.cached };
}
