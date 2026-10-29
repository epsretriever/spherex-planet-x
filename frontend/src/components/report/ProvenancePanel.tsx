import type { CandidateDetail } from "@/lib/contract";
import { formatUtcDateTime } from "@/lib/format";
import { Panel } from "./Panel";
import styles from "./report.module.css";

export function ProvenancePanel({ candidate, onSource }: { candidate: CandidateDetail; onSource: (i: number) => void }) {
  const p = candidate.provenance;
  return (
    <Panel id="provenance" title="Where this came from" kicker="Provenance">
      <ul className={styles.sourcesList}>
        {candidate.detections.map((d, i) => (
          <li key={`${d.epoch_id}-${i}`}>
            <span>
              #{i + 1} <span className="mono">{d.source?.file ?? "missing source"}</span>
            </span>
            <span>
              {d.source?.archive_url && (
                <a href={d.source.archive_url} target="_blank" rel="noopener noreferrer">
                  archive ↗
                </a>
              )}{" "}
              <button type="button" className={styles.linkButton} onClick={() => onSource(i)} disabled={!d.source}>
                details
              </button>
            </span>
          </li>
        ))}
      </ul>
      <dl className={styles.facts} style={{ marginTop: "var(--space-4)" }}>
        <div>
          <dt>Pipeline run</dt>
          <dd>
            <small>{p.run_id}</small>
          </dd>
        </div>
        <div>
          <dt>Generated</dt>
          <dd>
            <small>{formatUtcDateTime(p.generated_utc)}</small>
          </dd>
        </div>
        <div>
          <dt>Pipeline</dt>
          <dd>
            <small>{candidate.pipeline_version}</small>
          </dd>
        </div>
        <div>
          <dt>Schema</dt>
          <dd>
            <small>{candidate.schema_version ?? "1.0"}</small>
          </dd>
        </div>
      </dl>
      {Object.keys(p.parameters ?? {}).length > 0 && (
        <details className={styles.details}>
          <summary>Pipeline parameters</summary>
          <ul className={styles.sourcesList}>
            {Object.entries(p.parameters).map(([k, v]) => (
              <li key={k}>
                <code className="mono">{k}</code>
                <span className="mono">{String(v)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}
