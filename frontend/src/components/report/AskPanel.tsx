"use client";

import { useId, useRef, useState } from "react";
import { DataError, askAbout } from "@/lib/api";
import { resolveCitations, showValue, type Citation } from "@/lib/citations";
import type { AiAnswer, AiSubjectKind } from "@/lib/contract";
import { sessionId } from "@/lib/session";
import { GroundedText } from "./GroundedText";
import { Panel } from "./Panel";
import styles from "./report.module.css";

const SUGGESTIONS = ["How fast is it moving?", "Could it be a known asteroid?", "Could it be a glitch?", "How sure is this?"];
const MAX_TURNS = 8;

type Turn =
  | { id: number; question: string; status: "busy" }
  | { id: number; question: string; status: "done"; answer: AiAnswer }
  | { id: number; question: string; status: "error"; message: string };

/**
 * A chat box that answers questions from this report's JSON only. Each answer lists the values
 * it used, linked to the section that shows them; when the data can't answer, it says so.
 */
export function AskPanel({ subjectKind, subjectId, doc }: { subjectKind: AiSubjectKind; subjectId: string; doc: unknown }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [off, setOff] = useState(false);
  const nextId = useRef(0);
  const inputId = useId();
  const busy = turns.some((t) => t.status === "busy");

  const ask = async (q: string) => {
    const text = q.trim().slice(0, 500);
    if (!text || busy) return;
    const id = nextId.current++;
    setQuestion("");
    setTurns((ts) => [...ts, { id, question: text, status: "busy" as const }].slice(-MAX_TURNS));
    const settle = (t: Turn) => setTurns((ts) => ts.map((x) => (x.id === id ? t : x)));
    try {
      const answer = await askAbout({ subject_kind: subjectKind, subject_id: subjectId, question: text, session_id: sessionId() });
      settle({ id, question: text, status: "done", answer });
    } catch (err) {
      if (err instanceof DataError && err.reason === "not_found") {
        setOff(true);
        return;
      }
      const message =
        err instanceof DataError && err.detail
          ? err.detail
          : err instanceof DataError && err.status === 429
            ? "You've asked a lot of questions in a row. Wait a minute, then try again."
            : "The question didn't get an answer this time. Try again in a moment.";
      settle({ id, question: text, status: "error", message });
    }
  };

  if (off) return null;

  return (
    <Panel
      id="ask"
      title="Ask about this object"
      kicker="AI"
      intro="Answers come only from the measurements in this report. If they can't answer your question, the reply says so."
    >
      {turns.length > 0 && (
        <ol className={styles.chat} aria-live="polite" aria-busy={busy}>
          {turns.map((t) => (
            <li key={t.id} className={styles.turn}>
              <p className={styles.question}>
                <span className="visually-hidden">You asked: </span>
                {t.question}
              </p>
              {t.status === "busy" && (
                <p className={`${styles.answer} muted`} role="status">
                  Reading the report…
                </p>
              )}
              {t.status === "error" && <p className={`${styles.answer} ${styles.answerError}`}>{t.message}</p>}
              {t.status === "done" && <Answer answer={t.answer} doc={doc} prefix={`ask-${t.id}`} />}
            </li>
          ))}
        </ol>
      )}

      <form
        className={styles.askForm}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor={inputId} className="visually-hidden">
          Your question about this object
        </label>
        <input
          id={inputId}
          type="text"
          value={question}
          maxLength={500}
          placeholder="Ask a question about this object"
          onChange={(e) => setQuestion(e.target.value)}
          autoComplete="off"
          enterKeyHint="send"
        />
        <button type="submit" className="button button-primary" disabled={busy || !question.trim()}>
          Ask
        </button>
      </form>
      {turns.length === 0 && (
        <p className={styles.suggest}>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => void ask(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </p>
      )}
      <p className={styles.note} style={{ marginTop: "var(--space-3)" }}>AI answers can be wrong. Check them against the cited values, which link to where they are shown.</p>
    </Panel>
  );
}

function Answer({ answer, doc, prefix }: { answer: AiAnswer; doc: unknown; prefix: string }) {
  const citations = resolveCitations(doc, answer.citations);
  const values = citations.filter((c) => c.found).map((c) => ({ path: c.path, value: c.value }));
  return (
    <div className={styles.answer}>
      {!answer.answered_from_data && <span className={styles.answerTag}>The data doesn&apos;t tell us</span>}
      <p className={styles.answerText}>
        <GroundedText text={answer.answer} values={values} prefix={prefix} />
      </p>
      {answer.numeric_check === "failed" && (
        <p className={styles.answerError}>A number in this answer doesn&apos;t match the report. Trust the measurements below instead.</p>
      )}
      {citations.length > 0 && (
        <ul className={styles.cites} aria-label="Values this answer used">
          {citations.map((c) => (
            <CitationChip key={c.path} c={c} id={c.found ? `${prefix}-${values.findIndex((v) => v.path === c.path)}` : undefined} />
          ))}
        </ul>
      )}
      {answer.model && (
        <p className={styles.answerMeta}>
          Answered by <span className="mono">{answer.model}</span>
          {answer.cached ? " · repeated answer" : ""}
        </p>
      )}
    </div>
  );
}

function CitationChip({ c, id }: { c: Citation; id?: string }) {
  const body = (
    <>
      <span className={styles.citeName}>{c.name ?? <code>{c.path}</code>}</span>
      <span className="mono">{c.found ? showValue(c.value) : "not in this report"}</span>
    </>
  );
  return (
    <li id={id}>
      {c.section && c.found ? (
        <a href={`#${c.section}`} className={styles.cite} title={c.path}>
          {body}
        </a>
      ) : (
        <span className={styles.cite} title={c.path}>
          {body}
        </span>
      )}
    </li>
  );
}
