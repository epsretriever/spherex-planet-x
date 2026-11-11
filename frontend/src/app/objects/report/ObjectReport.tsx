"use client";

import { PageGuide } from "@/components/PageGuide";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FollowUpDownloads } from "@/components/followup/FollowUpDownloads";
import { ObjectActions } from "@/components/object/ObjectActions";
import { DistancePanel } from "@/components/object/DistancePanel";
import objectStyles from "@/components/object/Object.module.css";
import { VisitsPanel } from "@/components/object/VisitsPanel";
import { OrbitPanel } from "@/components/orbit/OrbitPanel";
import { candidateHref, objectHref } from "@/lib/routes";
import { JplLinksRow } from "@/components/JplLinks";
import { ClassificationBadge } from "@/components/ClassificationBadge";
import { QualityMeter } from "@/components/QualityMeter";
import { ErrorState } from "@/components/DataState";
import { Deferred } from "@/components/Deferred";
import { Seen, WhenVisible } from "@/components/WhenVisible";
import { ReportSkeleton, ViewerSkeleton } from "@/components/Skeletons";
import { AskPanel } from "@/components/report/AskPanel";
import { CompositionPanel } from "@/components/report/CompositionPanel";
import { ErrorSourcesPanel } from "@/components/report/ErrorSourcesPanel";
import { ExplanationPanel } from "@/components/report/ExplanationPanel";
import { FieldContext } from "@/components/report/FieldContext";
import { InjectionPanel } from "@/components/report/InjectionPanel";
import { KnownObjectPanel } from "@/components/report/KnownObjectPanel";
import { MeasurementTable } from "@/components/report/MeasurementTable";
import { MotionPanel } from "@/components/report/MotionPanel";
import { NeoPanel } from "@/components/report/NeoPanel";
import { Panel } from "@/components/report/Panel";
import { ProvenancePanel } from "@/components/report/ProvenancePanel";
import { ScoresPanel } from "@/components/report/ScoresPanel";
import { SpectrumPanel } from "@/components/report/SpectrumPanel";
import { StampStrip } from "@/components/report/StampStrip";
import { UnusualPanel } from "@/components/report/UnusualPanel";
import { SimulatedBanner } from "@/components/SimulatedBanner";
import { SourceDrawer, type SourceSubject } from "@/components/SourceDrawer";
import { USE_FIXTURES, getCandidate, getCandidates, getFields, getObject, getWriteup } from "@/lib/api";
import type { CandidateDetail, ObjectDetail } from "@/lib/contract";
import { formatAgo, formatHours, formatRate, formatUtcDateTime } from "@/lib/format";
import { DISTANCE_CLASSES, ORBIT_STATUS, groupVisits } from "@/lib/objects";
import type { ObjectName } from "@/lib/names";
import { SITE_NAME } from "@/lib/site";
import { useData } from "@/lib/useData";
import { useObjectNames, type NameSeed } from "@/lib/useObjectNames";
import styles from "./ObjectReport.module.css";

const DISCLAIMER =
  "Unmatched candidates may be artifacts, measurement errors, or objects missing from catalogs. This is not a discovery claim.";

/** While JPL is being checked, fetch the report again this often, up to this many times. */
const PENDING_POLL_MS = 6000;
const PENDING_POLL_MAX = 20;

/**
 * The one report page for an object (/objects/{object_id}/): the evidence for its sighting (images,
 * measurements, checks, AI write-up) and, once the object record loads, its visits, orbit,
 * distance and history. `initial` / `initialObject` are the records as published when the site
 * was built; they render at once and are replaced by the live API answers (with JPL results).
 * Simulated (injected) candidates have no object record and show the evidence alone.
 */
export function ObjectReport({
  id,
  objectId,
  initial,
  initialObject,
  seed,
}: {
  /** The candidate (sighting) whose evidence is shown. */
  id: string | null;
  objectId?: string | null;
  initial?: CandidateDetail | null;
  initialObject?: ObjectDetail | null;
  seed?: NameSeed;
}) {
  const state = useData(id ? `candidate:${id}` : null, (signal) => getCandidate(id!, signal));
  const objState = useData(objectId ? `object:${objectId}` : null, (signal) => getObject(objectId!, signal));
  const obj = objState.status === "ok" ? objState.data : (initialObject ?? null);
  const [fresh, setFresh] = useState<CandidateDetail | null>(null);
  const { nameFor } = useObjectNames(seed);
  const shown =
    fresh && fresh.candidate_id === id ? fresh : state.status === "ok" ? state.data : (initial ?? null);

  useEffect(() => {
    if (shown && (!initial || shown !== initial)) document.title = `${nameFor({ candidate_id: shown.candidate_id, classification: shown.classification, designation: shown.known_object.designation }).title} · ${SITE_NAME}`;
  }, [shown, nameFor, initial]);

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
  if (!shown && state.status === "loading") {
    return (
      <>
        <Crumbs />
        <ReportSkeleton />
      </>
    );
  }
  if (!shown && state.status === "error") {
    return (
      <>
        <Crumbs />
        <ErrorState reason={state.error.reason} message={state.error.message} onRetry={state.retry} />
      </>
    );
  }
  const c = shown!;
  return (
    <Report
      c={c}
      o={obj && obj.object_id === objectId ? obj : null}
      name={nameFor({ candidate_id: c.candidate_id, classification: c.classification, designation: c.known_object.designation })}
      nameFor={nameFor}
    />
  );
}

