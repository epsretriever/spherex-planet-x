import type { CompositionPoint, ObjectComposition } from "./contract";

/** Short names for the Bus-DeMeo complexes, for chips and the runner-up line. */
export const COMPLEX_NAMES: Record<string, string> = {
  S: "Stony (S)",
  C: "Carbon-rich (C)",
  X: "X-type",
  D: "Very red (D)",
  T: "T-type",
  V: "Basaltic (V)",
  A: "Olivine-rich (A)",
  K: "K-type",
  L: "L-type",
  O: "O-type",
  Q: "Fresh stony (Q)",
  R: "R-type",
};

export const complexName = (c: string | null | undefined): string => (c ? (COMPLEX_NAMES[c] ?? `${c}-type`) : "—");

/** Points with a reflectance, split by what they were used for. */
export function plotted(comp: ObjectComposition): { used: CompositionPoint[]; other: CompositionPoint[]; excluded: CompositionPoint[] } {
  const withR = comp.points.filter((p) => p.reflectance !== null && p.reflectance_err !== null && Number.isFinite(p.reflectance));
  return {
    used: withR.filter((p) => p.use === "taxonomy"),
    other: withR.filter((p) => p.use !== "taxonomy"),
    excluded: comp.points.filter((p) => p.reflectance === null),
  };
}

/** Wavelength range to draw: the measured points and the template, at least 0.7–2.6 µm. */
export function wavelengthDomain(comp: ObjectComposition): [number, number] {
  const ws = comp.points.map((p) => p.wavelength_um);
  const hi = Math.max(2.6, ...ws.filter((w) => Number.isFinite(w)));
  return [0.7, Math.min(5.1, hi * 1.03)];
}

/** Reflectance range to draw: points with error bars and the template's spread. */
export function reflectanceDomain(comp: ObjectComposition): [number, number] {
  const vals: number[] = [];
  for (const p of comp.points) {
    if (p.reflectance === null || p.reflectance_err === null) continue;
    vals.push(p.reflectance - p.reflectance_err, p.reflectance + p.reflectance_err);
  }
  const t = comp.taxonomy?.template;
  if (t) t.reflectance.forEach((r, i) => vals.push(r - (t.sigma[i] ?? 0), r + (t.sigma[i] ?? 0)));
  const finite = vals.filter(Number.isFinite);
  if (!finite.length) return [0.5, 1.5];
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const pad = Math.max(0.05, (hi - lo) * 0.08);
  return [Math.max(0, lo - pad), hi + pad];
}

/** Log-wavelength position in [0, 1] within a domain. */
export function logT(um: number, [a, b]: [number, number]): number {
  return (Math.log(um) - Math.log(a)) / (Math.log(b) - Math.log(a));
}

export const pct = (x: number | null | undefined, digits = 0): string =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(digits)}%`;
