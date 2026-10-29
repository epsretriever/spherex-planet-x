"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CandidateCard } from "@/components/CandidateCard";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/DataState";
import { getCandidates } from "@/lib/api";
import type { CandidateSummary, Classification } from "@/lib/contract";
import { CLASSIFICATIONS, CLASSIFICATION_ORDER, isClassification } from "@/lib/labels";
import { useData } from "@/lib/useData";
import styles from "./CandidateBrowser.module.css";

type SortKey = "score" | "rate" | "date";
const SORTS: Record<SortKey, { label: string; cmp: (a: CandidateSummary, b: CandidateSummary) => number }> = {
  score: { label: "Highest score", cmp: (a, b) => b.overall_score - a.overall_score },
  rate: { label: "Fastest", cmp: (a, b) => (b.rate_arcsec_per_hr ?? -1) - (a.rate_arcsec_per_hr ?? -1) },
  date: { label: "Earliest", cmp: (a, b) => a.first_time_utc.localeCompare(b.first_time_utc) },
};
const MIN_SCORES = [0, 0.3, 0.6];
const REAL_CLASSES = CLASSIFICATION_ORDER.filter((c) => c !== "injected");

/** Filters live in the URL so a filtered list can be shared. */
export function CandidateBrowser() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const fieldId = params.get("field") ?? undefined;
  const classes = params.getAll("class").filter(isClassification);
  const minScore = Number(params.get("min") ?? 0) || 0;
  const includeInjected = params.get("sim") === "1";
  const [sort, setSort] = useState<SortKey>("score");

  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const toggleClass = (c: Classification) =>
    update((p) => {
      const set = new Set(p.getAll("class"));
      if (set.has(c)) set.delete(c);
      else set.add(c);
      p.delete("class");
      for (const v of set) p.append("class", v);
    });

  const key = JSON.stringify({ fieldId, classes, minScore, includeInjected });
  const query = {
    field_id: fieldId,
    classification: classes.length ? (includeInjected ? [...classes, "injected" as const] : classes) : undefined,
    min_score: minScore || undefined,
    include_injected: includeInjected,
  };
  const state = useData(`candidates:${key}`, (signal) => getCandidates(query, signal));
  const sorted = useMemo(
    () => (state.status === "ok" ? [...state.data.candidates].sort(SORTS[sort].cmp) : []),
    [state, sort],
  );
  const counts = useMemo(() => {
    const m = new Map<Classification, number>();
    for (const c of sorted) m.set(c.classification, (m.get(c.classification) ?? 0) + 1);
    return m;
  }, [sorted]);

  return (
    <div className={styles.layout}>
      <section className={`card ${styles.filters}`} aria-label="Filters">
        {fieldId && (
          <p className={styles.fieldFilter}>
            Showing one patch of sky: <span className="mono">{fieldId}</span>{" "}
            <button type="button" className={styles.clear} onClick={() => update((p) => p.delete("field"))}>
              Show all
            </button>
          </p>
        )}
        <fieldset className={styles.chips}>
          <legend>Type</legend>
          {REAL_CLASSES.map((c) => (
            <button
              key={c}
              type="button"
              className={styles.chip}
              aria-pressed={classes.includes(c)}
              style={{ ["--c" as string]: `var(${CLASSIFICATIONS[c].cssVar})` }}
              onClick={() => toggleClass(c)}
            >
              <span className={styles.chipIcon} aria-hidden="true">
                {CLASSIFICATIONS[c].icon}
              </span>
              {CLASSIFICATIONS[c].label}
            </button>
          ))}
        </fieldset>
        <div className={styles.row}>
          <label>
            <span className={styles.label}>Minimum score</span>
            <select value={minScore} onChange={(e) => update((p) => (Number(e.target.value) ? p.set("min", e.target.value) : p.delete("min")))}>
              {MIN_SCORES.map((s) => (
                <option key={s} value={s}>
                  {s === 0 ? "Any" : s === 0.3 ? "Medium and up (≥ 0.3)" : "High (≥ 0.6)"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={styles.label}>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={includeInjected} onChange={(e) => update((p) => (e.target.checked ? p.set("sim", "1") : p.delete("sim")))} />
            Show SIMULATED test objects
          </label>
        </div>
        <p className={styles.scoreNote}>
          Scores are a rule-based ranking from motion, signal strength and artifact checks, not a probability.
        </p>
      </section>

      <section aria-live="polite" aria-busy={state.status === "loading"} className={styles.results}>
        {state.status === "loading" && <LoadingBlock label="Loading candidates" height={320} />}
        {state.status === "error" && <ErrorState reason={state.error.reason} message={state.error.message} onRetry={state.retry} />}
        {state.status === "ok" &&
          (sorted.length === 0 ? (
            <EmptyState title="No candidates match">
              <p>Try removing a filter.</p>
            </EmptyState>
          ) : (
            <>
              <p className={styles.count}>
                <span className="mono">{sorted.length}</span> {sorted.length === 1 ? "candidate" : "candidates"}
                {REAL_CLASSES.filter((c) => counts.get(c)).map((c) => (
                  <span key={c} className={styles.countPart}>
                    {counts.get(c)} {CLASSIFICATIONS[c].label.toLowerCase()}
                  </span>
                ))}
                {counts.get("injected") ? <span className={styles.countPart}>{counts.get("injected")} simulated</span> : null}
              </p>
              <ul className={`${styles.list} fade-in`}>
                {sorted.map((c) => (
                  <CandidateCard key={c.candidate_id} c={c} />
                ))}
              </ul>
            </>
          ))}
        <p className={styles.back}>
          <Link href="/explore/">Or go back to blinking the sky yourself →</Link>
        </p>
      </section>
    </div>
  );
}