function Crumbs() {
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      <Link href="/objects/" prefetch={false}>← All objects</Link>
    </nav>
  );
}

const SECTIONS = [
  ["evidence", "Images"],
  ["visits", "Visits"],
  ["orbit", "Orbit"],
  ["distance", "Distance"],
  ["explanation", "In plain words"],
  ["ask", "Ask"],
  ["measurements", "Measurements"],
  ["motion", "Motion"],
  ["known", "Known object"],
  ["neo", "Orbit odds"],
  ["errors", "Error sources"],
  ["quality", "Quality"],
  ["unusual", "Unusual"],
  ["spectrum", "Spectrum"],
  ["composition", "Made of"],
  ["injection", "Simulated"],
  ["provenance", "Provenance"],
  ["history", "History"],
] as const;

type NameFor = ReturnType<typeof useObjectNames>["nameFor"];

function Report({ c, o, name, nameFor }: { c: CandidateDetail; o: ObjectDetail | null; name: ObjectName; nameFor: NameFor }) {
  const [source, setSource] = useState<SourceSubject | null>(null);
  // The AI write-up is fetched when the reader nears it, so it never competes with the first screen.
  const [wantWriteup, setWantWriteup] = useState(false);
  // While JPL is pending the API returns template text uncached; fetch again once the check lands.
  const writeup = useData(wantWriteup && !USE_FIXTURES ? `writeup:${c.candidate_id}:${c.known_object.enrichment === "pending"}` : null, (signal) =>
    getWriteup("candidate", c.candidate_id, signal),
  );
  const aiReady = writeup.status === "ok";
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
  // The ranking is published on the object; older data carried it on the sighting.
  const anomaly = o?.anomaly ?? c.anomaly ?? null;
  const present = new Set<string>(["evidence", "explanation", "measurements", "motion", "known", "errors", "quality", "provenance"]);
  if (c.spectrum?.points.length) present.add("spectrum");
  if (c.injection) present.add("injection");
  if (c.neo_likelihood) present.add("neo");
  if (anomaly) present.add("unusual");
  // Ask appears once the write-up answered, which shows the AI endpoints are live.
  if (aiReady) present.add("ask");
  if (o) for (const s of ["visits", "orbit", "distance", "history"]) present.add(s);
  if (o && c.spectrum?.points.length) present.add("composition");
  const visits = o ? groupVisits(o.detections) : null;
  const dist = o ? (DISTANCE_CLASSES[o.distance_class] ?? DISTANCE_CLASSES.unknown) : null;
  const unidentified = c.classification !== "known_object" && c.classification !== "injected";

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
        <PageGuide>One object&apos;s full report: the images, the measurements, the JPL check and what could make it wrong.</PageGuide>
        <div className={styles.headerTop}>
          <ClassificationBadge value={c.classification} size="lg" />
          <JplStatus known={c.known_object} />
        </div>
        <h1 className={styles.title}>{name.title}</h1>
        <JplLinksRow matched={c.known_object.matched} designation={c.known_object.designation} published={c.known_object.jpl_links} />
        <p className={`mono ${styles.id}`}>
          <span className="visually-hidden">{o ? "Object ID " : "Pipeline ID "}</span>
          {o ? o.object_id : name.id}
        </p>
        <p className={`lede ${styles.verdict}`}>{c.summary_plain}</p>
        <dl className={styles.headline}>
          <div>
            <dt>Sightings</dt>
            <dd className="mono">{c.detections.length}</dd>
          </div>
          {visits && (
            <div>
              <dt>Visits</dt>
              <dd className="mono">{visits.length}</dd>
            </div>
          )}
          <div>
            <dt>Tracked over</dt>
            <dd className="mono">{formatHours(c.motion.time_span_hours)}</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd className="mono">{formatRate(c.motion.rate_arcsec_per_hr)}</dd>
          </div>
          {o && dist && (
            <>
              <div>
                <dt>Where</dt>
                <dd>{dist.label}</dd>
              </div>
              <div>
                <dt>Orbit</dt>
                <dd>{ORBIT_STATUS[o.orbit_status]}</dd>
              </div>
            </>
          )}
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
        {o && <ObjectActions objectId={o.object_id} title={name.title} simulated={c.classification === "injected"} />}
        {unidentified && o && <FollowUpDownloads objectId={o.object_id} candidateId={c.candidate_id} />}
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
          <Seen onSeen={() => setWantWriteup(true)} />
        </Panel>

        {o && <ObjectPanels o={o} title={name.title} />}

        <ExplanationPanel candidate={c} writeup={aiReady ? writeup.data : null} />
        {aiReady && <AskPanel subjectKind="candidate" subjectId={c.candidate_id} doc={c} />}

        <Panel id="measurements" title="Measured positions" kicker="Per sighting" intro="One row per image in which the object was detected. Scroll sideways for every column.">
          <MeasurementTable detections={c.detections} />
        </Panel>

        <WhenVisible minHeight={700}>
          <MotionPanel motion={c.motion} detections={c.detections} />
        </WhenVisible>
        <KnownObjectPanel known={c.known_object} detections={c.detections} minimal={c.record_level === "minimal"} />
        {c.neo_likelihood && <NeoPanel neo={c.neo_likelihood} />}
        <ErrorSourcesPanel errorSources={c.error_sources} vetting={c.vetting} />
        <ScoresPanel scores={c.scores} />
        {anomaly && <UnusualPanel anomaly={anomaly} />}
        {c.spectrum && c.spectrum.points.length > 0 && (
          <WhenVisible minHeight={400}>
            <SpectrumPanel spectrum={c.spectrum} />
          </WhenVisible>
        )}
        {o && c.spectrum && c.spectrum.points.length > 0 && (
          <WhenVisible minHeight={560}>
            <CompositionPanel objectId={o.object_id} />
          </WhenVisible>
        )}
        {c.injection && <InjectionPanel injection={c.injection} />}
        <ProvenancePanel candidate={c} onSource={openSource} />
        {o && <HistoryPanel o={o} />}
      </div>

      <WhenVisible minHeight={96}>
        <Neighbors current={c} nameFor={nameFor} />
      </WhenVisible>
      </Deferred>
      <SourceDrawer subject={source} onClose={() => setSource(null)} />
    </div>
  );
}

