import { assetUrl } from "@/lib/api";
import { hasSource } from "@/lib/blink";
import type { Detection } from "@/lib/contract";
import { formatUtcShortDate, formatUtcTime, formatWavelength } from "@/lib/format";
import styles from "./report.module.css";

export const detectionLabel = (i: number) => `${i + 1}`;

/** One 64 px stamp per detection, each centered on the measured position. */
export function StampStrip({ detections, onSource }: { detections: Detection[]; onSource: (i: number) => void }) {
  return (
    <ol className={styles.stamps}>
      {detections.map((d, i) => {
        const ok = !!d.stamp?.url && hasSource(d.stamp.source);
        return (
          <li key={`${d.epoch_id}-${i}`} className={styles.stamp}>
            <div className={styles.stampImg}>
              {ok ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- pre-stretched cutouts must not be resampled */}
                  <img
                    src={assetUrl(d.stamp.url)}
                    alt={`Sighting ${detectionLabel(i)}: ${formatUtcShortDate(d.time_utc)} at ${formatWavelength(d.wavelength_um_center)}`}
                    loading="lazy"
                  />
                  <span className={styles.stampRing} aria-hidden="true" />
                </>
              ) : (
                <span className={styles.placeholder}>Missing source</span>
              )}
            </div>
            <span className={`mono ${styles.stampMeta}`}>
              <strong>#{detectionLabel(i)}</strong>
              <span>{formatUtcShortDate(d.time_utc)}</span>
              <span>{formatUtcTime(d.time_utc)}</span>
              <span style={{ color: "var(--ir-6)" }}>{formatWavelength(d.wavelength_um_center)}</span>
            </span>
            <button type="button" className={styles.linkButton} onClick={() => onSource(i)} disabled={!ok}>
              {ok ? "Source" : "No source"}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
