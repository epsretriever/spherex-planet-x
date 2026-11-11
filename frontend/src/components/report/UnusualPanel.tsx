import type { Anomaly } from "@/lib/contract";
import { fmt } from "@/lib/format";
import { Panel } from "./Panel";
import styles from "./report.module.css";

const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? fmt(v, Math.abs(v) < 10 ? 2 : 1) : "—");

/** Why the anomaly ranking puts this object where it does: the reason, and each feature against what's typical. */
export function UnusualPanel({ anomaly }: { anomaly: Anomaly }) {
  const score = Math.max(0, Math.min(1, anomaly.score));
  return (
    <Panel
      id="unusual"
      title="How unusual is it?"
      kicker="Anomaly ranking"
      intro="A model compares each object's speed, direction, position and colour with the other objects we have tracked. Unusual only means unlike the rest of our own list: worth a closer look, nothing more."
    >
      <p className={styles.unusualReason}>{anomaly.reason_plain}</p>
      <p className={styles.note}>
        Ranked <span className="mono">#{anomaly.rank}</span>
        {anomaly.n_ranked ? ` of ${anomaly.n_ranked}` : ""} by unusualness · score <span className="mono">{fmt(score, 2)}</span> (0 typical, 1 most unusual)
      </p>
      {anomaly.features.length > 0 && (
        <div className={styles.tableWrap} style={{ marginTop: "var(--space-4)" }}>
          <table className={styles.table}>
            <caption className="visually-hidden">Features compared with the median of the ranked objects</caption>
            <thead>
              <tr>
                <th scope="col">Feature</th>
                <th scope="col">This object</th>
                <th scope="col">Median of our objects</th>
              </tr>
            </thead>
            <tbody>
              {anomaly.features.map((f) => (
                <tr key={f.name}>
                  <th scope="row" className={styles.text}>
                    {f.label}
                  </th>
                  <td>{num(f.value)}</td>
                  <td>{num(f.median)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
