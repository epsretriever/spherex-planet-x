import { Panel } from "@/components/report/Panel";
import reportStyles from "@/components/report/report.module.css";
import type { DistanceClass } from "@/lib/contract";
import { fmt } from "@/lib/format";
import { DISTANCE_CLASSES } from "@/lib/objects";
import styles from "./Object.module.css";

const BANDS: DistanceClass[] = ["neo", "main_belt", "jupiter_trojan", "centaur", "tno"];
const AXIS: [number, number] = [0.3, 100];
const TICKS = [0.5, 1, 2, 5, 10, 30, 100];
const W = 640;
const H = 132;
const M = { l: 12, r: 12 };

const sx = (au: number) => {
  const t = (Math.log10(Math.min(Math.max(au, AXIS[0]), AXIS[1])) - Math.log10(AXIS[0])) / (Math.log10(AXIS[1]) - Math.log10(AXIS[0]));
  return M.l + t * (W - M.l - M.r);
};

const PLANET_MARKS: [string, number][] = [
  ["Earth", 1],
  ["Mars", 1.52],
  ["Jupiter", 5.2],
  ["Saturn", 9.54],
  ["Uranus", 19.2],
  ["Neptune", 30.1],
];

/**
 * How far from the Sun the object probably is: the class, and the distance estimate with its
 * range on a log scale against the class ranges and the planets.
 */
export function DistancePanel({
  distanceClass,
  estimate,
  from = "parallax",
}: {
  distanceClass: DistanceClass;
  estimate: { best: number; lo: number; hi: number } | null | undefined;
  /** Where the estimate comes from: the parallax fit, or the orbit's possible orbits (clones). */
  from?: "parallax" | "orbit";
}) {
  const info = DISTANCE_CLASSES[distanceClass] ?? DISTANCE_CLASSES.unknown;
  const est = estimate && [estimate.best, estimate.lo, estimate.hi].every((v) => Number.isFinite(v) && v > 0) ? estimate : null;
  return (
    <Panel id="distance" title="How far away" kicker="Distance">
      <p className={styles.distanceClass}>
        <strong>{info.label}</strong>
        {info.range && (
          <span className="muted">
            {" "}
            ({info.range[0] === null ? `closer than ${info.range[1]}` : info.range[1] === null ? `beyond ${info.range[0]}` : `${info.range[0]}–${info.range[1]}`} AU from the
            Sun)
          </span>
        )}
        . {info.plain}
      </p>
      {est ? (
        <>
          <p>
            Best estimate <span className="mono">{fmt(est.best, 2)} AU</span> from the Sun, somewhere between{" "}
            <span className="mono">{fmt(est.lo, 2)}</span> and <span className="mono">{fmt(est.hi, 2)} AU</span>.{" "}
            {from === "orbit"
              ? "It comes from the orbit: the middle and the 5–95% range of all the orbits that fit the sightings."
              : "It comes from parallax: how the object seems to shift as SPHEREx and Earth move."}
          </p>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className={styles.distanceChart}
            role="img"
            aria-label={`Distance estimate ${fmt(est.best, 2)} AU, range ${fmt(est.lo, 2)} to ${fmt(est.hi, 2)} AU, on a log scale from ${AXIS[0]} to ${AXIS[1]} AU`}
          >
            {BANDS.map((b) => {
              const r = DISTANCE_CLASSES[b].range!;
              const x0 = sx(r[0] ?? AXIS[0]);
              const x1 = sx(r[1] ?? AXIS[1]);
              return (
                <g key={b}>
                  <rect x={x0} y={18} width={Math.max(1, x1 - x0)} height={38} className={styles.band} data-active={b === distanceClass || undefined} />
                  <text x={(x0 + x1) / 2} y={12} textAnchor="middle" className={styles.bandLabel}>
                    {b === "neo" ? "NEO" : b === "main_belt" ? "Belt" : b === "jupiter_trojan" ? "Trojan" : b === "centaur" ? "Centaur" : "TNO"}
                  </text>
                </g>
              );
            })}
            {PLANET_MARKS.map(([name, au]) => (
              <g key={name}>
                <line x1={sx(au)} x2={sx(au)} y1={18} y2={56} className={styles.planetTick} />
                <text x={sx(au)} y={70} textAnchor="middle" className={styles.planetLabel}>
                  {name}
                </text>
              </g>
            ))}
            <line x1={sx(est.lo)} x2={sx(est.hi)} y1={37} y2={37} className={styles.range} />
            <line x1={sx(est.lo)} x2={sx(est.lo)} y1={29} y2={45} className={styles.range} />
            <line x1={sx(est.hi)} x2={sx(est.hi)} y1={29} y2={45} className={styles.range} />
            <circle cx={sx(est.best)} cy={37} r={6} className={styles.best} />
            {TICKS.map((t) => (
              <text key={t} x={sx(t)} y={100} textAnchor="middle" className={styles.tick}>
                {t}
              </text>
            ))}
            <text x={W / 2} y={124} textAnchor="middle" className={styles.tick}>
              distance from the Sun (AU, log scale)
            </text>
          </svg>
          <p className={reportStyles.note}>Ranges follow the API contract. Gaps between ranges, and distances we can&apos;t pin down, are &quot;not known&quot;.</p>
        </>
      ) : (
        <p className="muted">No distance has been measured for this object yet.</p>
      )}
    </Panel>
  );
}
