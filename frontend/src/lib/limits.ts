import type { InjectionStudy } from "./contract";

/**
 * Fields proposed for InjectionStudy in build-plan section 5 (m50 by distance, Planet Nine
 * brightness context). They are NOT in docs/api-contract.md yet; the page renders them only if
 * the backend sends them, so nothing here is shown until real values exist.
 */
export interface ProposedLimits {
  m50_by_distance?: { distance_au: number; m50_ab: number | null; n_injected?: number }[];
  planet_context?: {
    assumptions: {
      diameter_km: number;
      geometric_albedo: number;
      phase_function?: string;
      thermal_model?: string;
      reference?: string;
    };
    rows: { distance_au: number; predicted_mag_ab: number; band_um?: number; m50_ab: number | null; verdict: "detected" | "missed" | "not_tested" }[];
  } | null;
}

export type LimitsStudy = InjectionStudy & ProposedLimits;

export interface LimitsSummary {
  /** Speeds (″/h) at which at least half were found at some tested brightness. */
  reachedRates: number[];
  /** Speeds at which half were never found at any tested brightness. */
  missedRates: number[];
  /** Faintest m50 over all speeds, and the speed it was reached at. */
  deepest: { m50_ab: number; rate_arcsec_per_hr: number } | null;
  /** Shallowest m50 among speeds that reached 50%. */
  shallowest: { m50_ab: number; rate_arcsec_per_hr: number } | null;
}

export function summarizeLimits(s: InjectionStudy): LimitsSummary {
  const rows = [...s.m50_by_rate].sort((a, b) => a.rate_arcsec_per_hr - b.rate_arcsec_per_hr);
  const reached = rows.filter((r): r is { rate_arcsec_per_hr: number; m50_ab: number } => r.m50_ab !== null);
  const byDepth = [...reached].sort((a, b) => b.m50_ab - a.m50_ab);
  return {
    reachedRates: reached.map((r) => r.rate_arcsec_per_hr),
    missedRates: rows.filter((r) => r.m50_ab === null).map((r) => r.rate_arcsec_per_hr),
    deepest: byDepth[0] ?? null,
    shallowest: byDepth[byDepth.length - 1] ?? null,
  };
}

const rate = (r: number) => `${r < 1 ? r : Math.round(r * 10) / 10}″`;

/** One or two plain sentences, built only from the study's numbers. */
export function limitsSentence(s: InjectionStudy): string {
  const sum = summarizeLimits(s);
  if (!sum.deepest) {
    return "In this test the pipeline never found half of the planted objects at any brightness or speed we tried.";
  }
  const lo = Math.min(...sum.reachedRates);
  const hi = Math.max(...sum.reachedRates);
  const speeds = lo === hi ? `moving ${rate(lo)} per hour` : `moving between ${rate(lo)} and ${rate(hi)} per hour`;
  const depth =
    sum.shallowest && sum.shallowest.m50_ab !== sum.deepest.m50_ab
      ? `down to magnitude ${sum.shallowest.m50_ab.toFixed(1)}–${sum.deepest.m50_ab.toFixed(1)}`
      : `down to magnitude ${sum.deepest.m50_ab.toFixed(1)}`;
  let text = `For objects ${speeds}, our pipeline finds at least half of them ${depth}. Anything fainter is more likely to be missed.`;
  if (sum.missedRates.length) {
    text += ` At ${sum.missedRates.map(rate).join(", ")} per hour it never found half of them at any brightness we tried.`;
  }
  return text;
}

/* ------------------------------------------------------------------------------------------ */
/* Headline numbers. Everything below is computed from the study JSON; only the definitions   */
/* of "bright" and "asteroid-like speed" are fixed here.                                       */
/* ------------------------------------------------------------------------------------------ */

/** "Bright" for the headline: AB magnitude at or brighter than this. */
export const BRIGHT_MAX_AB = 17;
/** Typical main-belt / near-Earth apparent speeds seen over a ~1.5-day linking window (″/h). */
export const ASTEROID_RATES = { core: [10, 30] as const, wide: [3, 30] as const };

type Cell = InjectionStudy["grid"][number] & { motion?: string };

