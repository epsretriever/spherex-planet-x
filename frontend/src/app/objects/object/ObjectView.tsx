"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClassificationBadge } from "@/components/ClassificationBadge";
import { ErrorState } from "@/components/DataState";
import { Deferred } from "@/components/Deferred";
import { DistancePanel } from "@/components/object/DistancePanel";
import objectStyles from "@/components/object/Object.module.css";
import { VisitsPanel } from "@/components/object/VisitsPanel";
import { OrbitPanel } from "@/components/orbit/OrbitPanel";
import { QualityMeter } from "@/components/QualityMeter";
import { KnownObjectPanel } from "@/components/report/KnownObjectPanel";
import { MotionPanel } from "@/components/report/MotionPanel";
import { NeoPanel } from "@/components/report/NeoPanel";
import { Panel } from "@/components/report/Panel";
import { ScoresPanel } from "@/components/report/ScoresPanel";
import { SpectrumPanel } from "@/components/report/SpectrumPanel";
import { UnusualPanel } from "@/components/report/UnusualPanel";
import { ReportSkeleton } from "@/components/Skeletons";
import { WhenVisible } from "@/components/WhenVisible";
import { getFields, getObject } from "@/lib/api";
import type { ObjectDetail } from "@/lib/contract";
import { formatHours, formatRate, formatUtcDateTime } from "@/lib/format";
import { DISTANCE_CLASSES, ORBIT_STATUS, groupVisits } from "@/lib/objects";
import { candidateHref, objectHref } from "@/lib/routes";
import { SITE_NAME } from "@/lib/site";
import { useData } from "@/lib/useData";
import { useObjectNames, type NameSeed } from "@/lib/useObjectNames";
import { JplStatus, SectionNav } from "../../detective/candidate/CandidateReport";
import styles from "../../detective/candidate/CandidateReport.module.css";

const DISCLAIMER =
  "Unmatched objects may be artifacts, measurement errors, or objects missing from catalogs. This is not a discovery claim.";
const PENDING_POLL_MS = 6000;
const PENDING_POLL_MAX = 20;

