"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { JplLinksRow } from "@/components/JplLinks";
import { ClassificationBadge } from "@/components/ClassificationBadge";
import cardStyles from "@/components/CandidateCard.module.css";
import { EmptyState, ErrorState } from "@/components/DataState";
import { QualityMeter } from "@/components/QualityMeter";
import { CardListSkeleton } from "@/components/Skeletons";
import { assetUrl, getObjects } from "@/lib/api";
import type { ObjectList, ObjectSummary } from "@/lib/contract";
import { formatHours, formatRate, formatUtcDate } from "@/lib/format";
import { DISTANCE_CLASSES, ORBIT_STATUS } from "@/lib/objects";
import { objectHref } from "@/lib/routes";
import { useData } from "@/lib/useData";
import { useObjectNames, type NameSeed } from "@/lib/useObjectNames";
import { byReviewPriority } from "@/lib/review";
import styles from "./ObjectList.module.css";

/** The object list: as published at build time, then from the live API (with JPL results folded in). */
/** Cards rendered before "Show all" (unexplained come first, so they are always on screen). */
const FIRST = 30;

export function ObjectListView({ initial, seed }: { initial: ObjectList | null; seed?: NameSeed }) {
  const [showAll, setShowAll] = useState(false);
  const state = useData("objects", (signal) => getObjects(signal));
  const { nameFor } = useObjectNames(seed);
  const list = state.status === "ok" ? state.data : initial;
  const sorted = useMemo(
    () =>
      list
        ? [...list.objects].sort(
            (a, b) => byReviewPriority(a, b) || b.n_detections - a.n_detections || b.overall_score - a.overall_score,
          )
        : [],
    [list],
  );

  if (!list) {
    if (state.status === "loading") return <CardListSkeleton label="Loading objects" />;
    if (state.status === "error" && state.error.reason === "not_found") {
      return (
        <EmptyState title="No objects published yet">
          <p>Once our pipeline links sightings of a moving object, it will appear here.</p>
        </EmptyState>
      );
    }
    if (state.status === "error") return <ErrorState reason={state.error.reason} message={state.error.message} onRetry={state.retry} />;
    return null;
  }
  if (!sorted.length) {
    return (
      <EmptyState title="No objects yet">
        <p>Once our pipeline links sightings of a moving object, it will appear here.</p>
      </EmptyState>
    );
  }
  return (
    <>
      <p className={styles.count}>
        <span className="mono">{sorted.length}</span> {sorted.length === 1 ? "object" : "objects"}, unexplained first, then most sightings
      </p>
      <ul className={styles.list}>
        {(showAll ? sorted : sorted.slice(0, FIRST)).map((o) => (
          <ObjectCard key={o.object_id} o={o} title={nameFor({ candidate_id: o.candidate_ids[0] ?? o.object_id, classification: o.classification, designation: o.known_object_designation }).title} />
        ))}
      </ul>
      {!showAll && sorted.length > FIRST && (
        <button type="button" className="button" style={{ marginTop: "var(--space-6)", width: "100%" }} onClick={() => setShowAll(true)}>
          Show all {sorted.length} objects
        </button>
      )}
    </>
  );
}

function ObjectCard({ o, title }: { o: ObjectSummary; title: string }) {
  return (
    <li className={`card ${cardStyles.card}`} data-classification={o.classification}>
      <div className={cardStyles.thumb}>
        {o.thumbnail_url ? (
          // A detection stamp; each stamp's provenance is in the object's evidence report.
          // eslint-disable-next-line @next/next/no-img-element -- pre-stretched cutouts must not be resampled
          <img src={assetUrl(o.thumbnail_url)} alt="" loading="lazy" />
        ) : (
          <span className="muted">No preview</span>
        )}
        <span className={cardStyles.crosshair} aria-hidden="true" />
      </div>
      <div className={cardStyles.body}>
        <div className={cardStyles.top}>
          <ClassificationBadge value={o.classification} size="sm" />
          <QualityMeter level={o.quality_level} overall={o.overall_score} />
        </div>
        <h2 className={cardStyles.title}>
          <Link href={objectHref(o.object_id)} className={cardStyles.link} prefetch={false}>
            {title}
          </Link>
        </h2>
        <p className={cardStyles.summary}>{o.summary_plain}</p>
        <JplLinksRow matched={o.known_object_matched} designation={o.known_object_designation} />
        <dl className={cardStyles.stats}>
          <div>
            <dt>Sightings</dt>
            <dd className="mono">{o.n_detections}</dd>
          </div>
          <div>
            <dt>Visits</dt>
            <dd className="mono">{o.n_visits}</dd>
          </div>
          <div>
            <dt>Over</dt>
            <dd className="mono">{formatHours(o.arc_hours)}</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd className="mono">{formatRate(o.rate_arcsec_per_hr)}</dd>
          </div>
          <div>
            <dt>Where</dt>
            <dd>{(DISTANCE_CLASSES[o.distance_class] ?? DISTANCE_CLASSES.unknown).label}</dd>
          </div>
          <div>
            <dt>Orbit</dt>
            <dd>{ORBIT_STATUS[o.orbit_status]}</dd>
          </div>
        </dl>
        <p className={`mono ${cardStyles.foot}`}>
          <span>{o.object_id}</span>
          <span>{formatUtcDate(o.first_time_utc)}</span>
        </p>
      </div>
    </li>
  );
}
