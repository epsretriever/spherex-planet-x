"use client";

import type { Detection } from "@/lib/contract";
import { fmt, formatUtcDateTime } from "@/lib/format";
import { Term } from "../Term";
import { detectionLabel } from "./StampStrip";
import { useShowAll } from "./ShowAll";
import styles from "./report.module.css";

export function MeasurementTable({ detections }: { detections: Detection[] }) {
  const { count, toggle } = useShowAll(detections.length, 8, "rows");
  return (
    <>
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Measurements per sighting (scrolls sideways)">
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Time (UTC)</th>
            <th scope="col">
              <Term term="mjd">MJD</Term>
            </th>
            <th scope="col">
              RA <span className={styles.unit}>°</span>
            </th>
            <th scope="col">
              Dec <span className={styles.unit}>°</span>
            </th>
            <th scope="col">
              ± <span className={styles.unit}>″</span>
            </th>
            <th scope="col">
              Detector x, y <span className={styles.unit}>px</span>
            </th>
            <th scope="col">
              Flux <span className={styles.unit}>µJy</span>
            </th>
            <th scope="col">
              <Term term="snr">S/N</Term>
            </th>
            <th scope="col">
              <Term term="wavelength">λ</Term> <span className={styles.unit}>µm</span>
            </th>
            <th scope="col">Flags</th>
            <th scope="col">Obs ID</th>
          </tr>
        </thead>
        <tbody>
          {detections.slice(0, count).map((d, i) => (
            <tr key={`${d.epoch_id}-${i}`} id={`detection-${i}`}>
              <td>{detectionLabel(i)}</td>
              <td>{formatUtcDateTime(d.time_utc).replace(" UTC", "")}</td>
              <td>{fmt(d.mjd, 5)}</td>
              <td>{fmt(d.ra_deg, 5)}</td>
              <td>{fmt(d.dec_deg, 5)}</td>
              <td>{fmt(d.pos_err_arcsec, 2)}</td>
              <td>
                {fmt(d.x_pix, 1)}, {fmt(d.y_pix, 1)}
              </td>
              <td>
                {fmt(d.flux_ujy, 1)} ± {fmt(d.flux_err_ujy, 1)}
              </td>
              <td>{fmt(d.snr, 1)}</td>
              <td>{fmt(d.wavelength_um_center, 3)}</td>
              <td>{d.flag_names?.length ? d.flag_names.join(", ") : d.flagged_pixels_in_aperture ? `${d.flagged_pixels_in_aperture} px` : "none"}</td>
              <td>{d.obs_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {toggle}
    </>
  );
}
