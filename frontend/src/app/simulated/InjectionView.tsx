"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { candidateHref } from "@/components/CandidateCard";
import { EmptyState, ErrorState } from "@/components/DataState";
import { StudySkeleton } from "@/components/Skeletons";
import { M50Chart } from "@/components/M50Chart";
import { Panel } from "@/components/report/Panel";
import { RecoveryGrid } from "@/components/RecoveryGrid";
import { findInjectionStudyId, getInjectionStudy } from "@/lib/api";
import type { InjectionStudy } from "@/lib/contract";
import { fmt, formatUtcDateTime } from "@/lib/format";
import { useData } from "@/lib/useData";
import styles from "./InjectionView.module.css";

export function InjectionView() {
  const studyParam = useSearchParams().get("study");
  const state = useData(`injection:${studyParam ?? "auto"}`, async (signal) => {
    const id = studyParam ?? (await findInjectionStudyId(signal));
    return getInjectionStudy(id, signal);
  });

  if (state.status === "loading") return <StudySkeleton />;
  if (state.status === "error") {
    if (state.error.reason === "not_found" && !studyParam) {
      return (
        <EmptyState title="No injection test published yet">
          <p>Results will appear here once the pipeline&apos;s injection-recovery run is published.</p>
        </EmptyState>
      );
    }
    return <ErrorState reason={state.error.reason} message={state.error.message} onRetry={state.retry} />;
  }
  return <Study s={state.data} />;
}

function Study({ s }: { s: InjectionStudy }) {
  const fp = s.false_positives;
  const overall = s.n_injected ? s.n_recovered / s.n_injected : 0;
  const best = s.m50_by_rate.filter((m) => m.m50_ab !== null).sort((a, b) => b.m50_ab! - a.m50_ab!)[0];

  return (
    <div className={`${styles.stack} fade-in`}>
      <dl className={styles.big}>
        <div>
          <dt>Planted</dt>
          <dd className="mono">{s.n_injected.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Found</dt>
          <dd className="mono">
            {s.n_recovered.toLocaleString("en-US")} <small>({Math.round(overall * 100)}%)</small>
          </dd>
        </div>
        <div>
          <dt>Faintest found half the time</dt>
          <dd className="mono">
            {best ? (
              <>
                AB {fmt(best.m50_ab, 1)} <small>at {best.rate_arcsec_per_hr}″/hr</small>
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt>False alarms</dt>
          <dd className="mono">
            {fmt(fp.rate_per_deg2, 1)} <small>per deg²</small>
          </dd>
        </div>
      </dl>

      <Panel
        id="grid"
        title="What we found, by brightness and speed"
        kicker="Recovery"
        intro="Each square is a group of planted objects with the same brightness (rows; bigger AB numbers are fainter) and speed (columns). Brighter colors mean more were found."
      >
        <RecoveryGrid study={s} />
      </Panel>

      <div className={styles.two}>
        <Panel id="m50" title="How faint can we go?" kicker="Half-recovery depth">
          <M50Chart m50={s.m50_by_rate} />
        </Panel>
        <Panel id="false-positives" title="False alarms" kicker="Control fields">
          <p className={styles.fpBig}>
            <span className="mono">{fmt(fp.rate_per_deg2, 1)}</span> per square degree
          </p>
          <p className="muted">
            In {fp.n_control_runs} control {fp.n_control_runs === 1 ? "run" : "runs"} covering {fmt(fp.area_deg2, 2)} deg² with nothing
            planted, the pipeline still flagged {fp.n_candidates} {fp.n_candidates === 1 ? "candidate" : "candidates"}. 95% interval:{" "}
            {fmt(fp.ci_low_per_deg2, 1)}–{fmt(fp.ci_high_per_deg2, 1)} per deg².
          </p>
          <p className="muted">
            This is why an &ldquo;Unexplained&rdquo; candidate is a lead to check, not a discovery.
          </p>
        </Panel>
      </div>

      <Panel id="method" title="How the test works" kicker="Method">
        <p className={styles.criteria}>
          <strong>Counted as found when:</strong> {s.recovery_criteria}
        </p>
        {s.method_notes.length > 0 && (
          <ul className={styles.notes}>
            {s.method_notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        {s.example_candidate_ids.length > 0 && (
          <>
            <h3 className={styles.subhead}>See a planted object being recovered</h3>
            <ul className={styles.examples}>
              {s.example_candidate_ids.map((id) => (
                <li key={id}>
                  <Link href={candidateHref(id)} className="button">
                    <span className={styles.simTag}>SIMULATED</span> {id} →
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className={`mono ${styles.meta}`}>
          Study {s.study_id} · {s.field_ids.length} {s.field_ids.length === 1 ? "field" : "fields"} · generated {formatUtcDateTime(s.generated_utc)} ·
          pipeline {s.pipeline_version}
        </p>
      </Panel>
    </div>
  );
}
