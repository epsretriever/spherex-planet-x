import type { GrowthDay } from "@/lib/staticData";
import styles from "./GrowthCharts.module.css";

const W = 240;
const H = 80;
const PAD = 4;

const SERIES: { key: keyof Omit<GrowthDay, "date">; label: string; fmt: (v: number) => string }[] = [
  { key: "tiles_searched", label: "Patches of sky searched", fmt: (v) => v.toLocaleString("en-US") },
  { key: "area_deg2", label: "Sky searched (deg²)", fmt: (v) => `${v.toFixed(1)} deg²` },
  { key: "sky_percent", label: "Share of the whole sky", fmt: (v) => `${v.toFixed(2)}%` },
  { key: "candidates", label: "Candidates found", fmt: (v) => v.toLocaleString("en-US") },
  { key: "objects", label: "Objects tracked", fmt: (v) => v.toLocaleString("en-US") },
];

const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
const short = (d: string) =>
  new Date(day(d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Small line charts of the survey's cumulative totals, one point per day. */
export function GrowthCharts({ days }: { days: GrowthDay[] }) {
  if (days.length < 2) return null;
  const t0 = day(days[0]!.date);
  const span = Math.max(1, day(days[days.length - 1]!.date) - t0);
  const x = (d: string) => PAD + ((day(d) - t0) / span) * (W - 2 * PAD);
  return (
    <section className={styles.growth} aria-labelledby="growth-heading">
      <p className="eyebrow">Survey growth</p>
      <h2 id="growth-heading" className={styles.heading}>
        The search grows every day
      </h2>
      <p className={styles.lede}>
        New patches of sky are searched four times a day. Totals at the end of each day, {short(days[0]!.date)} to{" "}
        {short(days[days.length - 1]!.date)}.
      </p>
      <ul className={styles.grid}>
        {SERIES.map((s) => {
          const vals = days.map((d) => d[s.key]);
          const max = Math.max(...vals) || 1;
          const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
          const pts = days.map((d) => `${x(d.date).toFixed(1)},${y(d[s.key]).toFixed(1)}`).join(" ");
          const last = days[days.length - 1]!;
          const first = days[0]!;
          return (
            <li key={s.key} className={`card ${styles.card}`}>
              <span className={styles.label}>{s.label}</span>
              <span className={`mono ${styles.value}`}>{s.fmt(last[s.key])}</span>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className={styles.chart}
                role="img"
                aria-label={`${s.label}: ${s.fmt(first[s.key])} on ${short(first.date)} to ${s.fmt(last[s.key])} on ${short(last.date)}`}
              >
                <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} className={styles.axis} />
                <polyline points={pts} className={styles.line} />
                {days.map((d) => (
                  <circle key={d.date} cx={x(d.date)} cy={y(d[s.key])} r={2.5} className={styles.dot}>
                    <title>{`${short(d.date)}: ${s.fmt(d[s.key])}`}</title>
                  </circle>
                ))}
              </svg>
              <span className={styles.range}>
                <span>{short(first.date)}</span>
                <span>{short(last.date)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
