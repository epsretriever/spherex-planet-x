import { extent, niceTicks, scale } from "@/lib/chart";
import type { InjectionStudy } from "@/lib/contract";
import { fmt } from "@/lib/format";
import styles from "./report/report.module.css";

/** The faintest magnitude recovered half the time, for each speed. */
export function M50Chart({ m50 }: { m50: InjectionStudy["m50_by_rate"] }) {
  const pts = [...m50].sort((a, b) => a.rate_arcsec_per_hr - b.rate_arcsec_per_hr);
  const measured = pts.filter((p) => p.m50_ab !== null) as { rate_arcsec_per_hr: number; m50_ab: number }[];
  if (!pts.length) return null;
  const W = 520;
  const H = 240;
  const m = { l: 56, r: 16, t: 16, b: 44 };
  const logR = (r: number) => Math.log10(Math.max(r, 1e-3));
  const [r0, r1] = extent(pts.map((p) => logR(p.rate_arcsec_per_hr)), 0.1);
  const sx = scale([r0, r1], [m.l, W - m.r]);
  const [y0, y1] = measured.length ? extent(measured.map((p) => p.m50_ab), 0.3) : [15, 22];
  // Fainter (bigger magnitude) is better, so it goes up.
  const sy = scale([y0, y1], [H - m.b, m.t]);

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart} role="img" aria-label={`Half-recovery magnitude by speed: ${pts.map((p) => `${p.rate_arcsec_per_hr} arcsec per hour: ${p.m50_ab === null ? "not reached" : `AB ${fmt(p.m50_ab, 1)}`}`).join("; ")}`}>
        {niceTicks(y0, y1, 4).map((t) => (
          <g key={t}>
            <line className={styles.gridLine} x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />
            <text className={styles.tick} x={m.l - 6} y={sy(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {pts.map((p) => (
          <text key={p.rate_arcsec_per_hr} className={styles.tick} x={sx(logR(p.rate_arcsec_per_hr))} y={H - m.b + 18} textAnchor="middle">
            {p.rate_arcsec_per_hr}
          </text>
        ))}
        <text className={styles.axisLabel} x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle">
          speed (arcsec/hour, log scale)
        </text>
        <text className={styles.axisLabel} transform={`translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">
          m₅₀ (AB) · fainter ↑
        </text>
        {measured.length > 1 && (
          <polyline
            points={measured.map((p) => `${sx(logR(p.rate_arcsec_per_hr))},${sy(p.m50_ab)}`).join(" ")}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
          />
        )}
        {pts.map((p) =>
          p.m50_ab === null ? (
            <text key={p.rate_arcsec_per_hr} className={styles.tick} x={sx(logR(p.rate_arcsec_per_hr))} y={H - m.b - 8} textAnchor="middle" style={{ fill: "var(--warning)" }}>
              n/a
            </text>
          ) : (
            <g key={p.rate_arcsec_per_hr}>
              <circle cx={sx(logR(p.rate_arcsec_per_hr))} cy={sy(p.m50_ab)} r={5} fill="var(--accent)" stroke="#08060d" strokeWidth={2} />
              <text className={styles.tick} x={sx(logR(p.rate_arcsec_per_hr))} y={sy(p.m50_ab) - 10} textAnchor="middle" style={{ fill: "var(--text)" }}>
                {fmt(p.m50_ab, 1)}
              </text>
            </g>
          ),
        )}
      </svg>
      <figcaption className={styles.note}>
        m₅₀ is the magnitude at which half of the planted objects were recovered. &ldquo;n/a&rdquo; means recovery never reached 50% at
        that speed.
      </figcaption>
    </figure>
  );
}
