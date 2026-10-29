"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { candidateHref } from "@/components/CandidateCard";
import { ClassificationBadge } from "@/components/ClassificationBadge";
import { ErrorState } from "@/components/DataState";
import { ReportSkeleton } from "@/components/Skeletons";
import { ErrorSourcesPanel } from "@/components/report/ErrorSourcesPanel";
import { ExplanationPanel } from "@/components/report/ExplanationPanel";
import { FieldContext } from "@/components/report/FieldContext";
import { InjectionPanel } from "@/components/report/InjectionPanel";
import { KnownObjectPanel } from "@/components/report/KnownObjectPanel";
import { MeasurementTable } from "@/components/report/MeasurementTable";
import { MotionPanel } from "@/components/report/MotionPanel";
import { Panel } from "@/components/report/Panel";
import { ProvenancePanel } from "@/components/report/ProvenancePanel";
import { ScoresPanel } from "@/components/report/ScoresPanel";
import { SpectrumPanel } from "@/components/report/SpectrumPanel";
import { StampStrip } from "@/components/report/StampStrip";
import { SimulatedBanner } from "@/components/SimulatedBanner";
import { SourceDrawer, type SourceSubject } from "@/components/SourceDrawer";
import { getCandidate, getCandidates } from "@/lib/api";
import type { CandidateDetail } from "@/lib/contract";
import { formatHours, formatRate } from "@/lib/format";
import { CLASSIFICATIONS } from "@/lib/labels";
import { SITE_NAME } from "@/lib/site";
import { useData } from "@/lib/useData";
import styles from "./CandidateReport.module.css";

const DISCLAIMER =
  "Unmatched candidates may be artifacts, measurement errors, or objects missing from catalogs. This is not a discovery claim.";

export function CandidateReport() {
  const id = useSearchParams().get("id");
  const state = useData(id ? `candidate:${id}` : null, (signal) => getCandidate(id!, signal));

  useEffect(() => {
    if (state.status === "ok") document.title = `${state.data.candidate_id} · ${SITE_NAME}`;
  }, [state]);

  if (!id) return <ErrorState reason="not_found" />;
  if (state.status === "loading") {
    return (
      <>
        <Crumbs />
        <ReportSkeleton />
      </>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <Crumbs />
        <ErrorState reason={state.error.reason} message={state.error.message} onRetry={state.retry} />
      </>
    );
  }
  return <Report c={state.data} />;
}

function Crumbs() {
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      <Link href="/detective/">← All candidates</Link>
    </nav>
  );
}

const SECTIONS = [
  ["evidence", "Images"],
  ["explanation", "In plain words"],
  ["measurements", "Measurements"],
  ["motion", "Motion"],
  ["known", "Known object"],
  ["errors", "Error sources"],
  ["quality", "Quality"],
  ["spectrum", "Spectrum"],
  ["injection", "Simulated"],
  ["provenance", "Provenance"],
] as const;