/** One object across all its sightings: build-time data first, then the live API (with JPL results). */
export function ObjectView({ id, initial, seed }: { id: string | null; initial?: ObjectDetail | null; seed?: NameSeed }) {
  const state = useData(id ? `object:${id}` : null, (signal) => getObject(id!, signal));
  const [fresh, setFresh] = useState<ObjectDetail | null>(null);
  const shown = fresh && fresh.object_id === id ? fresh : state.status === "ok" ? state.data : (initial ?? null);

  const pending = shown?.known_object.enrichment === "pending";
  useEffect(() => {
    if (!pending || !id) return;
    const ctrl = new AbortController();
    let tries = 0;
    const timer = setInterval(() => {
      if (++tries > PENDING_POLL_MAX) return clearInterval(timer);
      getObject(id, ctrl.signal).then(
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
  return <ObjectPage o={shown!} seed={seed} />;
}

function Crumbs() {
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      <Link href="/objects/" prefetch={false}>
        ← All objects
      </Link>
    </nav>
  );
}

function ObjectPage({ o, seed }: { o: ObjectDetail; seed?: NameSeed }) {
  const { nameFor } = useObjectNames(seed);
  const fields = useData("fields", (signal) => getFields(signal));
  const fieldName = (fid: string) => (fields.status === "ok" ? fields.data.fields.find((f) => f.field_id === fid)?.name : undefined) ?? fid;
  // An object is named like its first sighting's candidate, so the two pages agree.
  const name = nameFor({ candidate_id: o.candidate_ids[0] ?? o.object_id, classification: o.classification, designation: o.known_object.designation });
  const visits = useMemo(() => groupVisits(o.detections), [o.detections]);
  const dist = DISTANCE_CLASSES[o.distance_class] ?? DISTANCE_CLASSES.unknown;

  useEffect(() => {
    document.title = `${name.title} · ${SITE_NAME}`;
  }, [name.title]);

  const sections = [
    ["visits", "Visits"],
    ["orbit", "Orbit"],
    ["distance", "Distance"],
    ...(o.neo_likelihood ? [["neo", "Orbit odds"]] : []),
    ["motion", "Motion"],
    ["known", "Known object"],
    ["quality", "Quality"],
    ...(o.anomaly ? [["unusual", "Unusual"]] : []),
    ...(o.spectrum?.points.length ? [["spectrum", "Spectrum"]] : []),
    ["history", "History"],
  ] as [string, string][];

  return (
    <div className="fade-in">
      <Crumbs />
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <ClassificationBadge value={o.classification} size="lg" />
          <JplStatus known={o.known_object} />
        </div>
        <h1 className={styles.title}>{name.title}</h1>
        <p className={`mono ${styles.id}`}>
          <span className="visually-hidden">Object ID </span>
          {o.object_id}
        </p>
        <p className={`lede ${styles.verdict}`}>{o.summary_plain}</p>
        <dl className={styles.headline}>
          <div>
            <dt>Sightings</dt>
            <dd className="mono">{o.detections.length}</dd>
          </div>
          <div>
            <dt>Visits</dt>
            <dd className="mono">{visits.length}</dd>
          </div>
          <div>
            <dt>Tracked over</dt>
            <dd className="mono">{formatHours(o.motion.time_span_hours)}</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd className="mono">{formatRate(o.motion.rate_arcsec_per_hr)}</dd>
          </div>
          <div>
            <dt>Where</dt>
            <dd>{dist.label}</dd>
          </div>
          <div>
            <dt>Orbit</dt>
            <dd>{ORBIT_STATUS[o.orbit_status]}</dd>
          </div>
          <div>
            <dt>Signal quality</dt>
            <dd>
              <QualityMeter level={o.scores.quality_level} scores={o.scores} />
            </dd>
          </div>
        </dl>
        {(o.classification === "unmatched" || o.classification === "unconfirmed_pair") && (
          <p className={styles.disclaimer} role="note">
            {o.disclaimer || DISCLAIMER}
          </p>
        )}
      </header>

      <SectionNav sections={sections} />

      <Deferred fallback={<ReportSkeleton />}>
        <div className={styles.sections}>
          <VisitsPanel object={o} fieldName={fieldName} />
          <OrbitPanel object={o} label={name.title} />
          <DistancePanel
            distanceClass={o.distance_class}
            estimate={o.orbit?.helio_distance_au ?? o.motion.distance_au_estimate}
            from={o.orbit?.helio_distance_au ? "orbit" : "parallax"}
          />
          {o.neo_likelihood && <NeoPanel neo={o.neo_likelihood} />}
          <WhenVisible minHeight={700}>
            <MotionPanel motion={o.motion} detections={o.detections} />
          </WhenVisible>
          <KnownObjectPanel known={o.known_object} detections={o.detections} />
          <ScoresPanel scores={o.scores} />
          {o.anomaly && <UnusualPanel anomaly={o.anomaly} />}
          {o.spectrum && o.spectrum.points.length > 0 && (
            <WhenVisible minHeight={400}>
              <SpectrumPanel spectrum={o.spectrum} />
            </WhenVisible>
          )}
          <Panel id="history" title="History" kicker="Updates">
            {o.history.length ? (
              <ol className={objectStyles.history}>
                {o.history.map((h, i) => (
                  <li key={i}>
                    <span className="mono">{formatUtcDateTime(h.utc)}</span>: {h.change}{" "}
                    <span className="muted mono">({h.run_id})</span>
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
              Evidence {o.candidate_ids.length === 1 ? "report" : "reports"} for each tile:{" "}
              {o.candidate_ids.map((c, i) => (
                <span key={c}>
                  {i > 0 && ", "}
                  <Link href={candidateHref(c)} prefetch={false} className="mono">
                    {c}
                  </Link>
                </span>
              ))}
              .
            </p>
          </Panel>
        </div>
      </Deferred>
    </div>
  );
}

/** The `?id=` route: for objects published after the site was built. */
export function ObjectViewFromQuery() {
  return <ObjectView id={useSearchParams().get("id")} />;
}
