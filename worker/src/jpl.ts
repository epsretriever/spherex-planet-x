/**
 * JPL Small-Body Identification (SBIdent) and Horizons clients.
 *
 * SBIdent: https://ssd-api.jpl.nasa.gov/doc/sb_ident.html
 * Horizons: https://ssd-api.jpl.nasa.gov/doc/horizons.html
 */
import type { Deps } from "./env";
import { fetchUpstream } from "./upstream";
import { JPL_HORIZONS, JPL_SBIDENT } from "./upstreams";

export const SBIDENT = "JPL SBIdent";
export const HORIZONS = "JPL Horizons";

/** Half-width of the SBIdent field of view around each detection (deg). */
export const SBIDENT_HWIDTH_DEG = 0.1;
/**
 * SBIdent can take well over 15 s even for the fast first pass, so it gets a longer timeout,
 * but short enough that a lookup started after a response (waitUntil, which Cloudflare stops
 * about 30 s after the response) can still store its result. Lookups that run out of time are
 * finished by the cron, which has no such limit.
 * We use only the first (fast, approximate) pass: JPL Horizons then computes precise positions
 * for the few objects that come close, so the slow numerically integrated second pass adds
 * nothing but latency.
 */
export const SBIDENT_TIMEOUT_MS = 20_000;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** RA in degrees -> "hh-mm-ss.ss" (SBIdent's dash-separated sexagesimal). */
export function raToSbident(raDeg: number): string {
  let s = (((raDeg % 360) + 360) % 360) / 15 * 3600;
  s = Math.round(s * 100) / 100;
  if (s >= 86400) s -= 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  return `${pad(h)}-${pad(m)}-${sec.toFixed(2).padStart(5, "0")}`;
}

/** Dec in degrees -> "dd-mm-ss.s", with a leading "M" for negative values (SBIdent syntax). */
export function decToSbident(decDeg: number): string {
  const sign = decDeg < 0 ? "M" : "";
  let s = Math.round(Math.abs(decDeg) * 3600 * 10) / 10;
  const d = Math.floor(s / 3600);
  s -= d * 3600;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${sign}${pad(d)}-${pad(m)}-${sec.toFixed(1).padStart(4, "0")}`;
}

/** ISO time -> "YYYY-MM-DD_hh:mm:ss" (SBIdent obs-time). */
export function timeToSbident(iso: string): string {
  const d = new Date(iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}:${pad(d.getUTCSeconds())}`;
}

/** Geocentric observer position in km (ICRF), e.g. SPHEREx's position from the FITS headers. */
export type ObserverKm = readonly [number, number, number];

/** True when an observer position is usable (finite and not the placeholder origin). */
export function isUsableObserver(xobs: ObserverKm | null | undefined): xobs is ObserverKm {
  return Array.isArray(xobs) && xobs.length === 3 && xobs.every(Number.isFinite) && xobs.some((v) => v !== 0);
}

/**
 * SBIdent query URL. SBIdent rejects the geocenter (`mpc-code=500`), so the observer is
 * SPHEREx's own geocentric position via `xobs` (km, ICRF). If no spacecraft position is
 * available, the sub-satellite-independent fallback is a point on Earth's surface at
 * lat 0, lon 0 (at most ~6,400 km from SPHEREx; under ~10 arcsec at 1 au).
 */
export function sbidentUrl(
  timeUtc: string,
  raDeg: number,
  decDeg: number,
  xobs?: ObserverKm | null,
  hwidthDeg = SBIDENT_HWIDTH_DEG,
): string {
  const observer: Record<string, string> = isUsableObserver(xobs)
    ? { xobs: xobs.map((v) => v.toFixed(3)).join(",") }
    : { lat: "0", lon: "0", alt: "0" };
  const q = new URLSearchParams({
    ...observer,
    "obs-time": timeToSbident(timeUtc),
    "fov-ra-center": raToSbident(raDeg),
    "fov-dec-center": decToSbident(decDeg),
    "fov-ra-hwidth": String(hwidthDeg),
    "fov-dec-hwidth": String(hwidthDeg),
    "two-pass": "false",
  });
  return `${JPL_SBIDENT}?${q.toString()}`;
}

export interface SbidentObject {
  name: string;
  ra_deg: number;
  dec_deg: number;
  vmag: number | null;
}

/** Parse "hh:mm:ss.s" / "hh mm ss.s" (hours) or decimal degrees. */
export function parseRa(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const parts = v.trim().split(/[\s:hms]+/).filter(Boolean).map(Number);
  if (parts.length === 1 && Number.isFinite(parts[0])) return parts[0]!;
  if (parts.length < 2 || parts.some((p) => !Number.isFinite(p))) return null;
  const [h, m, s = 0] = parts as [number, number, number?];
  return (h + m / 60 + (s ?? 0) / 3600) * 15;
}

/** Parse "+dd mm'ss.s\"" / "-dd:mm:ss" / "Mdd-mm-ss" or decimal degrees. */
export function parseDec(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  let t = v.trim();
  let sign = 1;
  if (/^[-M]/.test(t)) {
    sign = -1;
    t = t.slice(1);
  } else if (t.startsWith("+")) {
    t = t.slice(1);
  }
  const parts = t.split(/[\s:°'"dms-]+/).filter(Boolean).map(Number);
  if (parts.length === 1 && Number.isFinite(parts[0])) return sign * parts[0]!;
  if (parts.length < 2 || parts.some((p) => !Number.isFinite(p))) return null;
  const [d, m, s = 0] = parts as [number, number, number?];
  return sign * (d + m / 60 + (s ?? 0) / 3600);
}

/**
 * Extract objects from an SBIdent response. Uses the second (precise) pass when present.
 * Columns are located by name so that column order changes don't break parsing.
 */
export function parseSbident(body: unknown): SbidentObject[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const fields = (b.fields_second ?? b.fields_first) as unknown;
  const rows = (b.data_second_pass ?? b.data_first_pass) as unknown;
  if (!Array.isArray(fields) || !Array.isArray(rows)) return [];
  const names = fields.map((f) => String(f).toLowerCase());
  const col = (re: RegExp) => names.findIndex((n) => re.test(n));
  const iName = col(/object/);
  const iRa = col(/^(astrometric\s+)?ra\b(?!.*(rate|dist|err))/);
  const iDec = col(/^(astrometric\s+)?dec\b(?!.*(rate|dist|err))/);
  const iV = col(/magnitude|vmag|\bv\b/);
  if (iName < 0 || iRa < 0 || iDec < 0) return [];
  const out: SbidentObject[] = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const ra = parseRa(r[iRa]);
    const dec = parseDec(r[iDec]);
    if (ra === null || dec === null) continue;
    const v = iV >= 0 ? Number.parseFloat(String(r[iV])) : Number.NaN;
    out.push({ name: String(r[iName]).trim(), ra_deg: ra, dec_deg: dec, vmag: Number.isFinite(v) ? v : null });
  }
  return out;
}

export async function sbidentQuery(
  deps: Deps,
  timeUtc: string,
  raDeg: number,
  decDeg: number,
  xobs?: ObserverKm | null,
) {
  const url = sbidentUrl(timeUtc, raDeg, decDeg, xobs);
  const res = await fetchUpstream<unknown>(deps, SBIDENT, url, { timeoutMs: SBIDENT_TIMEOUT_MS });
  return { url, cached: res.cached, objects: parseSbident(res.data) };
}

// --------------------------------------------------------------------------- Horizons

/** Horizons COMMAND for an SBIdent object name. */
export function horizonsCommand(name: string): string {
  let n = name.trim();
  if (/^\([^()]*\)$/.test(n)) n = n.slice(1, -1).trim(); // "(2019 AB12)" -> "2019 AB12"
  const provisional = /^\d{4} [A-Z]{1,2}\d*\b/.exec(n);
  if (provisional) return `'DES=${provisional[0]};'`;
  const numbered = /^(\d+)(\s|$)/.exec(n) ?? /^\((\d+)\)/.exec(n);
  if (numbered) return `'${numbered[1]};'`;
  // "2019 AB12 (something)" -> "2019 AB12"
  const des = n.replace(/\s+\([^)]*\)\s*$/, "").trim() || n;
  return `'DES=${des};'`;
}

const MJD_TO_JD = 2400000.5;

export function horizonsUrl(name: string, mjds: number[]): string {
  const q = new URLSearchParams({
    format: "json",
    COMMAND: horizonsCommand(name),
    OBJ_DATA: "NO",
    MAKE_EPHEM: "YES",
    EPHEM_TYPE: "OBSERVER",
    CENTER: "'500@399'",
    TLIST: mjds.map((m) => `'${(m + MJD_TO_JD).toFixed(6)}'`).join(" "),
    TLIST_TYPE: "JD",
    TIME_TYPE: "UT",
    QUANTITIES: "'1,20'",
    ANG_FORMAT: "DEG",
    CSV_FORMAT: "YES",
    EXTRA_PREC: "YES",
  });
  return `${JPL_HORIZONS}?${q.toString()}`;
}

export interface EphemerisPoint {
  jd: number;
  ra_deg: number;
  dec_deg: number;
  delta_au: number;
}

/** Parse the CSV block between $$SOE and $$EOE of a Horizons observer table (QUANTITIES 1,20). */
export function parseHorizons(body: unknown): EphemerisPoint[] {
  const text = typeof body === "object" && body !== null ? (body as { result?: unknown }).result : body;
  if (typeof text !== "string") return [];
  const soe = text.indexOf("$$SOE");
  const eoe = text.indexOf("$$EOE");
  if (soe < 0 || eoe < soe) return [];
  const out: EphemerisPoint[] = [];
  for (const line of text.slice(soe + 5, eoe).split("\n")) {
    const cells = line.split(",").map((c) => c.trim());
    if (cells.length < 4) continue;
    const jd = Number.parseFloat(cells[0]!);
    const nums = cells.slice(1).filter((c) => c !== "" && /^[-+]?\d/.test(c)).map(Number);
    // Expected numeric columns: RA, DEC (deg), delta (au), deldot (km/s)
    if (!Number.isFinite(jd) || nums.length < 3) continue;
    out.push({ jd, ra_deg: nums[0]!, dec_deg: nums[1]!, delta_au: nums[2]! });
  }
  return out;
}

export async function horizonsEphemeris(deps: Deps, name: string, mjds: number[]) {
  const url = horizonsUrl(name, mjds);
  const res = await fetchUpstream<unknown>(deps, HORIZONS, url);
  return { url, cached: res.cached, points: parseHorizons(res.data) };
}

// --------------------------------------------------------------------------- geometry

const DEG = Math.PI / 180;
export const AU_KM = 149_597_870.7;

/**
 * Shift a geocentric position to the spacecraft's vantage point.
 * scKm: SPHEREx position relative to Earth's center (ICRF axes, km).
 */
export function topocentric(raDeg: number, decDeg: number, deltaAu: number, scKm: readonly number[]) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const d = deltaAu * AU_KM;
  const x = d * Math.cos(dec) * Math.cos(ra) - (scKm[0] ?? 0);
  const y = d * Math.cos(dec) * Math.sin(ra) - (scKm[1] ?? 0);
  const z = d * Math.sin(dec) - (scKm[2] ?? 0);
  const r = Math.hypot(x, y, z);
  return { ra_deg: ((Math.atan2(y, x) / DEG) % 360 + 360) % 360, dec_deg: Math.asin(z / r) / DEG };
}

export function separationArcsec(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const a1 = ra1 * DEG;
  const d1 = dec1 * DEG;
  const a2 = ra2 * DEG;
  const d2 = dec2 * DEG;
  const s = Math.sin((d2 - d1) / 2) ** 2 + Math.cos(d1) * Math.cos(d2) * Math.sin((a2 - a1) / 2) ** 2;
  return (2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, s))))) / DEG * 3600;
}
