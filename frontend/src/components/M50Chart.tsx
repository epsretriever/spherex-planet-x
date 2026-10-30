import { extent, niceTicks, scale } from "@/lib/chart";
import { fmt } from "@/lib/format";
import styles from "./report/report.module.css";

export interface M50Point {
  /** Speed (″/h) or distance (AU): plotted on a log axis. */
  x: number;
  m50_ab: number | null;
}

/**
 * The faintest magnitude recovered half the time, against speed or distance. Fainter (bigger
 * magnitude) is better, so it goes up. Points where 50% was never reached sit on the baseline
 * as "n/a".
 */
export function M50Chart({ points, xLabel, unit }: { points: M50Point[]; xLabel: string; unit: string }) {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const measured = pts.filter((p): p is { x: number; m50_ab: number } => p.m50_ab !== null);
  if (!pts.length) return null;
  const W = 520;
  const H = 240;
  const m = { l: 56, r: 16, t: 16, b: 44 };
  const logX = (x: number) => Math.log10(Math.max(x, 1e-3));
  const [x0, x1] = extent(pts.map((p) => logX(p.x)), 0.1);
  const sx = scale([x0, x1], [m.l, W - m.r]);
  const [y0, y1] = measured.length ? extent(measured.map((p) => p.m50_ab), 0.3) : [15, 22];
  const sy = scale([y0, y1], [H - m.b, m.t]);
  const describe = pts.map((p) => `${p.x} ${unit}: ${p.m50_ab === null ? "not reached" : `AB ${fmt(p.m50_ab, 1)}`}`).join("; ");

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart} role="img" aria-label={`Half-recovery magnitude by ${xLabel}: ${describe}`}>
        {niceTicks(y0, y1, 4).map((t) => (
          <g key={t}>
            <line className={styles.gridLine} x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />
            <text className={styles.tick} x={m.l - 6} y={sy(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {pts.map((p) => (
          <text key={`x${p.x}`} className={styles.tick} x={sx(logX(p.x))} y={H - m.b + 18} textAnchor="middle">
            {p.x}
          </text>
        ))}
        <text className={styles.axisLabel} x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle">
          {xLabel} ({unit}, log scale)
        </text>
        <text className={styles.axisLabel} transform={`translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">
          m₅₀ (AB) · fainter ↑
        </text>
        {measured.length > 1 && (
          <polyline points={measured.map((p) => `${sx(logX(p.x))},${sy(p.m50_ab)}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth={2} />
        )}
        {pts.map((p) =>
          p.m50_ab === null ? (
            <text key={p.x} className={styles.tick} x={sx(logX(p.x))} y={H - m.b - 8} textAnchor="middle" style={{ fill: "var(--warning)" }}>
              n/a
            </text>
          ) : (
            <g key={p.x}>
              <circle cx={sx(logX(p.x))} cy={sy(p.m50_ab)} r={5} fill="var(--accent)" stroke="#08060d" strokeWidth={2} />
              <text className={styles.tick} x={sx(logX(p.x))} y={sy(p.m50_ab) - 10} textAnchor="middle" style={{ fill: "var(--text)" }}>
                {fmt(p.m50_ab, 1)}
              </text>
            </g>
          ),
        )}
      </svg>
      <figcaption className={styles.note}>
        m₅₀ is the magnitude at which half of the planted objects were recovered. &ldquo;n/a&rdquo; means recovery never reached 50% at
        that {xLabel}.
      </figcaption>
    </figure>
  );
}
