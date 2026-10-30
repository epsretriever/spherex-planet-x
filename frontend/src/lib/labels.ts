import type { Classification, ErrorSourceStatus, QualityLevel } from "./contract";

export interface ClassificationStyle {
  label: string;
  /** Plain-language line for the public. */
  plain: string;
  icon: string;
  cssVar: string;
}

/** Display labels from docs/api-contract.md. Never upgrade a classification. */
export const CLASSIFICATIONS: Record<Classification, ClassificationStyle> = {
  known_object: {
    label: "Known object",
    plain: "Matches an asteroid or comet that's already catalogued.",
    icon: "✓",
    cssVar: "--status-known",
  },
  unmatched: {
    label: "Unexplained",
    plain:
      "Moves like a real object, but isn't matched to a known one: either JPL's catalog had no match, or the check hasn't completed yet. It could still be a glitch or a gap in the catalogs.",
    icon: "?",
    cssVar: "--status-unexplained",
  },
  likely_artifact: {
    label: "Likely artifact",
    plain: "Probably a glitch in the image rather than a real object.",
    icon: "!",
    cssVar: "--status-artifact",
  },
  unconfirmed_pair: {
    label: "Unconfirmed pair",
    plain: "Only two sightings. That's not enough to confirm anything moved; it is never a detection on its own.",
    icon: "↔",
    cssVar: "--status-pair",
  },
  injected: {
    label: "SIMULATED",
    plain: "A fake object we added to real images on purpose, to test whether our software can find it.",
    icon: "◇",
    cssVar: "--status-simulated",
  },
};

export const CLASSIFICATION_ORDER: Classification[] = [
  "unmatched",
  "known_object",
  "unconfirmed_pair",
  "likely_artifact",
  "injected",
];

export const QUALITY_LABELS: Record<QualityLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const ERROR_STATUS: Record<ErrorSourceStatus, { label: string; icon: string; tone: string }> = {
  ruled_out: { label: "Ruled out", icon: "✓", tone: "ok" },
  not_ruled_out: { label: "Not ruled out", icon: "!", tone: "warn" },
  unknown: { label: "Unknown", icon: "?", tone: "neutral" },
};

export function isClassification(value: string): value is Classification {
  return value in CLASSIFICATIONS;
}
