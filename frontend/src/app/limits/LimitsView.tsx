"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { candidateHref } from "@/components/CandidateCard";
import { EmptyState, ErrorState } from "@/components/DataState";
import { StudySkeleton } from "@/components/Skeletons";
import { M50Chart } from "@/components/M50Chart";
import { CompositionValidationPanel } from "@/components/composition/CompositionValidationPanel";
import { Panel } from "@/components/report/Panel";
import { RecoveryGrid } from "@/components/RecoveryGrid";
import { findInjectionStudyId, getInjectionStudy } from "@/lib/api";
import { fmt, formatUtcDateTime } from "@/lib/format";
import { useData } from "@/lib/useData";
import { WhenVisible } from "@/components/WhenVisible";
import {
  ASTEROID_RATES,
  BRIGHT_MAX_AB,
  blindSpeeds,
  falseAlarms,
  hopelessMags,
  limitsSentence,
  nearestTooSlowDistance,
  PLANET_VERDICT_TEXT,
  planetVerdict,
  poolRecovery,
  sigFig,
  speedAtDistance,
  type LimitsStudy,
} from "@/lib/limits";
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

const rateText = (r: number) => `${r}″/hr`;
const range = (xs: number[], f: (x: number) => string = String) =>
  xs.length === 0 ? "" : xs.length === 1 ? f(xs[0]!) : `${f(xs[0]!)}–${f(xs[xs.length - 1]!)}`;
const speedRange = (xs: number[]) => `${range(xs)}″/hr`;
const pct = (f: number) => `${Math.round(f * 100)}%`;
const n0 = (n: number) => n.toLocaleString("en-US");

