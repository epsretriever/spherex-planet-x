/**
 * JPL Horizons ephemerides for the precovery search.
 * https://ssd-api.jpl.nasa.gov/doc/horizons.html
 *
 * Two kinds of table: a daily geocentric table over the whole survey (to find when and where
 * to look), and exact positions at exposure midpoints as seen from SPHEREx itself (Horizons
 * body -163182, "SPHEREx (Concatenated TLEs)").
 */
import type { Deps } from "../env";
import { UpstreamError } from "../errors";
import { JPL_HORIZONS } from "../upstreams";
import type { FindObject } from "./contract";
import { upstreamText } from "./http";

export const HORIZONS = "JPL Horizons";
/** Horizons' id for SPHEREx as an observing site. */
export const SPHEREX_CENTER = "'500@-163182'";
export const GEOCENTER = "'500@399'";
export const MJD_TO_JD = 2400000.5;

export interface EphemRow {
  mjd: number;
  ra_deg: number;
  dec_deg: number;
  vmag: number | null;
  delta_au: number | null;
  /** Solar elongation (Sun-observer-target angle), deg. */
  elong_deg: number | null;
  ra_3sigma_arcsec: number | null;
  dec_3sigma_arcsec: number | null;
}

/** Horizons COMMAND for an SBDB object: numbered asteroid "433;", others by designation. */
export function horizonsCommand(o: Pick<FindObject, "designation" | "kind" | "numbered">): string {
  if (o.kind === "comet") return `'DES=${o.designation};CAP;NOFRAG;'`;
  if (o.numbered && /^\d+$/.test(o.designation)) return `'${o.designation};'`;
  return `'DES=${o.designation};'`;
}

const BASE = {
  format: "json",
  OBJ_DATA: "NO",
  MAKE_EPHEM: "YES",
  EPHEM_TYPE: "OBSERVER",
  QUANTITIES: "'1,9,20,23,36'",
  ANG_FORMAT: "DEG",
  CSV_FORMAT: "YES",
  CAL_FORMAT: "JD",
  EXTRA_PREC: "YES",
  TIME_TYPE: "UT",
};

const isoDate = (mjd: number) => new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10);

export function dailyUrl(command: string, mjdStart: number, mjdEnd: number): string {
  const q = new URLSearchParams({
    ...BASE,
    COMMAND: command,
    CENTER: GEOCENTER,
    START_TIME: `'${isoDate(mjdStart)}'`,
    STOP_TIME: `'${isoDate(mjdEnd)}'`,
    STEP_SIZE: "'1 d'",
  });
  return `${JPL_HORIZONS}?${q.toString()}`;
}

export function exactUrl(command: string, mjds: number[]): string {
  const q = new URLSearchParams({
    ...BASE,
    COMMAND: command,
    CENTER: SPHEREX_CENTER,
    TLIST: mjds.map((m) => `'${(m + MJD_TO_JD).toFixed(6)}'`).join(" "),
    TLIST_TYPE: "JD",
  });
  return `${JPL_HORIZONS}?${q.toString()}`;
}

const cell = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const t = v.trim();
  if (!t || /^n\.a\.?$/i.test(t)) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
};

/**
 * Parse a Horizons observer table (CSV, JD dates). Columns are found by their header names,
 * e.g. "Date_________JDUT, , , R.A.___(ICRF), DEC____(ICRF), APmag, S-brt, delta, deldot,
 * S-O-T,/r, RA_3sigma, DEC_3sigma," (comets have T-mag, N-mag instead of APmag, S-brt).
 * Throws a clear error when Horizons answered without a table (unknown object, etc.).
 */
export function parseEphemeris(body: string): EphemRow[] {
  let text: string;
  try {
    const j = JSON.parse(body) as { result?: unknown; error?: unknown };
    if (typeof j.error === "string" && j.error) throw new UpstreamError(HORIZONS, "invalid_response", `JPL Horizons: ${j.error.trim()}`);
    text = typeof j.result === "string" ? j.result : "";
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError(HORIZONS, "invalid_response", "JPL Horizons returned a response that is not JSON");
  }
  const soe = text.indexOf("$$SOE");
  const eoe = text.indexOf("$$EOE");
  if (soe < 0 || eoe < soe) {
    const why = /No matches found/i.test(text)
      ? "JPL Horizons has no object by that designation"
      : /Multiple|matching small-bodies/i.test(text)
        ? "JPL Horizons matched several objects"
        : /No ephemeris/i.test(text)
          ? "JPL Horizons has no ephemeris for these dates"
          : "JPL Horizons returned no ephemeris table";
    throw new UpstreamError(HORIZONS, "invalid_response", why);
  }
  const before = text.slice(0, soe).split("\n").map((l) => l.trim()).filter((l) => l && !/^\*+$/.test(l));
  const header = (before.at(-1) ?? "").split(",").map((h) => h.trim());
  const idx = (re: RegExp) => header.findIndex((h) => re.test(h));
  const iDate = idx(/JDUT|^Date/);
  const iRa = idx(/^R\.A\./);
  const iDec = idx(/^DEC/);
  const iMag = idx(/^(APmag|T-mag)$/);
  const iDelta = idx(/^delta$/);
  const iElong = idx(/^S-O-T$/);
  const iRa3 = idx(/^RA_3sigma$/);
  const iDec3 = idx(/^DEC_3sigma$/);
  if (iDate < 0 || iRa < 0 || iDec < 0) throw new UpstreamError(HORIZONS, "invalid_response", "JPL Horizons table has no RA/Dec columns");
  const rows: EphemRow[] = [];
  for (const line of text.slice(soe + 5, eoe).split("\n")) {
    const c = line.split(",");
    if (c.length < header.length - 1) continue;
    const jd = cell(c[iDate]);
    const ra = cell(c[iRa]);
    const dec = cell(c[iDec]);
    if (jd === null || ra === null || dec === null) continue;
    rows.push({
      mjd: jd - MJD_TO_JD,
      ra_deg: ra,
      dec_deg: dec,
      vmag: iMag >= 0 ? cell(c[iMag]) : null,
      delta_au: iDelta >= 0 ? cell(c[iDelta]) : null,
      elong_deg: iElong >= 0 ? cell(c[iElong]) : null,
      ra_3sigma_arcsec: iRa3 >= 0 ? cell(c[iRa3]) : null,
      dec_3sigma_arcsec: iDec3 >= 0 ? cell(c[iDec3]) : null,
    });
  }
  return rows;
}

export async function dailyEphemeris(deps: Deps, command: string, mjdStart: number, mjdEnd: number) {
  const url = dailyUrl(command, mjdStart, mjdEnd);
  const res = await upstreamText(deps, HORIZONS, url, { timeoutMs: 30_000, ttlSeconds: 24 * 3600 });
  return { url, rows: parseEphemeris(res.body), cached: res.cached };
}

/** Exact positions from SPHEREx at the given UTC MJDs (at most EXACT_CHUNK per request). */
export const EXACT_CHUNK = 60;
export async function exactEphemeris(deps: Deps, command: string, mjds: number[]) {
  const url = exactUrl(command, mjds);
  const res = await upstreamText(deps, HORIZONS, url, { timeoutMs: 30_000, ttlSeconds: 7 * 24 * 3600 });
  return { url, rows: parseEphemeris(res.body), cached: res.cached };
}
