import type { ErrorSource, VettingCheck } from "@/lib/contract";
import { ERROR_STATUS } from "@/lib/labels";
import { Panel } from "./Panel";
import styles from "./report.module.css";

function show(v: VettingCheck["value"]) {
  if (v === null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  return String(v);
}

export function ErrorSourcesPanel({ errorSources, vetting }: { errorSources: ErrorSource[]; vetting: VettingCheck[] }) {
  const order = { not_ruled_out: 0, unknown: 1, ruled_out: 2 } as const;
  const sorted = [...errorSources].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
  return (
    <Panel
      id="errors"
      title="Could it be something else?"
      kicker="Possible error sources"
      intro="Every way this detection could be wrong that we know how to test, and what the data says about each."
    >
      <ul className={styles.checklist}>
        {sorted.map((e) => {
          const s = ERROR_STATUS[e.status] ?? ERROR_STATUS.unknown;
          // Only the explanations we can't rule out stay open; the rest fold to one line.
          if (e.status !== "not_ruled_out") {
            return (
              <li key={e.id} className={styles.checkItem} data-tone={s.tone} data-compact>
                <span className={styles.checkIcon} aria-hidden="true">
                  {s.icon}
                </span>
                <details className={styles.checkDetails}>
                  <summary className={styles.checkTitle}>
                    {e.label}
                    <span className={styles.checkStatus}>{s.label}</span>
                  </summary>
                  <p>{e.explanation}</p>
                  {e.evidence && <p className={styles.checkEvidence}>{e.evidence}</p>}
                </details>
              </li>
            );
          }
          return (
            <li key={e.id} className={styles.checkItem} data-tone={s.tone}>
              <span className={styles.checkIcon} aria-hidden="true">
                {s.icon}
              </span>
              <span className={styles.checkTitle}>
                {e.label}
                <span className={styles.checkStatus}>{s.label}</span>
              </span>
              <p>{e.explanation}</p>
              {e.evidence && <p className={styles.checkEvidence}>{e.evidence}</p>}
            </li>
          );
        })}
      </ul>
      {vetting.length > 0 && (
        <details className={styles.details}>
          <summary>Technical checks ({vetting.length})</summary>
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Vetting checks">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Check</th>
                  <th scope="col">Description</th>
                  <th scope="col">Value</th>
                  <th scope="col">Threshold</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {vetting.map((v) => (
                  <tr key={v.check}>
                    <td>{v.check}</td>
                    <td className={styles.text}>{v.description}</td>
                    <td>{show(v.value)}</td>
                    <td>{show(v.threshold)}</td>
                    <td className={v.passed === true ? styles.pass : v.passed === false ? styles.fail : undefined}>
                      {v.passed === true ? "✓ pass" : v.passed === false ? "✗ fail" : "not evaluated"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Panel>
  );
}
