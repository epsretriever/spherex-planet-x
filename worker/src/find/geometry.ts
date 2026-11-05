/** Sky geometry for the precovery search: separations, footprints, interpolation. */

const DEG = Math.PI / 180;

export function angsepDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const s =
    Math.sin(((dec2 - dec1) * DEG) / 2) ** 2 +
    Math.cos(dec1 * DEG) * Math.cos(dec2 * DEG) * Math.sin(((ra2 - ra1) * DEG) / 2) ** 2;
  return (2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, s))))) / DEG;
}

/** Gnomonic (tangent-plane) projection about (ra0, dec0), in degrees; null behind the plane. */
export function gnomonic(ra: number, dec: number, ra0: number, dec0: number): [number, number] | null {
  const a = ra * DEG;
  const d = dec * DEG;
  const a0 = ra0 * DEG;
  const d0 = dec0 * DEG;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  if (cosc <= 0) return null;
  const x = (Math.cos(d) * Math.sin(a - a0)) / cosc;
  const y = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc;
  return [x / DEG, y / DEG];
}

export type Polygon = [number, number][];

/**
 * Parse an IRSA footprint (s_region / poly). Accepts STC-S ("POLYGON ICRS ra dec ...") and
 * pgSphere ("{(ra , dec),...}", possibly in radians). `near` (the footprint centre in degrees)
 * decides between degrees and radians. Returns null when it can't be read.
 */
export function parsePolygon(text: string, near?: [number, number]): Polygon | null {
  if (!text) return null;
  const nums = (text.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
  if (nums.length < 6 || nums.length % 2 !== 0) return null;
  const pts: Polygon = [];
  for (let i = 0; i < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
  const asDeg = (p: Polygon): Polygon => p.map(([r, d]) => [(((r / DEG) % 360) + 360) % 360, d / DEG]);
  const fitsRadians = pts.every(([r, d]) => Math.abs(r) <= 2 * Math.PI + 1e-9 && Math.abs(d) <= Math.PI / 2 + 1e-9);
  if (near && fitsRadians) {
    const deg = pts;
    const rad = asDeg(pts);
    const dist = (p: Polygon) => Math.min(...p.map(([r, d]) => angsepDeg(r, d, near[0], near[1])));
    return dist(rad) < dist(deg) ? rad : deg;
  }
  return pts;
}

/** Point in a (small, convex or not) spherical polygon, by projecting about the point. */
export function inPolygon(ra: number, dec: number, poly: Polygon): boolean {
  const xy = poly.map(([r, d]) => gnomonic(r, d, ra, dec));
  if (xy.some((p) => p === null)) return false;
  const pts = xy as [number, number][];
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Unwrap an RA sequence so consecutive values never jump by more than 180 deg. */
export function unwrapRa(ras: number[]): number[] {
  const out: number[] = [];
  for (const r of ras) {
    if (!out.length) {
      out.push(r);
      continue;
    }
    let x = r;
    const prev = out[out.length - 1]!;
    while (x - prev > 180) x -= 360;
    while (x - prev < -180) x += 360;
    out.push(x);
  }
  return out;
}

export interface Sample {
  mjd: number;
  ra_deg: number;
  dec_deg: number;
}

/**
 * Quadratic (three-point Lagrange) interpolation of a daily ephemeris at `mjd`. Returns null
 * outside the table. RA is unwrapped locally, so the 0/360 boundary is handled.
 */
export function interpolate<T extends Sample>(rows: T[], mjd: number): { ra_deg: number; dec_deg: number; i: number } | null {
  if (rows.length < 2 || mjd < rows[0]!.mjd || mjd > rows[rows.length - 1]!.mjd) return null;
  let lo = 0;
  let hi = rows.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.mjd <= mjd) lo = mid;
    else hi = mid;
  }
  const i0 = Math.max(0, Math.min(rows.length - 3, lo - 1));
  const pts = rows.slice(i0, i0 + 3);
  if (pts.length < 3) {
    const [a, b] = [rows[lo]!, rows[hi]!];
    const t = (mjd - a.mjd) / (b.mjd - a.mjd || 1);
    const [ra0, ra1] = unwrapRa([a.ra_deg, b.ra_deg]);
    return { ra_deg: (((ra0! + t * (ra1! - ra0!)) % 360) + 360) % 360, dec_deg: a.dec_deg + t * (b.dec_deg - a.dec_deg), i: lo };
  }
  const ras = unwrapRa(pts.map((p) => p.ra_deg));
  const lag = (vals: number[]) => {
    let s = 0;
    for (let j = 0; j < 3; j++) {
      let w = 1;
      for (let k = 0; k < 3; k++) if (k !== j) w *= (mjd - pts[k]!.mjd) / (pts[j]!.mjd - pts[k]!.mjd);
      s += w * vals[j]!;
    }
    return s;
  };
  return { ra_deg: ((lag(ras) % 360) + 360) % 360, dec_deg: lag(pts.map((p) => p.dec_deg)), i: lo };
}

/** On-sky offset between two positions in arcsec. */
export const offsetArcsec = (ra1: number, dec1: number, ra2: number, dec2: number) => angsepDeg(ra1, dec1, ra2, dec2) * 3600;
