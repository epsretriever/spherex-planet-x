/**
 * Two-body orbit geometry for the object page: Kepler's equation, heliocentric ecliptic
 * positions from orbital elements, approximate planet positions, and orbit clones sampled
 * from an element covariance for the uncertainty cloud.
 *
 * Positions are heliocentric ecliptic J2000 in AU: x toward the vernal equinox, z toward the
 * north ecliptic pole.
 */

const D2R = Math.PI / 180;

export interface Elements {
  a_au: number;
  e: number;
  i_deg: number;
  node_deg: number;
  peri_deg: number;
  mean_anomaly_deg: number;
}

export type Vec3 = [number, number, number];

/** Eccentric anomaly E from mean anomaly M (radians), for 0 ≤ e < 1. */
export function solveKepler(M: number, e: number): number {
  const m = Math.atan2(Math.sin(M), Math.cos(M));
  let E = e < 0.8 ? m : Math.PI * Math.sign(m || 1);
  for (let i = 0; i < 60; i++) {
    const f = E - e * Math.sin(E) - m;
    const step = f / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return E;
}

/** Whether these elements describe a closed (elliptical) orbit we can draw. */
export function isDrawable(el: Elements): boolean {
  return (
    Number.isFinite(el.a_au) && el.a_au > 0 && Number.isFinite(el.e) && el.e >= 0 && el.e < 1 &&
    [el.i_deg, el.node_deg, el.peri_deg, el.mean_anomaly_deg].every(Number.isFinite)
  );
}

/** Position on the orbit at eccentric anomaly E. */
function positionAtE(el: Elements, E: number): Vec3 {
  const { a_au: a, e } = el;
  // In the orbital plane, x toward perihelion.
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const O = el.node_deg * D2R;
  const w = el.peri_deg * D2R;
  const I = el.i_deg * D2R;
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), cI = Math.cos(I), sI = Math.sin(I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** Position at the elements' own epoch (their mean anomaly). */
export function positionAt(el: Elements, meanAnomalyDeg = el.mean_anomaly_deg): Vec3 {
  return positionAtE(el, solveKepler(meanAnomalyDeg * D2R, el.e));
}

/** `n` points around the whole orbit, evenly spaced in eccentric anomaly (closed: last = first). */
export function orbitPoints(el: Elements, n = 180): Vec3[] {
  const out: Vec3[] = [];
  for (let k = 0; k <= n; k++) out.push(positionAtE(el, (2 * Math.PI * k) / n));
  return out;
}

/** Days per Julian century, and the MJD of J2000.0 (2000 Jan 1.5 TT). */
const DAYS_PER_CENTURY = 36525;
export const MJD_J2000 = 51544.5;

export interface Planet {
  name: string;
  /** a, e, I, mean longitude L, longitude of perihelion ϖ, node Ω at J2000; L rate in deg/century. */
  a: number;
  e: number;
  I: number;
  L: number;
  varpi: number;
  node: number;
  Ldot: number;
}

/**
 * Mean elements at J2000 from Standish, "Keplerian Elements for Approximate Positions of the
 * Major Planets" (JPL Solar System Dynamics, table 1, valid 1800–2050). Only the mean
 * longitude is advanced in time: enough to place the planets on a diagram, not for astrometry.
 */
export const PLANETS: Planet[] = [
  { name: "Mercury", a: 0.38709927, e: 0.20563593, I: 7.00497902, L: 252.2503235, varpi: 77.45779628, node: 48.33076593, Ldot: 149472.67411175 },
  { name: "Venus", a: 0.72333566, e: 0.00677672, I: 3.39467605, L: 181.9790995, varpi: 131.60246718, node: 76.67984255, Ldot: 58517.81538729 },
  { name: "Earth", a: 1.00000261, e: 0.01671123, I: -0.00001531, L: 100.46457166, varpi: 102.93768193, node: 0, Ldot: 35999.37244981 },
  { name: "Mars", a: 1.52371034, e: 0.0933941, I: 1.84969142, L: -4.55343205, varpi: -23.94362959, node: 49.55953891, Ldot: 19140.30268499 },
  { name: "Jupiter", a: 5.202887, e: 0.04838624, I: 1.30439695, L: 34.39644051, varpi: 14.72847983, node: 100.47390909, Ldot: 3034.74612775 },
  { name: "Saturn", a: 9.53667594, e: 0.05386179, I: 2.48599187, L: 49.95424423, varpi: 92.59887831, node: 113.66242448, Ldot: 1222.49362201 },
  { name: "Uranus", a: 19.18916464, e: 0.04725744, I: 0.77263783, L: 313.23810451, varpi: 170.9542763, node: 74.01692503, Ldot: 428.48202785 },
  { name: "Neptune", a: 30.06992276, e: 0.00859048, I: 1.77004347, L: -55.12002969, varpi: 44.96476227, node: 131.78422574, Ldot: 218.45945325 },
];

/** A planet's elements at a date (MJD), in the same form as an object's. */
export function planetElements(p: Planet, mjd: number): Elements {
  const T = (mjd - MJD_J2000) / DAYS_PER_CENTURY;
  const L = p.L + p.Ldot * T;
  return { a_au: p.a, e: p.e, i_deg: p.I, node_deg: p.node, peri_deg: p.varpi - p.node, mean_anomaly_deg: L - p.varpi };
}

/** Cholesky factor (lower) of a symmetric positive semi-definite matrix, with a tiny ridge. */
export function cholesky(m: number[][]): number[][] | null {
  const n = m.length;
  if (!n || m.some((r) => r.length !== n || r.some((v) => !Number.isFinite(v)))) return null;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const scale = Math.max(...m.map((r, i) => Math.abs(r[i]!))) || 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = m[i]![j]!;
      for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        if (s < -1e-9 * scale) return null;
        L[i]![i] = Math.sqrt(Math.max(s, 0) + 1e-15 * scale);
      } else {
        L[i]![j] = s / L[j]![j]!;
      }
    }
  }
  return L;
}