/** The object record's own panels: every visit, the orbit and how far away it is. */
function ObjectPanels({ o, title }: { o: ObjectDetail; title: string }) {
  const fields = useData("fields", (signal) => getFields(signal));
  const fieldName = (fid: string) => (fields.status === "ok" ? fields.data.fields.find((f) => f.field_id === fid)?.name : undefined) ?? fid;
  return (
    <>
      <VisitsPanel object={o} fieldName={fieldName} />
      <OrbitPanel object={o} label={title} />
      <DistancePanel
        distanceClass={o.distance_class}
        estimate={o.orbit?.helio_distance_au ?? o.motion.distance_au_estimate}
        from={o.orbit?.helio_distance_au ? "orbit" : "parallax"}
      />
    </>
  );
}

function HistoryPanel({ o }: { o: ObjectDetail }) {
  return (
    <Panel id="history" title="History" kicker="Updates">
      {o.history.length ? (
        <ol className={objectStyles.history}>
          {o.history.map((h, i) => (
            <li key={i}>
              <span className="mono">{formatUtcDateTime(h.utc)}</span>: {h.change} <span className="muted mono">({h.run_id})</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No updates recorded.</p>
      )}
      {o.also_seen_as && o.also_seen_as.length > 0 && (
        <p className={objectStyles.also}>
          Also seen as{" "}
          {o.also_seen_as.map((a, i) => (
            <span key={a}>
              {i > 0 && ", "}
              <Link href={objectHref(a)} prefetch={false} className="mono">
                {a}
              </Link>
            </span>
          ))}
          : other tiles where JPL identified the same object.
        </p>
      )}
      <p className={objectStyles.also}>
        Pipeline {o.candidate_ids.length === 1 ? "sighting" : "sightings"}:{" "}
        {o.candidate_ids.map((cid, i) => (
          <span key={cid}>
            {i > 0 && ", "}
            <span className="mono">{cid}</span>
          </span>
        ))}
        .
      </p>
    </Panel>
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
    <nav className={styles.neighbors} aria-label="Other objects">
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
export function JplStatus({ known }: { known: CandidateDetail["known_object"] }) {
  const ago = known.query_utc ? formatAgo(known.query_utc) : null;
  let tone: "pending" | "ok" | "warn";
  let text: string;
  if (!known.checked && known.enrichment === "static") {
    // The build-time snapshot, shown until the live report arrives.
    tone = "pending";
    text = "Loading the latest JPL result";
  } else if (!known.checked && known.enrichment === "pending") {
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
export function SectionNav({ sections }: { sections: readonly (readonly [string, string])[] }) {
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

/**
 * The `?id=` route (/objects/object/?id=obj-…): for objects published after the site was built.
 * `?candidate=` opens a sighting that has no object record (a simulated one).
 */
export function ObjectReportFromQuery() {
  const params = useSearchParams();
  const objectId = params.get("id");
  const candidate = params.get("candidate") ?? (objectId?.startsWith("obj-") ? objectId.slice(4) : null);
  return <ObjectReport id={candidate} objectId={objectId} />;
}
