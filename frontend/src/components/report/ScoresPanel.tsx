import type { Scores } from "@/lib/contract";
import { QualityMeter } from "../QualityMeter";
import { Term } from "../Term";
import { Panel } from "./Panel";
import styles from "./report.module.css";

const ROWS: { key: keyof Pick<Scores, "motion_consistency" | "snr" | "artifact_likelihood">; label: string; hint: string; inverse?: boolean }[] = [
  { key: "motion_consistency", label: "Motion consistency", hint: "How well the sightings fit one moving object" },
  { key: "snr", label: "Signal strength", hint: "Driven by the weakest sighting" },
  { key: "artifact_likelihood", label: "Artifact likelihood", hint: "Higher means more likely a glitch", inverse: true },
];

export function ScoresPanel({ scores }: { scores: Scores }) {
  return (
    <Panel id="quality" title="Signal quality" kicker={scores.method ?? "rule_based_v1"}>
      <div className={styles.callout}>
        <QualityMeter level={scores.quality_level} />
        <p>
          A <Term term="rule-based score">rule-based ranking</Term> from 0 to 1, not a probability that the object is real.
        </p>
      </div>
      <dl className={styles.scores} style={{ marginTop: "var(--space-4)" }}>
        {ROWS.map((r) => (
          <div key={r.key} className={styles.score}>
            <dt>
              {r.label} <span className={styles.note}>· {r.hint}</span>
            </dt>
            <dd>{scores[r.key].toFixed(2)}</dd>
            <div className={styles.scoreBar} aria-hidden="true">
              <div className={styles.scoreFill} data-inverse={r.inverse || undefined} style={{ width: `${Math.max(0, Math.min(1, scores[r.key])) * 100}%` }} />
            </div>
          </div>
        ))}
        <div className={`${styles.score} ${styles.scoreOverall}`}>
          <dt>Overall</dt>
          <dd>{scores.overall.toFixed(2)}</dd>
          <div className={styles.scoreBar} aria-hidden="true">
            <div className={styles.scoreFill} style={{ width: `${Math.max(0, Math.min(1, scores.overall)) * 100}%` }} />
          </div>
        </div>
      </dl>
      {scores.definition && <p className={`mono ${styles.note}`}>{scores.definition}</p>}
    </Panel>
  );
}
