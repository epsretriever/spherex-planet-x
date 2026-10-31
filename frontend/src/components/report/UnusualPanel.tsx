import type { Anomaly } from "@/lib/contract";
import { fmt } from "@/lib/format";
import { Panel } from "./Panel";
import styles from "./report.module.css";

/** Why the anomaly ranking puts this object where it does: the reason, and each feature against what's typical. */
export function UnusualPanel({ anomaly, total }: { anomaly: Anomaly; total?: number }) {
  const score = Math.max(0, Math.min(1, anomaly.score));
  return (
    <Panel
      id="unusual"
      title="How unusual is it?"
      kicker="Anomaly ranking"
      intro="A model compares every object's motion, distance, colour and brightness changes with the rest. Unusual doesn't mean new: it means worth a closer look."
    >
      <p className={styles.unusualReason}>{anomaly.reason_plain}</p>
      <p className={styles.note}>
        Ranked <span className="mono">#{anomaly.rank}</span>
        {total ? ` of ${total}` : ""} by unusualness · score <span className="mono">{fmt(score, 2)}</span> (0 typical, 1 most unusual)
      </p>
      {anomaly.features.length > 0 && (
        <div className={styles.tableWrap} style={{ marginTop: "var(--space-4)" }}>
          <table className={styles.table}>
            <caption className="visually-hidden">Features compared with typical objects</caption>
            <thead>
              <tr>
                <th scope="col">Feature</th>
                <th scope="col">This object</th>
                <th scope="col">Typical</th>
              </tr>
            </thead>
            <tbody>
              {anomaly.features.map((f) => (
                <tr key={f.name}>
                  <th scope="row" className={styles.text}>
                    {f.label_plain}
                  </th>
                  <td>
                    {f.value === null ? "—" : fmt(f.value, Math.abs(f.value) < 10 ? 2 : 1)}
                    {f.value !== null && f.unit ? ` ${f.unit}` : ""}
                  </td>
                  <td>
                    {f.typical === null ? "—" : fmt(f.typical, Math.abs(f.typical) < 10 ? 2 : 1)}
                    {f.typical !== null && f.unit ? ` ${f.unit}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
