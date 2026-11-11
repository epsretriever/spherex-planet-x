import { PLANETS, isDrawable, mjdToDate, norm, orbitPoints, planetElements, positionAt, type Elements, type Planet, type Vec3 } from "./orbit";

/**
 * One tracked object placed in the solar system: where its fitted orbit puts it at the orbit's
 * epoch (the time of its SPHEREx sightings), heliocentric ecliptic J2000, in AU.
 */
export interface SystemBody {
  id: string;
  name: string;
  /** Position [x, y, z] in AU, rounded to 0.001. */
  p: Vec3;
  /** 5–95% range of the distance from the Sun over the orbit clones, when published. */
  range: [number, number] | null;
  /** Date of the orbit epoch (UTC, YYYY-MM-DD). */
  date: string;
}

export interface SystemData {
  generated_utc: string;
  bodies: SystemBody[];
}

interface OrbitLike extends Elements {
  epoch_mjd: number;
  helio_distance_au?: { lo: number; hi: number } | null;
}

/** A body from an object's published orbit, or null when the orbit can't be drawn. */
export function systemBody(id: string, name: string, orbit: OrbitLike | null | undefined): SystemBody | null {
  if (!orbit || !isDrawable(orbit) || !Number.isFinite(orbit.epoch_mjd)) return null;
  const p = positionAt(orbit).map((v) => Math.round(v * 1000) / 1000) as Vec3;
  if (!p.every(Number.isFinite)) return null;
  const h = orbit.helio_distance_au;
  const range: [number, number] | null = h && Number.isFinite(h.lo) && Number.isFinite(h.hi) && h.hi >= h.lo ? [h.lo, h.hi] : null;
  return { id, name, p, range, date: mjdToDate(orbit.epoch_mjd).toISOString().slice(0, 10) };
}

/**
 * How far out the first view reaches: past Jupiter, and far enough for all but the most distant
 * few objects (a single distant outlier would otherwise shrink everything else to a speck; it is
 * still drawn, and zooming out shows it).
 */
export function systemReach(bodies: SystemBody[]): number {
  const r = bodies.map((b) => norm(b.p)).sort((a, b) => a - b);
  const bulk = r.length ? r[Math.min(r.length - 1, Math.floor(r.length * 0.97))]! : 0;
  return Math.max(5.6, bulk * 1.1);
}

/** The farthest object from the Sun, in AU (0 without objects). */
export const systemExtent = (bodies: SystemBody[]) => bodies.reduce((m, b) => Math.max(m, norm(b.p)), 0);

/** The planets whose orbits give the scene its scale: Earth to Jupiter, and further out only as far as the objects go. */
export function systemPlanets(extent: number): Planet[] {
  return PLANETS.filter((p) => p.name !== "Mercury" && p.name !== "Venus" && (p.a <= 5.3 || p.a * (1 - p.e) <= extent));
}

/** A planet's orbit as points (the ring is the same at any date; only the planet moves along it). */
export function planetRing(p: Planet, n = 160): Vec3[] {
  return orbitPoints(planetElements(p, 60000), n);
}

/** The two ends of a body's distance range, along the line from the Sun through it. */
export function rangeSegment(b: SystemBody): [Vec3, Vec3] | null {
  const r = norm(b.p);
  if (!b.range || !(r > 0)) return null;
  const at = (d: number) => b.p.map((v) => (v / r) * d) as Vec3;
  return [at(b.range[0]), at(b.range[1])];
}
