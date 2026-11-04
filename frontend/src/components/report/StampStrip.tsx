"use client";

import { assetUrl } from "@/lib/api";
import { hasSource } from "@/lib/blink";
import type { Detection } from "@/lib/contract";
import { formatUtcShortDate, formatUtcTime, formatWavelength } from "@/lib/format";
import { useState } from "react";
import { useShowAll } from "./ShowAll";
import styles from "./report.module.css";

export const detectionLabel = (i: number) => `${i + 1}`;

/** One 64 px stamp per detection, each centered on the measured position. */
export function StampStrip({ detections, onSource }: { detections: Detection[]; onSource: (i: number) => void }) {
  const { count, toggle } = useShowAll(detections.length, 6, "sightings");
  // The model's saliency maps, when published with a source, can be laid over the stamps.
  const hasSaliency = detections.some((d) => !!d.saliency?.url && hasSource(d.saliency.source));
  const [saliency, setSaliency] = useState(false);
  return (
    <>
    {hasSaliency && (
      <div className={styles.saliencyBar}>
        <label className={styles.saliencyToggle}>
          <input type="checkbox" checked={saliency} onChange={(e) => setSaliency(e.target.checked)} />
          Show where the model looked
        </label>
        {saliency && (
          <span className={styles.note}>
            Brighter orange marks the pixels that changed the model&apos;s answer most when hidden (an occlusion map).
          </span>
        )}
      </div>
    )}
    <ol className={styles.stamps}>
      {detections.slice(0, count).map((d, i) => {
        const stamp = d.stamp;
        const ok = !!stamp?.url && hasSource(stamp.source);
        return (
          <li key={`${d.epoch_id}-${i}`} className={styles.stamp}>
            <div className={styles.stampImg}>
              {ok ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- pre-stretched cutouts must not be resampled */}
                  <img
                    src={assetUrl(stamp!.url)}
                    alt={`Sighting ${detectionLabel(i)}: ${formatUtcShortDate(d.time_utc)} at ${formatWavelength(d.wavelength_um_center)}`}
                    loading="lazy"
                  />
                  {saliency && d.saliency?.url && hasSource(d.saliency.source) && (
                    // eslint-disable-next-line @next/next/no-img-element -- overlay must match the stamp pixel for pixel
                    <img className={styles.saliency} src={assetUrl(d.saliency.url)} alt="" aria-hidden="true" />
                  )}
                  <span className={styles.stampRing} aria-hidden="true" />
                </>
              ) : (
                <span className={styles.placeholder}>{d.stamp === null ? "Not kept (known object)" : "Missing source"}</span>
              )}
            </div>
            <span className={`mono ${styles.stampMeta}`}>
              <strong>#{detectionLabel(i)}</strong>
              <span>{formatUtcShortDate(d.time_utc)}</span>
              <span>{formatUtcTime(d.time_utc)}</span>
              <span style={{ color: "var(--ir-6)" }}>{formatWavelength(d.wavelength_um_center)}</span>
              {typeof d.real_bogus === "number" && Number.isFinite(d.real_bogus) && (
                <span title="The model's chance this sighting is real">model {Math.round(d.real_bogus * 100)}% real</span>
              )}
            </span>
            <button type="button" className={styles.linkButton} onClick={() => onSource(i)} disabled={!ok}>
              {ok ? "Source" : "No source"}
            </button>
          </li>
        );
      })}
    </ol>
    {toggle}
    </>
  );
}
