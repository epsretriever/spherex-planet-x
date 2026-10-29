"use client";

import { useEffect, useMemo } from "react";
import type { CandidateDetail } from "@/lib/contract";
import { formatUtcDateTime } from "@/lib/format";
import { linkNumbers, resolveGrounded } from "@/lib/grounding";
import { Panel } from "./Panel";
import styles from "./report.module.css";

function show(v: unknown) {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
  if (v === null) return "null";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** Template generators are deterministic sentence templates; anything else is AI-written. */
export function generatorLabel(generator: string) {
  return generator.startsWith("template") ? "Template text from the measurements" : "AI-written from the measurements";
}

export function ExplanationPanel({ candidate }: { candidate: CandidateDetail }) {
  const exp = candidate.explanation;
  const grounded = useMemo(() => (exp ? resolveGrounded(candidate, exp.grounded_fields ?? []) : null), [candidate, exp]);

  useEffect(() => {
    if (grounded?.missing.length) {
      console.warn(`[explanation] ${candidate.candidate_id}: dropped grounded_fields that don't resolve:`, grounded.missing);
    }
  }, [grounded, candidate.candidate_id]);

  if (!exp || !grounded) {
    return (
      <Panel id="explanation" title="In plain words" kicker="Explanation">
        <p className="muted">No written explanation is available for this candidate. Every measurement is in the sections below.</p>
      </Panel>
    );
  }

  const parts = linkNumbers(exp.text, grounded.values);
  return (
    <Panel id="explanation" title="In plain words" kicker="Explanation">
      <div className={styles.explanation}>
        <span className={styles.explanationLabel}>
          <span aria-hidden="true">{exp.generator.startsWith("template") ? "▤" : "✦"}</span>
          {generatorLabel(exp.generator)}
        </span>
        <p className={styles.explanationText}>
          {parts.map((p, i) =>
            p.ref === undefined ? (
              <span key={i}>{p.text}</span>
            ) : (
              <a key={i} href={`#ground-${p.ref}`} className={styles.grounded} title={grounded.values[p.ref]!.path}>
                {p.text}
              </a>
            ),
          )}
        </p>
      </div>
      <p className={styles.note} style={{ margin: "var(--space-3) 0" }}>
        Generated only from the measured values in this report ({exp.generator}, {formatUtcDateTime(exp.generated_utc)}). Number
        check:{" "}
        <span className={exp.numeric_check === "passed" ? styles.pass : exp.numeric_check === "failed" ? styles.fail : undefined}>
          {exp.numeric_check === "passed" ? "every number matches a measured value" : exp.numeric_check === "failed" ? "failed" : "not run"}
        </span>
        . Highlighted numbers link to the value they came from.
      </p>
      {grounded.values.length > 0 && (
        <div>
          <h3 className={styles.kicker} style={{ margin: "0 0 var(--space-2)" }}>
            Values this explanation uses
          </h3>
          <ul className={styles.groundList}>
            {grounded.values.map((v, i) => (
              <li key={v.path} id={`ground-${i}`}>
                <code>{v.path}</code>
                <span className="mono">{show(v.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
