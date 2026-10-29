"use client";

import type { Source } from "@/lib/contract";
import { formatUtcDateTime, formatWavelength } from "@/lib/format";
import { Sheet } from "./Sheet";
import styles from "./SourceDrawer.module.css";

export interface SourceSubject {
  /** e.g. "Image B" or "Detection 2". */
  title: string;
  time_utc: string;
  mjd: number;
  wavelength_um_center: number;
  wavelength_um_range?: number[];
  epoch_id: string;
  source: Source;
}

function Value({ value }: { value: string | number | undefined | null }) {
  return value === null || value === undefined || value === "" ? (
    <span className="muted">Not reported</span>
  ) : (
    <span className="mono">{value}</span>
  );
}

const METHOD: Record<Source["cutout_method"], string> = {
  s3_byte_range: "Read directly from the public SPHEREx archive on AWS (only the rows needed)",
  irsa_cutout: "IRSA cutout service",
};

/** Provenance for one image: where the pixels came from and when they were taken. */
export function SourceDrawer({ subject, onClose }: { subject: SourceSubject | null; onClose: () => void }) {
  const s = subject?.source;
  return (
    <Sheet open={!!subject} onClose={onClose} title={subject ? `${subject.title}: source` : "Source"}>
      {subject && s && (
        <>
          <p className="muted">
            A cutout of a real SPHEREx exposure, from NASA/IPAC&apos;s Infrared Science Archive (IRSA).
          </p>
          <dl className={styles.list}>
            <dt>Taken</dt>
            <dd>
              <span className="mono">{formatUtcDateTime(subject.time_utc)}</span>
              <br />
              <span className="mono muted">MJD {subject.mjd}</span>
            </dd>
            <dt>Wavelength</dt>
            <dd>
              <span className="mono">{formatWavelength(subject.wavelength_um_center)}</span>
              {Array.isArray(subject.wavelength_um_range) && subject.wavelength_um_range.length === 2 && (
                <span className="mono muted">
                  {" "}
                  ({subject.wavelength_um_range[0]!.toFixed(3)}–{subject.wavelength_um_range[1]!.toFixed(3)} µm)
                </span>
              )}
            </dd>
            <dt>File</dt>
            <dd className={styles.wrap}>
              <Value value={s.file} />
            </dd>
            <dt>Observation ID</dt>
            <dd>
              <Value value={s.obs_id} />
            </dd>
            <dt>Detector</dt>
            <dd>
              <Value value={s.detector ? `D${s.detector}` : null} />
            </dd>
            <dt>Plane ID</dt>
            <dd className={styles.wrap}>
              <Value value={s.planeid} />
            </dd>
            <dt>Data release</dt>
            <dd>
              <Value value={s.data_release} />
            </dd>
            <dt>Cutout</dt>
            <dd>
              {METHOD[s.cutout_method] ?? s.cutout_method}
              {Array.isArray(s.cutout_region_pix) && s.cutout_region_pix.length > 0 && (
                <>
                  <br />
                  <span className="mono muted">pixels [{s.cutout_region_pix.join(", ")}]</span>
                </>
              )}
            </dd>
            {s.processing_note && (
              <>
                <dt>Processing</dt>
                <dd>{s.processing_note}</dd>
              </>
            )}
            <dt>Epoch</dt>
            <dd>
              <Value value={subject.epoch_id} />
            </dd>
          </dl>
          <div className={styles.links}>
            <a className="button" href={s.archive_url} target="_blank" rel="noopener noreferrer">
              Full file in archive ↗
            </a>
            {s.cutout_url && (
              <a className="button" href={s.cutout_url} target="_blank" rel="noopener noreferrer">
                Cutout (FITS) ↗
              </a>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
