/**
 * All-sky geometry for the sky map: a Mollweide (equal-area) projection of right ascension and
 * declination, drawn the way astronomers look up at the sky, with RA increasing to the left.
 *
 * Projected coordinates: x in [-2√2, 2√2], y in [-√2, √2], y up.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
export const MOLLWEIDE_HALF_WIDTH = 2 * Math.SQRT2;
export const MOLLWEIDE_HALF_HEIGHT = Math.SQRT2;

/** Wraps an angle to (-180, 180]. */
export function wrap180(deg: number): number {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

/** Solves 2θ + sin 2θ = π sin φ by Newton's method. */
function auxAngle(phi: number): number {
  if (Math.abs(Math.abs(phi) - Math.PI / 2) < 1e-10) return Math.sign(phi) * (Math.PI / 2);
  let t = phi;
  const target = Math.PI * Math.sin(phi);
  for (let i = 0; i < 50; i++) {
    const f = 2 * t + Math.sin(2 * t) - target;
    const d = 2 + 2 * Math.cos(2 * t);
    if (d === 0) break;
    const step = f / d;
    t -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return t;
}

/** Projects RA/Dec (degrees). `centerRa` is the RA at the middle of the map. */
export function mollweide(raDeg: number, decDeg: number, centerRa = 0): { x: number; y: number } {
  const lambda = -wrap180(raDeg - centerRa) * D2R;
  const theta = auxAngle(Math.max(-90, Math.min(90, decDeg)) * D2R);
  return { x: (2 * Math.SQRT2 / Math.PI) * lambda * Math.cos(theta), y: Math.SQRT2 * Math.sin(theta) };
}

/** J2000 mean obliquity of the ecliptic, degrees (IAU 2006). */
const OBLIQUITY = 23.4392911;

/** Ecliptic longitude/latitude to RA/Dec (J2000), degrees. */
export function eclipticToEquatorial(lonDeg: number, latDeg: number): { ra_deg: number; dec_deg: number } {
  const l = lonDeg * D2R;
  const b = latDeg * D2R;
  const e = OBLIQUITY * D2R;
  const sinDec = Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l);
  const y = Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e);
  const ra = Math.atan2(y, Math.cos(l)) * R2D;
  return { ra_deg: (ra + 360) % 360, dec_deg: Math.asin(Math.max(-1, Math.min(1, sinDec))) * R2D };
}

/** Galactic longitude/latitude to RA/Dec (J2000), degrees, from the IAU-defined pole and node. */
export function galacticToEquatorial(lDeg: number, bDeg: number): { ra_deg: number; dec_deg: number } {
  const raGP = 192.85948 * D2R;
  const decGP = 27.12825 * D2R;
  const lNCP = 122.93192 * D2R;
  const l = lDeg * D2R;
  const b = bDeg * D2R;
  const sinDec = Math.sin(b) * Math.sin(decGP) + Math.cos(b) * Math.cos(decGP) * Math.cos(lNCP - l);
  const y = Math.cos(b) * Math.sin(lNCP - l);
  const x = Math.sin(b) * Math.cos(decGP) - Math.cos(b) * Math.sin(decGP) * Math.cos(lNCP - l);
  const ra = (raGP + Math.atan2(y, x)) * R2D;
  return { ra_deg: ((ra % 360) + 360) % 360, dec_deg: Math.asin(Math.max(-1, Math.min(1, sinDec))) * R2D };
}

export type Pt = { x: number; y: number };

/**
 * Projects a line of sky points into SVG path data, breaking it where it crosses the map's
 * left/right edge. `toSvg` maps projected coordinates to the drawing.
 */
