import Link from "next/link";
import { assetUrl } from "@/lib/api";
import type { CandidateSummary } from "@/lib/contract";
import { formatHours, formatRate, formatUtcDate } from "@/lib/format";
import { ClassificationBadge } from "./ClassificationBadge";
import { QualityMeter } from "./QualityMeter";
import styles from "./CandidateCard.module.css";

export function candidateHref(id: string) {
  return `/detective/candidate/?id=${encodeURIComponent(id)}`;
}

export function CandidateCard({ c }: { c: CandidateSummary }) {
  return (
    <li className={`card ${styles.card}`} data-classification={c.classification}>
      <div className={styles.thumb}>
        {c.thumbnail_url ? (
          // The thumbnail is a detection stamp; each stamp's provenance is in the report.
          // eslint-disable-next-line @next/next/no-img-element -- pre-stretched cutouts must not be resampled
          <img src={assetUrl(c.thumbnail_url)} alt="" loading="lazy" />
        ) : (
          <span className="muted">No preview</span>
        )}
        <span className={styles.crosshair} aria-hidden="true" />
      </div>
      <div className={styles.body}>
        <div className={styles.top}>
          <ClassificationBadge value={c.classification} size="sm" />
          <QualityMeter level={c.quality_level} overall={c.overall_score} />
        </div>
        <h2 className={styles.title}>
          <Link href={candidateHref(c.candidate_id)} className={styles.link}>
            {c.label_plain}
          </Link>
        </h2>
        <p className={styles.summary}>{c.summary_plain}</p>
        <dl className={styles.stats}>
          <div>
            <dt>Sightings</dt>
            <dd className="mono">{c.detection_count}</dd>
          </div>
          <div>
            <dt>Over</dt>
            <dd className="mono">{formatHours(c.time_span_hours)}</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd className="mono">{formatRate(c.rate_arcsec_per_hr)}</dd>
          </div>
        </dl>
        <p className={`mono ${styles.foot}`}>
          <span>{c.candidate_id}</span>
          <span>{formatUtcDate(c.first_time_utc)}</span>
          {c.known_object_designation && <span>{c.known_object_designation}</span>}
        </p>
      </div>
    </li>
  );
}
