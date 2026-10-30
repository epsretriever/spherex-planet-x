"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { candidateHref } from "@/components/CandidateCard";
import { ClassificationBadge } from "@/components/ClassificationBadge";
import { QualityMeter } from "@/components/QualityMeter";
import { ErrorState } from "@/components/DataState";
import { Deferred } from "@/components/Deferred";
import { WhenVisible } from "@/components/WhenVisible";
import { ReportSkeleton, ViewerSkeleton } from "@/components/Skeletons";
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
import { formatAgo, formatHours, formatRate } from "@/lib/format";
import type { ObjectName } from "@/lib/names";
import { SITE_NAME } from "@/lib/site";
import { useData } from "@/lib/useData";
import { useObjectNames } from "@/lib/useObjectNames";
import styles from "./CandidateReport.module.css";

const DISCLAIMER =
  "Unmatched candidates may be artifacts, measurement errors, or objects missing from catalogs. This is not a discovery claim.";

/** While JPL is being checked, fetch the report again this often, up to this many times. */
const PENDING_POLL_MS = 6000;
const PENDING_POLL_MAX = 20;

export function CandidateReport() {
  const id = useSearchParams().get("id");
  const state = useData(id ? `candidate:${id}` : null, (signal) => getCandidate(id!, signal));
  const [fresh, setFresh] = useState<CandidateDetail | null>(null);
  const { nameFor } = useObjectNames();
  const shown = fresh && fresh.candidate_id === id ? fresh : state.status === "ok" ? state.data : null;

  useEffect(() => {
    if (shown) document.title = `${nameFor({ candidate_id: shown.candidate_id, classification: shown.classification, designation: shown.known_object.designation }).title} · ${SITE_NAME}`;
  }, [shown, nameFor]);

  // The Worker answers at once and checks JPL in the background; poll until the result lands.
  const pending = shown?.known_object.enrichment === "pending";
  useEffect(() => {
    if (!pending || !id) return;
    const ctrl = new AbortController();
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (tries > PENDING_POLL_MAX) {
        clearInterval(timer);
        return;
      }
      getCandidate(id, ctrl.signal).then(
        (next) => {
          if (next.known_object.enrichment !== "pending") {
            clearInterval(timer);
            setFresh(next);
          }
        },
        () => undefined,
      );
    }, PENDING_POLL_MS);
    return () => {
      clearInterval(timer);
      ctrl.abort();
    };
  }, [pending, id]);

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
  const c = shown ?? state.data;
  return <Report c={c} name={nameFor({ candidate_id: c.candidate_id, classification: c.classification, designation: c.known_object.designation })} nameFor={nameFor} />;
}

