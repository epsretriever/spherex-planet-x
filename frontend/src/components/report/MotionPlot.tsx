import { useId } from "react";
import { extent, niceTicks, scale } from "@/lib/chart";
import type { Detection, Motion } from "@/lib/contract";
import styles from "./report.module.css";

const D2R = Math.PI / 180;

/** Offsets (arcsec) from the first detection: x toward east, y toward north. */
export function skyOffsets(detections: Detection[]) {
  const first = detections[0];
  if (!first) return [];
  const cosDec = Math.cos(first.dec_deg * D2R);
  return detections.map((d) => {
    let dRa = d.ra_deg - first.ra_deg;
    if (dRa > 180) dRa -= 360;
    if (dRa < -180) dRa += 360;
    return { east: dRa * cosDec * 3600, north: (d.dec_deg - first.dec_deg) * 3600, err: d.pos_err_arcsec, mjd: d.mjd };
  });
}

/**
 * The track on the sky: measured positions with their error circles and,
 * when the backend fitted a rate, the fitted straight-line motion. East is
 * drawn to the left, as on a sky image.
 */
export function MotionPlot({ detections, motion }: { detections: Detection[]; motion: Motion }) {
  const arrowId = useId();
  const pts = skyOffsets(detections);
  if (pts.length < 2) return null;

  const meanT = pts.reduce((s, p) => s + p.mjd, 0) / pts.length;
  const meanE = pts.reduce((s, p) => s + p.east, 0) / pts.length;
  const meanN = pts.reduce((s, p) => s + p.north, 0) / pts.length;
  const fit =
    motion.ra_rate_arcsec_per_hr !== null && motion.dec_rate_arcsec_per_hr !== null && motion.model === "linear"
      ? (mjd: number) => ({
          east: meanE + motion.ra_rate_arcsec_per_hr! * (mjd - meanT) * 24,
          north: meanN + motion.dec_rate_arcsec_per_hr! * (mjd - meanT) * 24,
        })
      : null;
  const ends = fit ? [fit(pts[0]!.mjd), fit(pts[pts.length - 1]!.mjd)] : [];

  const xs = [...pts.flatMap((p) => [p.east - p.err, p.east + p.err]), ...ends.map((e) => e.east)];
  const ys = [...pts.flatMap((p) => [p.north - p.err, p.north + p.err]), ...ends.map((e) => e.north)];
  let [x0, x1] = extent(xs, 0.15);
  let [y0, y1] = extent(ys, 0.15);
  // Equal arcsec per pixel on both axes so the track isn't distorted.
  const W = 360;
  const H = 300;
  const m = { l: 48, r: 16, t: 16, b: 40 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const span = Math.max((x1 - x0) / pw, (y1 - y0) / ph);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  [x0, x1] = [cx - (span * pw) / 2, cx + (span * pw) / 2];
  [y0, y1] = [cy - (span * ph) / 2, cy + (span * ph) / 2];
  // East left: larger east offsets map to smaller x.
  const sx = scale([x1, x0], [m.l, W - m.r]);
  const sy = scale([y0, y1], [H - m.b, m.t]);
  const pxPerArcsec = pw / (x1 - x0);

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart} role="img" aria-label="Plot of the measured positions on the sky with the fitted straight-line motion.">
        <defs>
          <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--track)" />
          </marker>
        </defs>
        {niceTicks(x0, x1, 4).map((t) => (
          <g key={`x${t}`}>
            <line className={styles.gridLine} x1={sx(t)} x2={sx(t)} y1={m.t} y2={H - m.b} />
            <text className={styles.tick} x={sx(t)} y={H - m.b + 16} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        {niceTicks(y0, y1, 4).map((t) => (
          <g key={`y${t}`}>
            <line className={styles.gridLine} x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />
            <text className={styles.tick} x={m.l - 6} y={sy(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <text className={styles.axisLabel} x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle">
          ← east · offset (arcsec)
        </text>
        <text className={styles.axisLabel} transform={`translate(12 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">
          north ↑ (arcsec)
        </text>
        {ends.length === 2 && (
          <line
            x1={sx(ends[0]!.east)}
            y1={sy(ends[0]!.north)}
            x2={sx(ends[1]!.east)}
            y2={sy(ends[1]!.north)}
            stroke="var(--track)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            markerEnd={`url(#${arrowId})`}
          />
        )}
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={sx(p.east)} cy={sy(p.north)} r={Math.max(2, p.err * pxPerArcsec)} fill="rgb(255 138 76 / 0.15)" stroke="var(--accent)" strokeWidth={1} />
            <circle cx={sx(p.east)} cy={sy(p.north)} r={3} fill="var(--accent)" />
            {(pts.length <= 8 || i === 0 || i === pts.length - 1) && (
              <text className={styles.tick} x={sx(p.east) + 7} y={sy(p.north) - 7} style={{ fill: "var(--text)" }}>
                {i === 0 && pts.length > 8 ? "1 (first)" : i === pts.length - 1 && pts.length > 8 ? `${i + 1} (last)` : i + 1}
              </text>
            )}
          </g>
        ))}
      </svg>
      <figcaption className={styles.note}>
        Dots are measured positions{pts.length > 8 ? "; the first and last sightings are numbered" : ", numbered by sighting"}; circles show
        each position&apos;s uncertainty.
        {ends.length === 2 ? " The dashed arrow is the fitted straight-line motion." : ""}
      </figcaption>
    </figure>
  );
}
