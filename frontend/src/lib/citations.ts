import { resolvePath } from "./grounding";

/** The report section that shows the value at a JSON path, by the path's first key. */
const SECTION_FOR: Record<string, string> = {
  detections: "measurements",
  motion: "motion",
  known_object: "known",
  error_sources: "errors",
  vetting: "errors",
  scores: "quality",
  spectrum: "spectrum",
  injection: "injection",
  provenance: "provenance",
  explanation: "explanation",
};

export function sectionForPath(path: string): string | null {
  const head = /^[^.[\]]+/.exec(path)?.[0];
  return head ? (SECTION_FOR[head] ?? null) : null;
}

/** Plain names for the values people ask about most; anything else shows its path. */
const NAMES: [RegExp, string][] = [
  [/^motion\.rate_arcsec_per_hr$/, "Speed (″/hr)"],
  [/^motion\.time_span_hours$/, "Hours tracked"],
  [/^motion\.n_detections$/, "Sightings"],
  [/^motion\.position_angle_deg$/, "Direction (°)"],
  [/^motion\.fit_residual_rms_arcsec$/, "Fit scatter (″)"],
  [/^motion\.distance_au_estimate\.best$/, "Distance estimate (AU)"],
  [/^scores\.overall$/, "Overall score"],
  [/^scores\.motion_consistency$/, "Motion consistency score"],
  [/^scores\.snr$/, "Signal score"],
  [/^scores\.artifact_likelihood$/, "Artifact likelihood"],
  [/^scores\.quality_level$/, "Quality"],
  [/^known_object\.matched$/, "Matched in JPL"],
  [/^known_object\.designation$/, "JPL designation"],
  [/^detections\[(\d+)\]\.snr$/, "Sighting $1 signal-to-noise"],
];

export function citationName(path: string): string | null {
  for (const [re, name] of NAMES) {
    const m = re.exec(path);
    if (m) return name.replace("$1", String(Number(m[1] ?? 0) + 1));
  }
  return null;
}

export interface Citation {
  path: string;
  name: string | null;
  section: string | null;
  found: boolean;
  value: unknown;
}

/** Resolves cited paths against the report. Unresolvable paths are kept, marked not found. */
export function resolveCitations(doc: unknown, paths: string[]): Citation[] {
  return [...new Set(paths)].map((path) => {
    const r = resolvePath(doc, path);
    return { path, name: citationName(path), section: sectionForPath(path), found: r.found, value: r.value };
  });
}

/** A value for display: numbers trimmed, objects as compact JSON. */
export function showValue(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
  if (v === null) return "null";
  if (v === undefined) return "—";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}
