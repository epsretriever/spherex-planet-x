"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { MicButton } from "@/components/MicButton";
import { DataError, askGuide } from "@/lib/api";
import type { GuideAnswer } from "@/lib/contract";
import { sessionId } from "@/lib/session";
import { useVoiceInput } from "@/lib/voice";
import styles from "./Guide.module.css";

const SUGGESTIONS = [
  "What is Driftnet?",
  "Could you see Planet X?",
  "How much of the sky have you searched?",
  "How do you use AI?",
  "What does unexplained mean?",
];
const MAX_TURNS = 6;

type Turn =
  | { id: number; question: string; status: "busy" }
  | { id: number; question: string; status: "done"; answer: GuideAnswer }
  | { id: number; question: string; status: "error"; message: string };

/** The guide's chat panel. Answers come only from what the site publishes, checked in code. */
export default function GuidePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const nextId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const titleId = useId();
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
      settle({ id, question: text, status: "done", answer: await askGuide(text, sessionId()) });
    } catch (err) {
      settle({
        id,
        question: text,
        status: "error",
        message:
          err instanceof DataError && err.detail
            ? err.detail
            : "The guide isn't reachable right now. The About page explains how everything works.",
      });
    }
  };
  const voice = useVoiceInput((text) => void ask(text));

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  if (!open) return null;

  return (
    <section className={styles.panel} role="dialog" aria-labelledby={titleId}>
      <header className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          <span aria-hidden="true">✦</span> Ask Driftnet
        </h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close the guide">
          ×
        </button>
      </header>
      <p className={styles.intro}>
        Questions about this project, its methods and what it has searched. Answers use only what this site publishes, and every
        number is checked.
      </p>
      {turns.length > 0 && (
        <ol ref={listRef} className={styles.chat} aria-live="polite" aria-busy={busy}>
          {turns.map((t) => (
            <li key={t.id}>
              <p className={styles.q}>
                <span className="visually-hidden">You asked: </span>
                {t.question}
              </p>
              {t.status === "busy" && (
                <p className={`${styles.a} muted`} role="status">
                  Thinking…
                </p>
              )}
              {t.status === "error" && <p className={`${styles.a} ${styles.err}`}>{t.message}</p>}
              {t.status === "done" && (
                <div className={styles.a}>
                  <p>{t.answer.answer}</p>
                  {t.answer.links.length > 0 && (
                    <p className={styles.links}>
                      {t.answer.links.map((l) => (
                        <Link key={l.href} href={l.href} prefetch={false} onClick={onClose}>
                          {l.label} →
                        </Link>
                      ))}
                    </p>
                  )}
                  {t.answer.model && (
                    <p className={styles.meta}>
                      <span className="mono">{t.answer.model}</span>
                      {t.answer.numeric_check === "passed" ? " · numbers checked" : ""}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {turns.length === 0 && (
        <p className={styles.suggest}>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => void ask(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </p>
      )}
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor={inputId} className="visually-hidden">
          Your question
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={question}
          maxLength={500}
          placeholder={voice.state === "recording" ? "Listening…" : "Ask anything about Driftnet"}
          onChange={(e) => setQuestion(e.target.value)}
          autoComplete="off"
          enterKeyHint="send"
        />
        {voice.supported && <MicButton state={voice.state} onStart={() => void voice.start()} onStop={voice.stop} disabled={busy} />}
        <button type="submit" className="button button-primary" disabled={busy || !question.trim()}>
          Ask
        </button>
      </form>
      {voice.message && (
        <p className={styles.err} role="alert">
          {voice.message}
        </p>
      )}
      <p className={styles.meta}>AI answers can be wrong. Llama 3.3 on Cloudflare Workers AI.</p>
    </section>
  );
}
