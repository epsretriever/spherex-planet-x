import type { QualityLevel, Scores } from "@/lib/contract";
import { QUALITY_LABELS } from "@/lib/labels";
import styles from "./QualityMeter.module.css";

const LEVEL: Record<QualityLevel, number> = { low: 1, medium: 2, high: 3 };

interface Props {
  level: QualityLevel;
  /** Full breakdown, shown on hover/focus and in the report. */
  scores?: Scores;
  overall?: number;
}

export function QualityMeter({ level, scores, overall }: Props) {
  const n = LEVEL[level] ?? 0;
  const score = scores?.overall ?? overall;
  const title = scores
    ? `Rule-based score ${scores.overall.toFixed(2)} (motion ${scores.motion_consistency.toFixed(2)}, signal ${scores.snr.toFixed(2)}, artifact likelihood ${scores.artifact_likelihood.toFixed(2)}). A ranking, not a probability.`
    : typeof score === "number"
      ? `Rule-based score ${score.toFixed(2)}. A ranking, not a probability.`
      : undefined;
  return (
    <span className={styles.meter} title={title}>
      <span className={styles.bars} aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={styles.bar} data-on={i <= n || undefined} />
        ))}
      </span>
      <span>
        {QUALITY_LABELS[level] ?? level}
        <span className="visually-hidden"> quality</span>
        {typeof score === "number" && <span className={`mono ${styles.score}`}> {score.toFixed(2)}</span>}
      </span>
    </span>
  );
}
