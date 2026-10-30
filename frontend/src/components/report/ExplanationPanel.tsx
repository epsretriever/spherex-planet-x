"use client";

import { useEffect, useMemo, useRef } from "react";
import type { AiWriteup, CandidateDetail } from "@/lib/contract";
import { formatUtcDateTime } from "@/lib/format";
import { resolveGrounded } from "@/lib/grounding";
import { GroundList, GroundedText } from "./GroundedText";
import { Panel } from "./Panel";
import styles from "./report.module.css";

/** Template generators are deterministic sentence templates; anything else is AI-written. */
export function generatorLabel(generator: string) {
  return generator.startsWith("template") ? "Template text from the measurements" : "AI-written from the measurements";
}

const TEMPLATE_LABEL = "Template text from the measurements";

function NumberCheck({ value }: { value: "passed" | "failed" | "not_run" }) {
  return (
    <span className={value === "passed" ? styles.pass : value === "failed" ? styles.fail : undefined}>
      {value === "passed" ? "every number matches a measured value" : value === "failed" ? "failed" : "not run"}
    </span>
  );
}

/**
 * "In plain words": the AI analyst write-up when the API has one, otherwise the explanation
 * published with the report. Every highlighted number links to the measured value it came from.
 */
export function ExplanationPanel({ candidate, writeup }: { candidate: CandidateDetail; writeup?: AiWriteup | null }) {
  const exp = candidate.explanation;
  const valuesRef = useRef<HTMLDetailsElement>(null);
  const grounded = useMemo(
    () => resolveGrounded(candidate, writeup ? writeup.grounded_fields : (exp?.grounded_fields ?? [])),
    [candidate, writeup, exp],
  );
  const openValues = () => {
    if (valuesRef.current) valuesRef.current.open = true;
  };

  useEffect(() => {
    if (grounded.missing.length) {
      console.warn(`[explanation] ${candidate.candidate_id}: dropped grounded_fields that don't resolve:`, grounded.missing);
    }
  }, [grounded, candidate.candidate_id]);

  if (!writeup && !exp) {
    return (
      <Panel id="explanation" title="In plain words" kicker="Explanation">
        <p className="muted">No written explanation is available for this candidate. Every measurement is in the sections below.</p>
      </Panel>
    );
  }

  const ai = writeup?.source === "ai";
  const label = writeup ? (ai ? writeup.label_plain || generatorLabel("ai") : TEMPLATE_LABEL) : generatorLabel(exp!.generator);
  return (
    <Panel id="explanation" title="In plain words" kicker="Explanation">
      <div className={styles.explanation} data-source={writeup ? writeup.source : "report"}>
        <span className={styles.explanationLabel}>
          <span aria-hidden="true">{ai || (!writeup && !exp!.generator.startsWith("template")) ? "✦" : "▤"}</span>
          {label}
        </span>
        {writeup ? (
          <>
            {writeup.verdict && (
              <p className={styles.writeupVerdict}>
                <GroundedText text={writeup.verdict} values={grounded.values} prefix="ground" onFollow={openValues} />
              </p>
            )}
            {writeup.paragraphs.map((para, i) => (
              <p key={i} className={styles.explanationText}>
                <GroundedText text={para} values={grounded.values} prefix="ground" onFollow={openValues} />
              </p>
            ))}
          </>
        ) : (
          <p className={styles.explanationText}>
            <GroundedText text={exp!.text} values={grounded.values} prefix="ground" onFollow={openValues} />
          </p>
        )}
      </div>
      <p className={styles.note} style={{ margin: "var(--space-3) 0" }}>
        {writeup ? (
          <>
            Written only from the measured values in this report
            {writeup.model ? (
              <>
                {" "}
                by <span className="mono">{writeup.model}</span>
              </>
            ) : null}
            , {formatUtcDateTime(writeup.generated_utc)}. Number check: <NumberCheck value={writeup.numeric_check} />.
          </>
        ) : (
          <>
            Generated only from the measured values in this report ({exp!.generator}, {formatUtcDateTime(exp!.generated_utc)}). Number
            check: <NumberCheck value={exp!.numeric_check} />.
          </>
        )}{" "}
        Highlighted numbers link to the value they came from.
      </p>
      {grounded.values.length > 0 && (
        <details ref={valuesRef} className={styles.details}>
          <summary>
            Values this {writeup ? "write-up" : "explanation"} uses ({grounded.values.length})
          </summary>
          <GroundList values={grounded.values} prefix="ground" />
        </details>
      )}
    </Panel>
  );
}
