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
      {typeof scores.real_bogus === "number" && Number.isFinite(scores.real_bogus) && (
        <div className={styles.model} data-testid="model-score">
          <h3 className={styles.modelTitle}>
            <span aria-hidden="true">✦</span> Model score
          </h3>
          <p className={styles.modelValue}>
            <span className="mono">{Math.round(Math.max(0, Math.min(1, scores.real_bogus)) * 100)}%</span> chance this is a real object, not a
            glitch
          </p>
          <div className={styles.scoreBar} aria-hidden="true">
            <div className={styles.modelFill} style={{ width: `${Math.max(0, Math.min(1, scores.real_bogus)) * 100}%` }} />
          </div>
          <p className={styles.note}>
            From a small neural network trained on SPHEREx stamps: planted objects and JPL-confirmed asteroids as real, rejected glitches
            as bogus. It sits alongside the rule-based score above, which stays the explainable baseline. Each sighting&apos;s stamp can
            show where the model looked.
            {scores.real_bogus_model && (
              <>
                {" "}
                Model <span className="mono">{scores.real_bogus_model}</span>.
              </>
            )}
          </p>
        </div>
      )}
    </Panel>
  );
}