/** Fixed-rate grid cells only (distance/parallax cells share `grid` but sit off the rate bins). */
export function rateCells(s: InjectionStudy): Cell[] {
  const bins = new Set(s.rate_bins_arcsec_per_hr);
  return (s.grid as Cell[]).filter((c) => (c.motion ?? "linear") !== "parallax" && bins.has(c.rate_arcsec_per_hr));
}

export interface Pooled {
  n_injected: number;
  n_recovered: number;
  fraction: number;
  /** Wilson 95% interval for the pooled fraction. */
  ci_low: number;
  ci_high: number;
  /** Lowest and highest single-cell fraction in the pool. */
  cell_min: number;
  cell_max: number;
  /** The speeds (″/h) and the faintest magnitude actually present in the pool. */
  rates: number[];
  mag_max: number;
}

export function wilson(k: number, n: number, z = 1.959964): [number, number] {
  if (n <= 0) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Recovery pooled over bright (≤ maxMag) cells with lo ≤ speed ≤ hi. Null if the study has none. */
export function poolRecovery(s: InjectionStudy, maxMag: number, lo: number, hi: number): Pooled | null {
  const cells = rateCells(s).filter((c) => c.mag_ab <= maxMag && c.rate_arcsec_per_hr >= lo && c.rate_arcsec_per_hr <= hi && c.n_injected > 0);
  if (!cells.length) return null;
  const n = cells.reduce((a, c) => a + c.n_injected, 0);
  const k = cells.reduce((a, c) => a + c.n_recovered, 0);
  const fr = cells.map((c) => c.n_recovered / c.n_injected);
  const [ci_low, ci_high] = wilson(k, n);
  return {
    n_injected: n,
    n_recovered: k,
    fraction: k / n,
    ci_low,
    ci_high,
    cell_min: Math.min(...fr),
    cell_max: Math.max(...fr),
    rates: [...new Set(cells.map((c) => c.rate_arcsec_per_hr))].sort((a, b) => a - b),
    mag_max: Math.max(...cells.map((c) => c.mag_ab)),
  };
}

/** Speeds (″/h) where nothing at any tested brightness was ever found, and the faster ones that never reached 50%. */
export function blindSpeeds(s: InjectionStudy): { zero: number[]; slowNeverHalf: number[]; fastNeverHalf: number[] } {
  const cells = rateCells(s);
  const sum = summarizeLimits(s);
  const lo = sum.reachedRates.length ? Math.min(...sum.reachedRates) : Infinity;
  const hi = sum.reachedRates.length ? Math.max(...sum.reachedRates) : -Infinity;
  const zero = [...s.rate_bins_arcsec_per_hr]
    .sort((a, b) => a - b)
    .filter((r) => {
      const col = cells.filter((c) => c.rate_arcsec_per_hr === r);
      return col.length > 0 && col.every((c) => c.n_recovered === 0);
    });
  return {
    zero,
    slowNeverHalf: sum.missedRates.filter((r) => r < lo),
    fastNeverHalf: sum.missedRates.filter((r) => r > hi),
  };
}

/* ---------------------------------------- Poisson ----------------------------------------- */

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

/** P(X ≤ n) for X ~ Poisson(mu). */
export function poissonCdf(n: number, mu: number): number {
  if (n < 0) return 0;
  if (mu <= 0) return 1;
  let total = 0;
  for (let k = 0; k <= n; k++) total += Math.exp(-mu + k * Math.log(mu) - logFactorial(k));
  return Math.min(1, total);
}

function solve(f: (mu: number) => number, lo: number, hi: number): number {
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Exact (Garwood) central 95% interval for a Poisson count n. */
export function poissonInterval(n: number, conf = 0.95): [number, number] {
  const a = (1 - conf) / 2;
  const top = Math.max(10, n * 3 + 20);
  // Lower: P(X ≥ n | mu) = a  ⇔  1 − cdf(n−1, mu) = a.  cdf decreases in mu.
  const low = n === 0 ? 0 : solve((mu) => poissonCdf(n - 1, mu) - (1 - a), 0, top);
  // Upper: P(X ≤ n | mu) = a.
  const high = solve((mu) => poissonCdf(n, mu) - a, 0, top);
  return [low, high];
}

/** A number to `sig` significant figures, without exponent notation for everyday sizes. */
export function sigFig(x: number, sig = 2): string {
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const v = Number(x.toPrecision(sig));
  const decimals = Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(v))));
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export interface FalseAlarms {
  count: number;
  area_deg2: number;
  rate_per_deg2: number;
  /** Poisson 95% interval for the count, and the same per deg². */
  count_ci: [number, number];
  per_deg2_ci: [number, number];
}