function Report({ c }: { c: CandidateDetail }) {
  const [source, setSource] = useState<SourceSubject | null>(null);
  const simulated = c.classification === "injected";
  const openSource = (i: number) => {
    const d = c.detections[i];
    if (!d) return;
    setSource({
      title: `Sighting ${i + 1}`,
      time_utc: d.time_utc,
      mjd: d.mjd,
      wavelength_um_center: d.wavelength_um_center,
      wavelength_um_range: d.wavelength_um_range,
      epoch_id: d.epoch_id,
      source: d.stamp?.source ?? d.source,
    });
  };
  const present = new Set<string>(["evidence", "explanation", "measurements", "motion", "known", "errors", "quality", "provenance"]);
  if (c.spectrum?.points.length) present.add("spectrum");
  if (c.injection) present.add("injection");

  return (
    <div className="fade-in">
      <Crumbs />
      {simulated && (
        <div className={styles.banner}>
          <SimulatedBanner>
            This is a fake object we planted in real SPHEREx images to test our pipeline. It is not a real object in the sky.
          </SimulatedBanner>
        </div>
      )}

      <header className={styles.header}>
        <div className={styles.headerTop}>
          <ClassificationBadge value={c.classification} size="lg" />
          <span className={`mono ${styles.id}`}>{c.candidate_id}</span>
        </div>
        <h1>{c.label_plain}</h1>
        <p className="lede">{c.summary_plain}</p>
        <p className={styles.classNote}>{CLASSIFICATIONS[c.classification]?.plain}</p>
        <dl className={styles.headline}>
          <div>
            <dt>Sightings</dt>
            <dd className="mono">{c.detections.length}</dd>
          </div>
          <div>
            <dt>Tracked over</dt>
            <dd className="mono">{formatHours(c.motion.time_span_hours)}</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd className="mono">{formatRate(c.motion.rate_arcsec_per_hr)}</dd>
          </div>
          <div>
            <dt>Known object</dt>
            <dd className="mono">{!c.known_object.checked ? "not checked" : c.known_object.matched ? (c.known_object.designation ?? "yes") : "no match"}</dd>
          </div>
        </dl>
        {(c.classification === "unmatched" || c.classification === "unconfirmed_pair") && (
          <p className={styles.disclaimer} role="note">
            {c.disclaimer || DISCLAIMER}
          </p>
        )}
      </header>

      <nav className={styles.toc} aria-label="Report sections">
        <ul>
          {SECTIONS.filter(([sid]) => present.has(sid)).map(([sid, label]) => (
            <li key={sid}>
              <a href={`#${sid}`}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <div className={styles.sections}>
        <Panel id="evidence" title="See it move" kicker="Images" intro="The real SPHEREx images where this object was caught, zoomed in on its path.">
          <FieldContext candidate={c} />
          <h3 className={styles.subhead}>Each sighting up close</h3>
          <StampStrip detections={c.detections} onSource={openSource} />
        </Panel>

        <ExplanationPanel candidate={c} />

        <Panel id="measurements" title="Measured positions" kicker="Per sighting" intro="One row per image in which the object was detected. Scroll sideways for every column.">
          <MeasurementTable detections={c.detections} />
        </Panel>

        <MotionPanel motion={c.motion} detections={c.detections} />
        <KnownObjectPanel known={c.known_object} detections={c.detections} />
        <ErrorSourcesPanel errorSources={c.error_sources} vetting={c.vetting} />
        <ScoresPanel scores={c.scores} />
        {c.spectrum && c.spectrum.points.length > 0 && <SpectrumPanel spectrum={c.spectrum} />}
        {c.injection && <InjectionPanel injection={c.injection} />}
        <ProvenancePanel candidate={c} onSource={openSource} />
      </div>

      <Neighbors current={c} />
      <SourceDrawer subject={source} onClose={() => setSource(null)} />
    </div>
  );
}

/** Previous / next candidate in the default list order (highest score first). */
function Neighbors({ current }: { current: CandidateDetail }) {
  const includeInjected = current.classification === "injected";
  const state = useData(`neighbors:${includeInjected}`, (signal) => getCandidates({ include_injected: includeInjected }, signal));
  if (state.status !== "ok") return null;
  const list = [...state.data.candidates].sort((a, b) => b.overall_score - a.overall_score);
  const i = list.findIndex((x) => x.candidate_id === current.candidate_id);
  if (i < 0 || list.length < 2) return null;
  const prev = list[i - 1];
  const next = list[i + 1];
  return (
    <nav className={styles.neighbors} aria-label="Other candidates">
      {prev ? (
        <Link href={candidateHref(prev.candidate_id)} className={`card ${styles.neighbor}`}>
          <span className={styles.kicker}>← Previous</span>
          <span>{prev.label_plain}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={candidateHref(next.candidate_id)} className={`card ${styles.neighbor} ${styles.next}`}>
          <span className={styles.kicker}>Next →</span>
          <span>{next.label_plain}</span>
        </Link>
      )}
    </nav>
  );
}
