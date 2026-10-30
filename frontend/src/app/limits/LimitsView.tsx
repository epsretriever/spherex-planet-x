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
import { fmt, formatUtcDateTime } from "@/lib/format";
import { useData } from "@/lib/useData";
import { limitsSentence, type LimitsStudy } from "@/lib/limits";
import styles from "./LimitsView.module.css";

export function LimitsView() {
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
  return <Study s={state.data as LimitsStudy} />;
}

function Study({ s }: { s: LimitsStudy }) {
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

      <section className={`card ${styles.summary}`} aria-labelledby="limits-summary">
        <h2 id="limits-summary">In one sentence</h2>
        <p>{limitsSentence(s)}</p>
        <p className="muted">
          Magnitudes measure brightness: bigger numbers are fainter, and each step of 1 is about 2.5 times fainter. A distant planet
          would be both faint and slow, so the bottom-left of the grid below is where it could hide.
        </p>
      </section>

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
          <M50Chart points={s.m50_by_rate.map((r) => ({ x: r.rate_arcsec_per_hr, m50_ab: r.m50_ab }))} xLabel="speed" unit="″/h" />
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

      {s.m50_by_distance && s.m50_by_distance.length > 0 && (
        <Panel id="m50-distance" title="How far away can we see?" kicker="Half-recovery depth by distance">
          <M50Chart points={s.m50_by_distance.map((d) => ({ x: d.distance_au, m50_ab: d.m50_ab }))} xLabel="distance" unit="AU" />
        </Panel>
      )}

      {s.planet_context && s.planet_context.rows.length > 0 && <PlanetContext context={s.planet_context} />}

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

function PlanetContext({ context }: { context: NonNullable<LimitsStudy["planet_context"]> }) {
  const a = context.assumptions;
  const VERDICT = { detected: "Would be found", missed: "Could be missed", not_tested: "Not tested" } as const;
  return (
    <Panel
      id="planet"
      title="Could we have seen a planet?"
      kicker="Brightness context"
      intro="How bright a planet would look at each distance, compared with how faint we can see. These are predictions from the assumptions below, not observations."
    >
      <div className={styles.tableWrap} role="region" aria-label="Planet brightness by distance" tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Distance</th>
              <th scope="col">Predicted brightness</th>
              <th scope="col">Our m₅₀</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {context.rows.map((r) => (
              <tr key={r.distance_au}>
                <td className="mono">{r.distance_au} AU</td>
                <td className="mono">
                  AB {fmt(r.predicted_mag_ab, 1)}
                  {r.band_um ? ` at ${r.band_um} µm` : ""}
                </td>
                <td className="mono">{r.m50_ab === null ? "n/a" : `AB ${fmt(r.m50_ab, 1)}`}</td>
                <td data-verdict={r.verdict}>{VERDICT[r.verdict]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className={styles.assumptions}>
        <div>
          <dt>Diameter</dt>
          <dd className="mono">{a.diameter_km.toLocaleString("en-US")} km</dd>
        </div>
        <div>
          <dt>Albedo</dt>
          <dd className="mono">{a.geometric_albedo}</dd>
        </div>
        {a.phase_function && (
          <div>
            <dt>Phase function</dt>
            <dd>{a.phase_function}</dd>
          </div>
        )}
        {a.thermal_model && (
          <div>
            <dt>Thermal model</dt>
            <dd>{a.thermal_model}</dd>
          </div>
        )}
        {a.reference && (
          <div>
            <dt>Reference</dt>
            <dd>{a.reference}</dd>
          </div>
        )}
      </dl>
    </Panel>
  );
}