export function falseAlarms(s: InjectionStudy): FalseAlarms {
  const fp = s.false_positives;
  const [lo, hi] = poissonInterval(fp.n_candidates);
  const area = fp.area_deg2 > 0 ? fp.area_deg2 : NaN;
  return {
    count: fp.n_candidates,
    area_deg2: fp.area_deg2,
    rate_per_deg2: fp.n_candidates / area,
    count_ci: [lo, hi],
    per_deg2_ci: [lo / area, hi / area],
  };
}

/* ------------------------------------- Planet verdicts ------------------------------------ */

export type PlanetVerdict = "detected" | "too_faint" | "too_slow" | "never_found" | "not_tested";

export const PLANET_VERDICT_TEXT: Record<PlanetVerdict, string> = {
  detected: "Bright enough to find",
  too_faint: "Too faint: could be missed",
  too_slow: "Too slow for this test to detect",
  never_found: "Not found at any tested brightness",
  not_tested: "Not tested at this distance",
};

type PlanetRow = NonNullable<LimitsStudy["planet_context"]>["rows"][number];
type DistanceRow = NonNullable<LimitsStudy["m50_by_distance"]>[number] & { median_rate_arcsec_per_hr?: number };

/** Apparent speed (″/h) at a distance, from the study's own distance tests (null if unknown). */
export function speedAtDistance(s: LimitsStudy, distance_au: number): number | null {
  const d = (s.m50_by_distance ?? []) as DistanceRow[];
  const exact = d.find((r) => r.distance_au === distance_au);
  return exact?.median_rate_arcsec_per_hr ?? null;
}

/**
 * One consistent rule for every row:
 *  - a measured m₅₀ at that distance → compare the predicted brightness with it;
 *  - no m₅₀ → explain why: the speed there is slower than any speed where we ever reached 50%
 *    (or a nearer tested distance was already too slow), or it was simply never found / not tested.
 */
export function planetVerdict(s: LimitsStudy, row: PlanetRow): PlanetVerdict {
  if (row.m50_ab !== null) return row.predicted_mag_ab <= row.m50_ab ? "detected" : "too_faint";
  const reached = summarizeLimits(s).reachedRates;
  const slowestReached = reached.length ? Math.min(...reached) : null;
  const speed = speedAtDistance(s, row.distance_au);
  if (speed !== null && slowestReached !== null) return speed < slowestReached ? "too_slow" : "never_found";
  // No speed given: farther bodies move slower, so if a nearer (or equal) tested distance already
  // failed to reach 50%, and a nearer one did reach it, this one is too slow too.
  const d = (s.m50_by_distance ?? []) as DistanceRow[];
  const slowFail = (r: DistanceRow) =>
    r.m50_ab === null && (r.median_rate_arcsec_per_hr == null || slowestReached === null || r.median_rate_arcsec_per_hr < slowestReached);
  if (d.some((r) => r.distance_au <= row.distance_au && slowFail(r))) return "too_slow";
  return "not_tested";
}

/** Brightness rows where almost nothing (< `below`) was found at any speed: intentionally beyond reach. */
export function hopelessMags(s: InjectionStudy, below = 0.05): number[] {
  const cells = rateCells(s);
  return [...s.mag_bins_ab]
    .sort((a, b) => a - b)
    .filter((m) => {
      const row = cells.filter((c) => c.mag_ab === m);
      const n = row.reduce((a, c) => a + c.n_injected, 0);
      return n > 0 && row.reduce((a, c) => a + c.n_recovered, 0) / n < below;
    });
}

/** Nearest tested distance (AU) at which motion was too slow to reach 50% at any brightness. */
export function nearestTooSlowDistance(s: LimitsStudy): number | null {
  const reached = summarizeLimits(s).reachedRates;
  const slowest = reached.length ? Math.min(...reached) : null;
  const d = ((s.m50_by_distance ?? []) as DistanceRow[])
    .filter((r) => r.m50_ab === null && (r.median_rate_arcsec_per_hr == null || slowest === null || r.median_rate_arcsec_per_hr < slowest))
    .map((r) => r.distance_au);
  return d.length ? Math.min(...d) : null;
}