export function linePath(points: { ra_deg: number; dec_deg: number }[], toSvg: (p: Pt) => Pt, centerRa = 0): string {
  let d = "";
  let prevLon: number | null = null;
  for (const s of points) {
    const lon = wrap180(s.ra_deg - centerRa);
    // Crossing the seam: both points near ±180° but on opposite sides.
    const jump = prevLon !== null && Math.abs(lon - prevLon) > 180;
    const q = toSvg(mollweide(s.ra_deg, s.dec_deg, centerRa));
    d += `${prevLon === null || jump ? "M" : "L"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    prevLon = lon;
  }
  return d;
}

/** Samples a full circle of `fn(t)` for t in [0, 360] every `step` degrees. */
export function sample<T>(fn: (t: number) => T, step = 2): T[] {
  const out: T[] = [];
  for (let t = 0; t <= 360; t += step) out.push(fn(t));
  return out;
}

/** The map's outline, an ellipse, as path data. */
export function outlinePath(toSvg: (p: Pt) => Pt): string {
  const a = toSvg({ x: -MOLLWEIDE_HALF_WIDTH, y: 0 });
  const b = toSvg({ x: MOLLWEIDE_HALF_WIDTH, y: 0 });
  const top = toSvg({ x: 0, y: MOLLWEIDE_HALF_HEIGHT });
  const rx = (b.x - a.x) / 2;
  const ry = Math.abs(top.y - a.y);
  return `M${a.x} ${a.y}A${rx} ${ry} 0 1 0 ${b.x} ${b.y}A${rx} ${ry} 0 1 0 ${a.x} ${a.y}Z`;
}

/**
 * A rectangular RA/Dec cell as a closed path, with its edges subdivided so they follow the
 * projection's curves. Cells straddling the map edge are drawn on the side of their center.
 */
export function cellPath(raDeg: number, decDeg: number, sizeDeg: number, toSvg: (p: Pt) => Pt, centerRa = 0): string {
  const h = sizeDeg / 2;
  const dec0 = Math.max(-90, decDeg - h);
  const dec1 = Math.min(90, decDeg + h);
  // Keep every corner on the same side of the seam as the center.
  const c = wrap180(raDeg - centerRa);
  const ra0 = Math.max(-180 + 1e-6, c - h);
  const ra1 = Math.min(180 - 1e-6, c + h);
  const n = Math.max(2, Math.ceil(sizeDeg / 2));
  const ring: [number, number][] = [];
  for (let i = 0; i <= n; i++) ring.push([ra0 + ((ra1 - ra0) * i) / n, dec0]);
  for (let i = 0; i <= n; i++) ring.push([ra1, dec0 + ((dec1 - dec0) * i) / n]);
  for (let i = 0; i <= n; i++) ring.push([ra1 - ((ra1 - ra0) * i) / n, dec1]);
  for (let i = 0; i <= n; i++) ring.push([ra0, dec1 - ((dec1 - dec0) * i) / n]);
  return (
    ring
      .map(([ra, dec], i) => {
        const q = toSvg(mollweide(ra + centerRa, dec, centerRa));
        return `${i ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
      })
      .join("") + "Z"
  );
}

export interface DensityCell {
  ra_deg: number;
  dec_deg: number;
  fraction: number;
}

/**
 * Highest-density regions: the smallest set of cells holding at least `level` of the total
 * (cells taken densest first). Returns, per cell index, the tightest level it belongs to.
 */
export function credibleLevels(cells: DensityCell[], levels: number[] = [0.68, 0.95]): (number | null)[] {
  const total = cells.reduce((s, c) => s + (c.fraction > 0 ? c.fraction : 0), 0);
  const out: (number | null)[] = cells.map(() => null);
  if (!(total > 0)) return out;
  const order = cells.map((_, i) => i).sort((a, b) => cells[b]!.fraction - cells[a]!.fraction);
  const sorted = [...levels].sort((a, b) => a - b);
  let cum = 0;
  for (const i of order) {
    if (!(cells[i]!.fraction > 0)) break;
    const before = cum / total;
    cum += cells[i]!.fraction;
    const lvl = sorted.find((l) => before < l);
    if (lvl === undefined) break;
    out[i] = lvl;
  }
  return out;
}