function Crumbs() {
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      <Link href="/detective/" prefetch={false}>← All candidates</Link>
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

type NameFor = ReturnType<typeof useObjectNames>["nameFor"];

function Report({ c, name, nameFor }: { c: CandidateDetail; name: ObjectName; nameFor: NameFor }) {
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
          <JplStatus known={c.known_object} />
        </div>
        <h1 className={styles.title}>{name.title}</h1>
        <p className={`mono ${styles.id}`}>
          <span className="visually-hidden">Pipeline ID </span>
          {name.id}
        </p>
        <p className={`lede ${styles.verdict}`}>{c.summary_plain}</p>
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
            <dt>Signal quality</dt>
            <dd>
              <QualityMeter level={c.scores.quality_level} scores={c.scores} />
            </dd>
          </div>
        </dl>
        {(c.classification === "unmatched" || c.classification === "unconfirmed_pair") && (
          <p className={styles.disclaimer} role="note">
            {c.disclaimer || DISCLAIMER}
          </p>
        )}
      </header>

      <SectionNav sections={SECTIONS.filter(([sid]) => present.has(sid))} />

      <Deferred fallback={<ViewerSkeleton label="Loading the evidence" />}>
      <div className={styles.sections}>
        <Panel id="evidence" title="See it move" kicker="Images" intro="The real SPHEREx images where this object was caught, zoomed in on its path.">
          <WhenVisible minHeight={520}>
            <FieldContext candidate={c} />
          </WhenVisible>
          <h3 className={styles.subhead}>Each sighting up close</h3>
          <WhenVisible minHeight={460}>
            <StampStrip detections={c.detections} onSource={openSource} />
          </WhenVisible>
        </Panel>

        <ExplanationPanel candidate={c} />

        <Panel id="measurements" title="Measured positions" kicker="Per sighting" intro="One row per image in which the object was detected. Scroll sideways for every column.">
          <MeasurementTable detections={c.detections} />
        </Panel>

        <WhenVisible minHeight={700}>
          <MotionPanel motion={c.motion} detections={c.detections} />
        </WhenVisible>
        <KnownObjectPanel known={c.known_object} detections={c.detections} />
        <ErrorSourcesPanel errorSources={c.error_sources} vetting={c.vetting} />
        <ScoresPanel scores={c.scores} />
        {c.spectrum && c.spectrum.points.length > 0 && (
          <WhenVisible minHeight={400}>
            <SpectrumPanel spectrum={c.spectrum} />
          </WhenVisible>
        )}
        {c.injection && <InjectionPanel injection={c.injection} />}
        <ProvenancePanel candidate={c} onSource={openSource} />
      </div>

      <WhenVisible minHeight={96}>
        <Neighbors current={c} nameFor={nameFor} />
      </WhenVisible>
      </Deferred>
      <SourceDrawer subject={source} onClose={() => setSource(null)} />
    </div>
  );
}

/** Previous / next candidate in the default list order (highest score first). */
function Neighbors({ current, nameFor }: { current: CandidateDetail; nameFor: NameFor }) {
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
          <span>{nameFor({ candidate_id: prev.candidate_id, classification: prev.classification, designation: prev.known_object_designation }).title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={candidateHref(next.candidate_id)} className={`card ${styles.neighbor} ${styles.next}`}>
          <span className={styles.kicker}>Next →</span>
          <span>{nameFor({ candidate_id: next.candidate_id, classification: next.classification, designation: next.known_object_designation }).title}</span>
        </Link>
      )}
    </nav>
  );
}

/** Where the JPL check stands, from the live known_object block. */
function JplStatus({ known }: { known: CandidateDetail["known_object"] }) {
  const ago = known.query_utc ? formatAgo(known.query_utc) : null;
  let tone: "pending" | "ok" | "warn";
  let text: string;
  if (!known.checked && known.enrichment === "pending") {
    tone = "pending";
    text = "Checking JPL now";
  } else if (!known.checked) {
    tone = "warn";
    text = "JPL check didn't complete";
  } else {
    tone = "ok";
    text = `${known.matched ? "Matched in JPL" : "No JPL match"}${ago ? ` · checked ${ago}` : ""}`;
  }
  return (
    <span role="status" aria-live="polite">
      <a href="#known" className={styles.jpl} data-tone={tone}>
        <span className={styles.jplDot} aria-hidden="true" />
        {text}
      </a>
    </span>
  );
}

/** Sticky jump links that highlight the section being read. */
function SectionNav({ sections }: { sections: readonly (readonly [string, string])[] }) {
  const [active, setActive] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Work out the active section from positions on scroll. Sections mount lazily, so look them
  // up each time rather than observing a fixed set.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.3;
      let current: string | null = null;
      for (const [id] of sections) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections]);

  // Keep the active link in view on narrow screens, where the list scrolls sideways.
  useEffect(() => {
    const link = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    link?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  return (
    <nav className={styles.toc} aria-label="Report sections">
      <ul ref={listRef}>
        {sections.map(([sid, label]) => (
          <li key={sid}>
            <a href={`#${sid}`} aria-current={active === sid ? "true" : undefined}>
              {label}
            </a>
          </li>
        ))}
        <li>
          <a href="#main" className={styles.top}>
            ↑ Top
          </a>
        </li>
      </ul>
    </nav>
  );
}
