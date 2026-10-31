/**
 * Our orbit versus JPL's, for objects JPL identifies.
 *
 * Two Horizons queries: JPL's osculating elements at our orbit's epoch (heliocentric, J2000
 * ecliptic, the frame we publish), and JPL's geocentric position at our orbit's 30-day check
 * point. The differences are stored with the JPL result (store.ts) and summarized by
 * GET /api/validation/jpl-orbits.
 */
import type { JplOrbitComparison, OrbitalElements } from "./contract";
import type { Deps } from "./env";
import { HORIZONS, horizonsCommand, horizonsEphemeris, separationArcsec } from "./jpl";
import { fetchUpstream } from "./upstream";
import { JPL_HORIZONS } from "./upstreams";

const MJD_TO_JD = 2400000.5;
/** Horizons calls one comparison makes. */
export const ORBIT_COMPARE_CALLS = 2;

export function horizonsElementsUrl(name: string, mjdTdb: number): string {
  const q = new URLSearchParams({
    format: "json",
    COMMAND: horizonsCommand(name),
    OBJ_DATA: "NO",
    MAKE_EPHEM: "YES",
    EPHEM_TYPE: "ELEMENTS",
    CENTER: "'500@10'",
    REF_PLANE: "ECLIPTIC",
    REF_SYSTEM: "J2000",
    TLIST: `'${(mjdTdb + MJD_TO_JD).toFixed(6)}'`,
    TLIST_TYPE: "JD",
    TIME_TYPE: "TDB",
    OUT_UNITS: "AU-D",
    CSV_FORMAT: "YES",
  });
  return `${JPL_HORIZONS}?${q.toString()}`;
}

export interface JplElements {
  a_au: number;
  e: number;
  i_deg: number;
  node_deg: number;
  peri_deg: number;
  mean_anomaly_deg: number;
}

/**
 * Parse the CSV row between $$SOE and $$EOE of a Horizons ELEMENTS table:
 * JDTDB, Calendar Date (TDB), EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR.
 */
export function parseHorizonsElements(body: unknown): JplElements | null {
  const text = typeof body === "object" && body !== null ? (body as { result?: unknown }).result : body;
  if (typeof text !== "string") return null;
  const soe = text.indexOf("$$SOE");
  const eoe = text.indexOf("$$EOE");
  if (soe < 0 || eoe < soe) return null;
  for (const line of text.slice(soe + 5, eoe).split("\n")) {
    const c = line.split(",").map((x) => x.trim());
    if (c.length < 14) continue;
    const n = (k: number) => Number.parseFloat(c[k]!);
    const el = { e: n(2), i_deg: n(4), node_deg: n(5), peri_deg: n(6), mean_anomaly_deg: n(9), a_au: n(11) };
    if (Object.values(el).every(Number.isFinite)) return el;
  }
  return null;
}

/** Heliocentric distance from elements: r = a (1 - e cos E), with Kepler's equation solved for E. */
export function helioDistance(el: JplElements): number {
  const m = (el.mean_anomaly_deg * Math.PI) / 180;
  let ecc = el.e < 0.8 ? m : Math.PI;
  for (let k = 0; k < 50; k++) ecc -= (ecc - el.e * Math.sin(ecc) - m) / (1 - el.e * Math.cos(ecc));
  return el.a_au * (1 - el.e * Math.cos(ecc));
}

/** Compare our orbit with JPL's. Null when JPL does not answer or the orbit has no check point. */
export async function compareOrbit(
  deps: Deps,
  designation: string,
  orbit: OrbitalElements,
): Promise<JplOrbitComparison | null> {
  if (deps.budget.remaining < ORBIT_COMPARE_CALLS) return null;
  const res = await fetchUpstream<unknown>(deps, HORIZONS, horizonsElementsUrl(designation, orbit.epoch_mjd));
  const jpl = parseHorizonsElements(res.data);
  if (!jpl) return null;
  let positionError: number | null = null;
  let inside: boolean | null = null;
  const check = orbit.check_30d;
  if (check) {
    const eph = await horizonsEphemeris(deps, designation, [check.mjd]);
    const p = eph.points[0];
    if (p) {
      positionError = separationArcsec(check.ra_deg, check.dec_deg, p.ra_deg, p.dec_deg);
      inside = positionError <= 3 * Math.max(check.sigma_major_arcsec, 1e-9);
    }
  }
  const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
  const r = helioDistance(jpl);
  const ours = orbit.helio_distance_au ?? null;
  return {
    designation,
    delta_a_au: round(orbit.a_au - jpl.a_au, 4),
    delta_e: round(orbit.e - jpl.e, 4),
    delta_i_deg: round(orbit.i_deg - jpl.i_deg, 3),
    position_error_arcsec_30d: positionError === null ? null : round(positionError, 1),
    jpl_a_au: round(jpl.a_au, 4),
    jpl_e: round(jpl.e, 4),
    jpl_i_deg: round(jpl.i_deg, 3),
    inside_3sigma_30d: inside,
    jpl_helio_distance_au: round(r, 4),
    our_helio_distance_au: ours,
    distance_in_interval: ours ? ours.lo <= r && r <= ours.hi : null,
  };
}
