import type { Detection, Motion } from "@/lib/contract";
import { fmt, formatHours, formatRate } from "@/lib/format";
import { Term } from "../Term";
import { MotionPlot } from "./MotionPlot";
import { Panel } from "./Panel";
import styles from "./report.module.css";

const MODEL: Record<Motion["model"], string> = {
  linear: "Straight line at a steady speed",
  parallax: "Shift from Earth's own motion (distant object)",
  none: "No motion fit (too few sightings)",
};

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const compass = (pa: number) => COMPASS[Math.round((((pa % 360) + 360) % 360) / 45) % 8];

export function MotionPanel({ motion, detections }: { motion: Motion; detections: Detection[] }) {
  return (
    <Panel id="motion" title="How it moved" kicker="Motion">
      <div className={styles.chartRow}>
        <div>
          <dl className={styles.facts}>
            <div>
              <dt>Speed</dt>
              <dd>
                {formatRate(motion.rate_arcsec_per_hr)}
                {motion.rate_err_arcsec_per_hr !== null && <small> ± {fmt(motion.rate_err_arcsec_per_hr, 2)}</small>}
              </dd>
            </div>
            <div>
              <dt>
                Direction (<Term term="position angle">PA</Term>)
              </dt>
              <dd>
                {motion.position_angle_deg !== null ? (
                  <>
                    {fmt(motion.position_angle_deg, 1)}° <small>toward the {compass(motion.position_angle_deg)}</small>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Tracked over</dt>
              <dd>{formatHours(motion.time_span_hours)}</dd>
            </div>
            <div>
              <dt>Sightings</dt>
              <dd>{motion.n_detections}</dd>
            </div>
            <div>
              <dt>Fit scatter (RMS)</dt>
              <dd>
                {fmt(motion.fit_residual_rms_arcsec, 2)}
                {motion.fit_residual_rms_arcsec !== null && <small> arcsec</small>}
              </dd>
            </div>
            <div>
              <dt>Fit χ² / dof</dt>
              <dd>
                {fmt(motion.fit_chi2, 2)} / {motion.fit_dof ?? "—"}
              </dd>
            </div>
            {motion.distance_au_estimate && (
              <div>
                <dt>Distance estimate</dt>
                <dd>
                  {fmt(motion.distance_au_estimate.best, 0)} AU{" "}
                  <small>
                    ({fmt(motion.distance_au_estimate.lo, 0)}–{fmt(motion.distance_au_estimate.hi, 0)})
                  </small>
                </dd>
              </div>
            )}
          </dl>
          <p className={styles.note}>
            Model: {MODEL[motion.model] ?? motion.model}. A small fit scatter means the positions line up the way a real moving
            object&apos;s would.
          </p>
        </div>
        <MotionPlot detections={detections} motion={motion} />
      </div>
    </Panel>
  );
}
