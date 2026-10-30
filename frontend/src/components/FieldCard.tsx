import Link from "next/link";
import { assetUrl } from "@/lib/api";
import type { FieldSummary } from "@/lib/contract";
import { formatUtcDate } from "@/lib/format";
import { CLASSIFICATIONS, CLASSIFICATION_ORDER } from "@/lib/labels";
import { fieldHref } from "@/lib/routes";
import styles from "./FieldCard.module.css";

export { fieldHref } from "@/lib/routes";

export function FieldCard({ field }: { field: FieldSummary }) {
  const counts = CLASSIFICATION_ORDER.filter((c) => c !== "injected" && (field.candidate_counts?.[c] ?? 0) > 0);
  return (
    <li className={`card ${styles.card}`}>
      <div className={styles.thumb}>
        {field.thumbnail_url ? (
          // The thumbnail is a downsampled field image; its provenance is on the field page.
          // eslint-disable-next-line @next/next/no-img-element -- pre-stretched cutouts must not be resampled
          <img src={assetUrl(field.thumbnail_url)} alt="" loading="lazy" />
        ) : (
          <span className={styles.noThumb}>No preview</span>
        )}
        <span className={`mono ${styles.coords}`}>
          RA {field.center.ra_deg.toFixed(2)}° · Dec {field.center.dec_deg.toFixed(2)}°
        </span>
      </div>
      <div className={styles.body}>
        <h2 className={styles.name}>
          <Link href={fieldHref(field.field_id)} className={styles.link}>
            {field.name}
          </Link>
        </h2>
        <p className={styles.blurb}>{field.blurb}</p>
        <p className={`mono ${styles.meta}`}>
          <span>
            {field.epoch_count} {field.epoch_count === 1 ? "image" : "images"}
          </span>
          {field.date_range && (
            <span>
              {formatUtcDate(field.date_range.start_utc)} – {formatUtcDate(field.date_range.end_utc)}
            </span>
          )}
        </p>
        {counts.length > 0 && (
          <ul className={styles.counts} aria-label="Moving objects found">
            {counts.map((c) => (
              <li key={c} style={{ ["--c" as string]: `var(${CLASSIFICATIONS[c].cssVar})` }}>
                <span className="mono">{field.candidate_counts[c]}</span> {CLASSIFICATIONS[c].label.toLowerCase()}
              </li>
            ))}
          </ul>
        )}
      </div>
      <span className={styles.cta} aria-hidden="true">
        Open →
      </span>
    </li>
  );
}