/** Deterministic standard-normal generator (mulberry32 + Box–Muller), so the cloud doesn't shimmer. */
export function normals(seed: number) {
  let s = seed >>> 0;
  const u = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    const u1 = Math.max(u(), 1e-12);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u());
  };
}

/**
 * Orbit clones drawn from the covariance over [a, e, i, node, peri, M]. Clones that leave the
 * elliptical regime (e ≥ 1, a ≤ 0) are dropped rather than clipped.
 */
export function sampleClones(el: Elements, covariance: number[][], n: number, seed = 1): Elements[] {
  const L = cholesky(covariance);
  if (!L || L.length !== 6) return [];
  const z = normals(seed);
  const base = [el.a_au, el.e, el.i_deg, el.node_deg, el.peri_deg, el.mean_anomaly_deg];
  const out: Elements[] = [];
  for (let k = 0; k < n; k++) {
    const g = base.map(() => z());
    const v = base.map((b, i) => b + L[i]!.reduce((s, lij, j) => s + lij * g[j]!, 0));
    const c: Elements = { a_au: v[0]!, e: v[1]!, i_deg: v[2]!, node_deg: v[3]!, peri_deg: v[4]!, mean_anomaly_deg: v[5]! };
    if (isDrawable(c)) out.push(c);
  }
  return out;
}

/** One-sigma uncertainties from a covariance diagonal, or nulls. */
export function sigmas(covariance: number[][] | null): (number | null)[] {
  return Array.from({ length: 6 }, (_, i) => {
    const v = covariance?.[i]?.[i];
    return typeof v === "number" && v >= 0 ? Math.sqrt(v) : null;
  });
}

export const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

/** Converts an MJD to a JS Date (UTC; the TT–UTC offset of about a minute is ignored). */
export const mjdToDate = (mjd: number) => new Date((mjd - 40587) * 86400000);
