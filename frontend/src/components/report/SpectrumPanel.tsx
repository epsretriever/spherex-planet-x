import { extent, niceTicks, rampColor, scale, wavelengthT } from "@/lib/chart";
import type { Spectrum } from "@/lib/contract";
import { fmt } from "@/lib/format";
import { Panel } from "./Panel";
import styles from "./report.module.css";

/** Flux against wavelength across SPHEREx's 0.75–5 µm range. */
export function SpectrumPanel({ spectrum }: { spectrum: Spectrum }) {
  const pts = [...spectrum.points].filter((p) => Number.isFinite(p.wavelength_um) && Number.isFinite(p.flux_ujy)).sort((a, b) => a.wavelength_um - b.wavelength_um);
  if (!pts.length) return null;
  const W = 640;
  const H = 280;
  const m = { l: 56, r: 16, t: 16, b: 44 };
  const sx = (um: number) => m.l + wavelengthT(um) * (W - m.l - m.r);
  const [y0, y1] = extent(pts.flatMap((p) => [p.flux_ujy - p.flux_err_ujy, p.flux_ujy + p.flux_err_ujy]), 0.12);
  const lo = Math.min(0, y0);
  const sy = scale([lo, y1], [H - m.b, m.t]);
  const xTicks = [0.75, 1, 1.5, 2, 3, 4, 5];

  return (
    <Panel
      id="spectrum"
      title="Its infrared colors"
      kicker={`Spectrum · ${pts.length} of 102 bands`}
      intro="Each sighting measured the object's brightness at one wavelength. Together they sketch its infrared spectrum. Bands without a sighting are simply unmeasured."
    >
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart} role="img" aria-label={`Spectrum: ${pts.map((p) => `${fmt(p.wavelength_um, 2)} microns, ${fmt(p.flux_ujy, 0)} microjansky`).join("; ")}`}>
        <defs>
          <linearGradient id="spec-band" x1="0" x2="1">
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
              <stop key={t} offset={t} stopColor={rampColor(t)} />
            ))}
          </linearGradient>
        </defs>
        <rect x={m.l} y={H - m.b + 1} width={W - m.l - m.r} height={5} fill="url(#spec-band)" rx={2} />
        {niceTicks(lo, y1, 4).map((t) => (
          <g key={t}>
            <line className={styles.gridLine} x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />
            <text className={styles.tick} x={m.l - 6} y={sy(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} className={styles.tick} x={sx(t)} y={H - m.b + 22} textAnchor="middle">
            {t}
          </text>
        ))}
        <text className={styles.axisLabel} x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle">
          wavelength (µm)
        </text>
        <text className={styles.axisLabel} transform={`translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">
          brightness (µJy)
        </text>
        {pts.length > 1 && (
          <polyline
            points={pts.map((p) => `${sx(p.wavelength_um)},${sy(p.flux_ujy)}`).join(" ")}
            fill="none"
            stroke="var(--border-strong)"
            strokeWidth={1}
            strokeDasharray="3 4"
          />
        )}
        {pts.map((p, i) => {
          const c = rampColor(wavelengthT(p.wavelength_um));
          return (
            <g key={`${p.epoch_id}-${i}`}>
              <line x1={sx(p.wavelength_um)} x2={sx(p.wavelength_um)} y1={sy(p.flux_ujy - p.flux_err_ujy)} y2={sy(p.flux_ujy + p.flux_err_ujy)} stroke={c} strokeWidth={1.5} />
              <circle cx={sx(p.wavelength_um)} cy={sy(p.flux_ujy)} r={4.5} fill={c} stroke="#08060d" strokeWidth={1.5} />
            </g>
          );
        })}
      </svg>
      <p className={styles.note}>Error bars show ±1σ. Wavelength axis is logarithmic, matching how SPHEREx&apos;s channels are spaced.</p>
    </Panel>
  );
}
