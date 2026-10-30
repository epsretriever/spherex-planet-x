"use client";

import { useRef, useState } from "react";
import { DataError, USE_FIXTURES, searchCandidates } from "@/lib/api";
import type { AiSearch, CandidateFilter } from "@/lib/contract";
import { normalizeFilter } from "@/lib/filter";
import styles from "./CandidateBrowser.module.css";

const EXAMPLES = ["Slow unexplained objects", "Fast movers with high scores", "Everything beyond Neptune"];

type State =
  | { kind: "idle" }
  | { kind: "busy"; query: string }
  | { kind: "done"; result: AiSearch }
  | { kind: "error"; message: string }
  | { kind: "off" };

/**
 * "Describe what you're looking for": the AI turns the words into a filter, which the page
 * applies as editable chips. The AI only picks filter values; it never sees or writes data.
 */
export function AiSearchBar({ onApply }: { onApply: (filter: CandidateFilter) => void }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const ctrl = useRef<AbortController | null>(null);

  if (USE_FIXTURES) return null;

  const run = async (q: string) => {
    const text = q.trim().slice(0, 300);
    if (!text) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState({ kind: "busy", query: text });
    try {
      const result = await searchCandidates(text, c.signal);
      if (c.signal.aborted) return;
      if (result.valid) onApply(normalizeFilter(result.filter));
      setState({ kind: "done", result });
    } catch (err) {
      if (c.signal.aborted) return;
      if (err instanceof DataError && err.reason === "not_found") {
        setState({ kind: "off" });
        return;
      }
      const message =
        err instanceof DataError && err.detail
          ? err.detail
          : err instanceof DataError && err.status === 429
            ? "That's a lot of searches in a row. Try again in a minute, or use the filters below."
            : "Search by description didn't answer. The filters below still work.";
      setState({ kind: "error", message });
    }
  };

  if (state.kind === "off") {
    return (
      <p className={styles.aiOff} role="status">
        Searching by description isn&apos;t switched on right now. Use the filters to narrow the list.
      </p>
    );
  }

  const busy = state.kind === "busy";
  return (
    <section className={`card ${styles.ai}`} aria-labelledby="ai-search-title">
      <form
        role="search"
        className={styles.aiForm}
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
      >
        <label id="ai-search-title" htmlFor="ai-search" className={styles.aiLabel}>
          <span aria-hidden="true">✦</span> Describe what you&apos;re looking for
        </label>
        <div className={styles.aiRow}>
          <input
            id="ai-search"
            type="search"
            value={query}
            maxLength={300}
            placeholder="e.g. slow unexplained objects near the ecliptic"
            onChange={(e) => setQuery(e.target.value)}
            enterKeyHint="search"
            autoComplete="off"
          />
          <button type="submit" className="button button-primary" disabled={busy || !query.trim()}>
            {busy ? "Reading…" : "Search"}
          </button>
        </div>
      </form>

      {state.kind === "idle" && (
        <p className={styles.aiExamples}>
          <span className="muted">Try:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className={styles.aiExample}
              onClick={() => {
                setQuery(ex);
                void run(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </p>
      )}

      <div aria-live="polite">
        {state.kind === "done" && (
          <p className={state.result.valid ? styles.aiResult : styles.aiError}>
            {state.result.valid ? (
              <>
                {state.result.explanation_plain || "Applied as the filters below."}{" "}
                <span className="muted">Edit or remove any chip to change it.</span>
              </>
            ) : (
              state.result.explanation_plain || "We couldn't turn that into a filter. Try rephrasing, or use the filters below."
            )}
          </p>
        )}
        {state.kind === "error" && <p className={styles.aiError}>{state.message}</p>}
      </div>
      {state.kind === "done" && (
        <p className={styles.aiMeta}>
          The AI only chooses filter values; the list itself is our pipeline&apos;s data.
          {state.result.model && (
            <>
              {" "}
              Model: <span className="mono">{state.result.model}</span>
            </>
          )}
        </p>
      )}
    </section>
  );
}
