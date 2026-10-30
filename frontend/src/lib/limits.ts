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