function Study({ s }: { s: LimitsStudy }) {
  const overall = s.n_injected ? s.n_recovered / s.n_injected : 0;
  const best = s.m50_by_rate.filter((m) => m.m50_ab !== null).sort((a, b) => b.m50_ab! - a.m50_ab!)[0];
  const core = poolRecovery(s, BRIGHT_MAX_AB, ...ASTEROID_RATES.core);
  const wide = poolRecovery(s, BRIGHT_MAX_AB, ...ASTEROID_RATES.wide);
  const fa = falseAlarms(s);
  const faint = hopelessMags(s);
  const blind = blindSpeeds(s);
  const tooSlowAu = nearestTooSlowDistance(s);
  const area = sigFig(fa.area_deg2, 4);
  const causeList = [
    faint.length > 0 && `too faint (AB ${range(faint, (m) => fmt(m, 1))})`,
    blind.slowNeverHalf.length > 0 && `too slow (${speedRange(blind.slowNeverHalf)})`,
    blind.fastNeverHalf.length > 0 && `very fast (${speedRange(blind.fastNeverHalf)})`,
  ].filter((c): c is string => Boolean(c));
  const causes = causeList.length > 1 ? `${causeList.slice(0, -1).join(", ")} and ${causeList[causeList.length - 1]}` : (causeList[0] ?? "");

  return (
    <div className={`${styles.stack} fade-in`}>
      <dl className={styles.big}>
        {core && (
          <div className={styles.lead}>
            <dt>Bright objects at asteroid-like speeds</dt>
            <dd className="mono">
              {pct(core.fraction)} <small>found</small>
            </dd>
            <dd className={styles.sub}>
              AB ≤ {fmt(core.mag_max, 0)} moving {speedRange(core.rates)} ·{" "}
              {core.cell_min === core.cell_max
                ? pct(core.cell_min)
                : `${Math.round(core.cell_min * 100)}–${pct(core.cell_max)}`} in each test cell
            </dd>
          </div>
        )}
        <div>
          <dt>False alarms</dt>
          <dd className="mono">
            {n0(fa.count)} <small>false {fa.count === 1 ? "candidate" : "candidates"}</small>
          </dd>
          <dd className={styles.sub}>in {area} deg² of empty control fields</dd>
        </div>
        <div>
          <dt>Depth (m₅₀): faintest found half the time</dt>
          <dd className="mono">{best ? <>AB {fmt(best.m50_ab, 1)}</> : "—"}</dd>
          {best && <dd className={styles.sub}>best case, at {rateText(best.rate_arcsec_per_hr)}</dd>}
        </div>
        <div>
          <dt>Test size</dt>
          <dd className="mono">{n0(s.n_injected)}</dd>
          <dd className={styles.sub}>simulated objects planted</dd>
        </div>
      </dl>

      <p className={styles.overall}>
        <strong>About the overall number:</strong> across the whole stress-test grid, {n0(s.n_recovered)} of {n0(s.n_injected)} planted
        objects ({pct(overall)}) were recovered. That average is not an accuracy score
        {causes.length > 0 ? <>, because the grid deliberately includes cells this setup can&apos;t detect: {causes}.</> : "."}
        {wide && core && wide.rates.length > core.rates.length && (
          <>
            {" "}
            Counting bright objects across {speedRange(wide.rates)} instead gives {pct(wide.fraction)}.
          </>
        )}
      </p>

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
        {blind.slowNeverHalf.length > 0 && (
          <div className={styles.slowNote} role="note">
            <p>
              <strong>Why the slowest columns are 0%.</strong> Objects creeping at {range(blind.slowNeverHalf)}″/hr, the speeds of a distant
              Planet X–like body{tooSlowAu !== null ? ` (about ${tooSlowAu} AU or farther)` : ""}, barely move during the ~1.5 days of visits this
              test links together, so the pipeline can&apos;t tell them apart from fixed stars. They are below what this 1.5-day linking
              setup can see, at any brightness. Catching them needs images spread over weeks or months.
            </p>
          </div>
        )}
      </Panel>

      <div className={styles.two}>
        <Panel id="m50" title="How faint can we go?" kicker="Half-recovery depth">
          <M50Chart points={s.m50_by_rate.map((r) => ({ x: r.rate_arcsec_per_hr, m50_ab: r.m50_ab }))} xLabel="speed" unit="″/h" />
        </Panel>
        <Panel id="false-positives" title="False alarms" kicker="Control fields">
          <p className={styles.fpBig}>
            <span className="mono">{n0(fa.count)}</span> false {fa.count === 1 ? "candidate" : "candidates"} in {area} deg²
          </p>
          <p className="muted">
            We ran the pipeline {n0(s.false_positives.n_control_runs)} {s.false_positives.n_control_runs === 1 ? "time" : "times"} on{" "}
            {area} deg² of real images with nothing planted. It flagged {n0(fa.count)}{" "}
            {fa.count === 1 ? "track" : "tracks"} that matched no known object: about {sigFig(fa.rate_per_deg2, 2)} per deg². 95%
            interval (Poisson, for the count): {sigFig(fa.count_ci[0], 2)}–{sigFig(fa.count_ci[1], 2)}{" "}
            {fa.count_ci[1] === 1 ? "candidate" : "candidates"}, or {sigFig(fa.per_deg2_ci[0], 2)}–{sigFig(fa.per_deg2_ci[1], 2)} per deg².
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

      {s.planet_context && s.planet_context.rows.length > 0 && <PlanetContext s={s} context={s.planet_context} />}

      <WhenVisible minHeight={420}>
        <CompositionValidationPanel />
      </WhenVisible>

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

function PlanetContext({ s, context }: { s: LimitsStudy; context: NonNullable<LimitsStudy["planet_context"]> }) {
  const a = context.assumptions;
  const rows = context.rows.map((r) => ({ ...r, speed: speedAtDistance(s, r.distance_au), verdict: planetVerdict(s, r) }));
  const anySpeed = rows.some((r) => r.speed !== null);
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
              {anySpeed && <th scope="col">Apparent speed</th>}
              <th scope="col">Our m₅₀</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.distance_au}>
                <td className="mono">{r.distance_au} AU</td>
                <td className="mono">
                  AB {fmt(r.predicted_mag_ab, 1)}
                  {r.band_um ? ` at ${r.band_um} µm` : ""}
                </td>
                {anySpeed && <td className="mono">{r.speed === null ? "—" : `${sigFig(r.speed, 2)}″/hr`}</td>}
                <td className="mono">{r.m50_ab === null ? "n/a" : `AB ${fmt(r.m50_ab, 1)}`}</td>
                <td data-verdict={r.verdict}>{PLANET_VERDICT_TEXT[r.verdict]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.verdict === "too_slow") && (
        <p className="muted" style={{ marginTop: "var(--space-3)" }}>
          &ldquo;n/a&rdquo; means no brightness reached 50% recovery at that distance. Out there a planet drifts so slowly across the
          sky that this short linking window can&apos;t see it move, however bright it is, so these rows say nothing about whether a
          planet is there.
        </p>
      )}
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
