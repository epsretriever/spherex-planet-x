"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CandidateCard } from "@/components/CandidateCard";
import { EmptyState, ErrorState } from "@/components/DataState";
import { CardListSkeleton } from "@/components/Skeletons";
import { getCandidates, getFields, getObjects } from "@/lib/api";
import type { CandidateFilter, Classification, DistanceClass } from "@/lib/contract";
import {
  DISTANCE_LABELS,
  DISTANCE_ORDER,
  EMPTY_FILTER,
  SORT_LABELS,
  applyFilter,
  filterChips,
  filterFromParams,
  filterToParams,
  hasAnomalyScores,
  needsDistance,
  sortAvailable,
  type SortKey,
} from "@/lib/filter";
import { CLASSIFICATIONS, CLASSIFICATION_ORDER } from "@/lib/labels";
import { useData } from "@/lib/useData";
import { useObjectNames } from "@/lib/useObjectNames";
import { AiSearchBar } from "./AiSearchBar";
import styles from "./CandidateBrowser.module.css";

const MIN_SCORES = [0, 0.3, 0.6];
const REAL_CLASSES = CLASSIFICATION_ORDER.filter((c) => c !== "injected");

/** Filters live in the URL so a filtered list can be shared. */
export function CandidateBrowser() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filter = useMemo(() => filterFromParams(new URLSearchParams(params.toString())), [params]);
  const { nameFor } = useObjectNames();

  const apply = (next: CandidateFilter) => {
    const qs = filterToParams(next, new URLSearchParams(params.toString())).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const toggleClass = (c: Classification) =>
    apply({ ...filter, classification: filter.classification.includes(c) ? filter.classification.filter((x) => x !== c) : [...filter.classification, c] });
  const toggleDistance = (d: DistanceClass) =>
    apply({ ...filter, distance_class: filter.distance_class.includes(d) ? filter.distance_class.filter((x) => x !== d) : [...filter.distance_class, d] });

  // Everything is filtered here, so one request serves every filter combination.
  const state = useData(`candidates:${filter.include_injected}`, (signal) => getCandidates({ include_injected: filter.include_injected }, signal));
  // Distance classes are on objects, not candidates; fetch them only when that filter is on.
  const objects = useData(needsDistance(filter) ? "objects" : null, (signal) => getObjects(signal));
  const fields = useData(filter.field_id.length ? "fields" : null, (signal) => getFields(signal));
  const distanceOf = useMemo(() => {
    if (objects.status !== "ok") return undefined;
    const m = new Map<string, DistanceClass>();
    for (const o of objects.data.objects) for (const id of o.candidate_ids) m.set(id, o.distance_class);
    return (id: string) => m.get(id);
  }, [objects]);
  const fieldName = (id: string) => (fields.status === "ok" ? fields.data.fields.find((f) => f.field_id === id)?.name : undefined) ?? id;

  const distancePending = needsDistance(filter) && objects.status === "loading";
  const sorted = useMemo(
    () => (state.status === "ok" && !distancePending ? applyFilter(state.data.candidates, filter, distanceOf) : []),
    [state, filter, distanceOf, distancePending],
  );
  const counts = useMemo(() => {
    const m = new Map<Classification, number>();
    for (const c of sorted) m.set(c.classification, (m.get(c.classification) ?? 0) + 1);
    return m;
  }, [sorted]);
  const hasAnomaly = state.status === "ok" && hasAnomalyScores(state.data.candidates);
  const sorts = (Object.keys(SORT_LABELS) as SortKey[]).filter((k) => sortAvailable(k, hasAnomaly));
  const chips = filterChips(filter, fieldName, hasAnomaly);
  const loading = state.status === "loading" || distancePending;

  return (
    <>
    <AiSearchBar onApply={apply} />
    <div className={styles.layout}>
      <section className={`card ${styles.filters}`} aria-label="Filters">
        <fieldset className={styles.chips}>
          <legend>Type</legend>
          {REAL_CLASSES.map((c) => (
            <button
              key={c}
              type="button"
              className={styles.chip}
              aria-pressed={filter.classification.includes(c)}
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
        <SpeedRange
          key={`${filter.rate_min_arcsec_per_hr}:${filter.rate_max_arcsec_per_hr}`}
          min={filter.rate_min_arcsec_per_hr}
          max={filter.rate_max_arcsec_per_hr}
          onChange={(lo, hi) => apply({ ...filter, rate_min_arcsec_per_hr: lo, rate_max_arcsec_per_hr: hi })}
        />
        <details className={styles.more} open={filter.distance_class.length > 0 || undefined}>
          <summary>How far away</summary>
          <fieldset className={styles.chips}>
            <legend className="visually-hidden">Distance from the Sun</legend>
            {DISTANCE_ORDER.map((d) => (
              <button
                key={d}
                type="button"
                className={styles.chip}
                aria-pressed={filter.distance_class.includes(d)}
                style={{ ["--c" as string]: "var(--cool)" }}
                onClick={() => toggleDistance(d)}
              >
                {DISTANCE_LABELS[d]}
              </button>
            ))}
          </fieldset>
          <p className={styles.scoreNote}>From each object&apos;s measured distance. Most are not measured yet.</p>
        </details>
        <div className={styles.row}>
          <label>
            <span className={styles.label}>Minimum score</span>
            <select
              value={MIN_SCORES.includes(filter.min_score ?? 0) ? (filter.min_score ?? 0) : "custom"}
              onChange={(e) => apply({ ...filter, min_score: Number(e.target.value) || null })}
            >
              {!MIN_SCORES.includes(filter.min_score ?? 0) && <option value="custom">≥ {filter.min_score}</option>}
              {MIN_SCORES.map((s) => (
                <option key={s} value={s}>
                  {s === 0 ? "Any" : s === 0.3 ? "Medium and up (≥ 0.3)" : "High (≥ 0.6)"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={styles.label}>Sort</span>
            <select value={sortAvailable(filter.sort, hasAnomaly) ? filter.sort : "score"} onChange={(e) => apply({ ...filter, sort: e.target.value as SortKey })}>
              {sorts.map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={filter.include_injected} onChange={(e) => apply({ ...filter, include_injected: e.target.checked })} />
            Show SIMULATED test objects
          </label>
        </div>
        <p className={styles.scoreNote}>
          Scores are a rule-based ranking from motion, signal strength and artifact checks, not a probability.
        </p>
      </section>

      <section aria-live="polite" aria-busy={loading} className={styles.results}>
        {chips.length > 0 && (
          <div className={styles.active}>
            <h2 className="visually-hidden">Active filters</h2>
            <ul className={styles.activeList}>
              {chips.map((chip) => (
                <li key={chip.key}>
                  <button type="button" className={styles.activeChip} onClick={() => apply(chip.without)} aria-label={`Remove filter: ${chip.label}`}>
                    {chip.label}
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
            {chips.length > 1 && (
              <button type="button" className={styles.clear} onClick={() => apply(EMPTY_FILTER)}>
                Clear all
              </button>
            )}
          </div>
        )}
        {needsDistance(filter) && objects.status === "error" && (
          <p className={styles.scoreNote} role="note">
            Distances couldn&apos;t be loaded, so the distance filter can&apos;t be applied right now.
          </p>
        )}
        {loading && state.status !== "error" && <CardListSkeleton label="Loading candidates" />}
        {state.status === "error" &&
          (state.error.reason === "not_found" ? (
            // The Worker answers 404 until the pipeline publishes a candidate list.
            <EmptyState title="No candidates published yet">
              <p>Once our pipeline finishes analyzing a patch of sky, every moving object it flags will appear here.</p>
            </EmptyState>
          ) : (
            <ErrorState reason={state.error.reason} message={state.error.message} onRetry={state.retry} />
          ))}
        {state.status === "ok" &&
          !distancePending &&
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
                  <CandidateCard
                    key={c.candidate_id}
                    c={c}
                    reason={filter.sort === "unusual" ? c.anomaly_reason : null}
                    name={nameFor({ candidate_id: c.candidate_id, classification: c.classification, designation: c.known_object_designation })}
                  />
                ))}
              </ul>
            </>
          ))}
        <p className={styles.back}>
          <Link href="/explore/">Or go back to blinking the sky yourself →</Link>
        </p>
      </section>
    </div>
    </>
  );
}

/** Speed range in arcseconds per hour; applied when a box loses focus or on Enter. */
function SpeedRange({ min, max, onChange }: { min: number | null; max: number | null; onChange: (lo: number | null, hi: number | null) => void }) {
  const [lo, setLo] = useState(min === null ? "" : String(min));
  const [hi, setHi] = useState(max === null ? "" : String(max));
  const parse = (v: string) => {
    const n = Number(v);
    return v.trim() === "" || !Number.isFinite(n) || n < 0 ? null : n;
  };
  const commit = () => {
    let a = parse(lo);
    let b = parse(hi);
    if (a !== null && b !== null && a > b) [a, b] = [b, a];
    if (a !== min || b !== max) onChange(a, b);
  };
  return (
    <fieldset className={styles.speed}>
      <legend>Speed (″ per hour)</legend>
      <form
        className={styles.speedRow}
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
      >
        <label>
          <span className="visually-hidden">Slowest, arcseconds per hour</span>
          <input type="number" inputMode="decimal" min={0} step="any" placeholder="Any" value={lo} onChange={(e) => setLo(e.target.value)} onBlur={commit} />
        </label>
        <span aria-hidden="true">to</span>
        <label>
          <span className="visually-hidden">Fastest, arcseconds per hour</span>
          <input type="number" inputMode="decimal" min={0} step="any" placeholder="Any" value={hi} onChange={(e) => setHi(e.target.value)} onBlur={commit} />
        </label>
        <button type="submit" className="visually-hidden">Apply speed</button>
      </form>
    </fieldset>
  );
}
