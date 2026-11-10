"use client";

import { getComposition } from "@/lib/api";
import { niceTicks, scale } from "@/lib/chart";
import { complexName, logT, pct, plotted, reflectanceDomain, wavelengthDomain } from "@/lib/composition";
import type { ObjectComposition } from "@/lib/contract";
import { fmt } from "@/lib/format";
import { useData } from "@/lib/useData";
import styles from "./CompositionPanel.module.css";
import { Panel } from "./Panel";
import report from "./report.module.css";

const INTRO =
  "SPHEREx measured this object at a different wavelength in each sighting. Dividing by the Sun's spectrum gives its reflectance, which we compare with the average spectra of known asteroid types.";

/** "What is it made of?": the object's indicative composition (fetched when the panel is shown). */
export function CompositionPanel({ objectId }: { objectId: string }) {
  const state = useData(`composition:${objectId}`, (signal) => getComposition(objectId, signal));
  return (
    <Panel id="composition" title="What is it made of?" kicker="Indicative · from its colors" intro={INTRO}>
      {state.status === "loading" && <p className="muted">Loading its colors…</p>}
      {state.status === "error" && (
        <p className="muted">
          {state.error.reason === "not_found"
            ? "Its composition has not been worked out yet. It is computed after each survey update."
            : "Could not load its composition right now."}
        </p>
      )}
      {state.status === "ok" && <Composition c={state.data} />}
    </Panel>
  );
}

function Composition({ c }: { c: ObjectComposition }) {
  const t = c.taxonomy;
  const h = c.hydration;
  return (
    <>
      <div className={styles.flags}>
        <span className={styles.flag}>Indicative, not definitive</span>
        {c.simulated && <span className={`${styles.flag} ${styles.simulated}`}>SIMULATED</span>}
        {t && (
          <span className={styles.flag} data-tone={t.confidence}>
            {t.confidence[0]!.toUpperCase() + t.confidence.slice(1)} confidence
          </span>
        )}
      </div>
      <p className={styles.result}>{c.result_plain}</p>
      {t && <p className={report.note}>{t.confidence_plain}</p>}

      <div className={report.chartRow}>
        <ReflectanceChart c={c} />
        <div>
          {t && (
            <>
              <h3 className={styles.h3}>Closest asteroid types</h3>
              <ul className={styles.bars} aria-label="Probability of each asteroid type">
                {Object.entries(t.complex_probability)
                  .slice(0, 4)
                  .map(([cx, p]) => (
                    <li key={cx}>
                      <span>{complexName(cx)}</span>
                      <span className="mono">{pct(p)}</span>
                      <span className={styles.bar} aria-hidden="true">
                        <span style={{ width: `${Math.max(1, p * 100)}%` }} />
                      </span>
                    </li>
                  ))}
              </ul>
              <dl className={styles.facts}>
                <div>
                  <dt>Best class</dt>
                  <dd>
                    <span className="mono">{t.best.class_name}</span> · χ² {fmt(t.best.chi2, 1)} for {t.best.dof} degrees of freedom
                  </dd>
                </div>
                {t.runner_up && (
                  <div>
                    <dt>Runner-up</dt>
                    <dd>
                      <span className="mono">{t.runner_up.class_name}</span> ({complexName(t.runner_up.complex)}) · χ² {fmt(t.runner_up.chi2, 1)}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Spectral slope</dt>
                  <dd className="mono">
                    {fmt(t.slope_per_um, 2)} ± {fmt(t.slope_err_per_um, 2)} per µm ({fmt(t.slope_range_um[0] ?? 0, 2)}–{fmt(t.slope_range_um[1] ?? 0, 2)} µm)
                  </dd>
                </div>
                <div>
                  <dt>Bands used</dt>
                  <dd className="mono">
                    {t.n_bands} over {fmt(t.wavelength_span_um, 2)} µm
                  </dd>
                </div>
              </dl>
            </>
          )}
          <h3 className={styles.h3}>Water-bearing minerals (2.7–3.1 µm)</h3>
          <p className={styles.small}>{h.verdict_plain}</p>
        </div>
      </div>

      <h3 className={styles.h3}>How it was worked out</h3>
      <ul className={styles.list}>
        <li>{c.geometry.note_plain}</li>
        <li>
          Reflectance is the flux divided by the Sun&apos;s spectrum (ASTM E490), set to 1 at 1.0–1.2 µm
          {c.normalisation.method === "template_fit" ? " through the best-fitting type, because no sighting fell in that range" : ""}.
        </li>
        {!c.thermal.flagged && <li>{c.thermal.note_plain}</li>}
      </ul>
      <h3 className={styles.h3}>Caveats</h3>
      <ul className={styles.list}>
        {c.caveats.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <p className={report.note}>
        Sources:{" "}
        {c.references.map((r, i) => (
          <span key={r.url}>
            {i > 0 && " · "}
            <a href={r.url} rel="noopener noreferrer" target="_blank" title={r.citation}>
              {r.label}
            </a>
          </span>
        ))}
      </p>
    </>
  );
}

function ReflectanceChart({ c }: { c: ObjectComposition }) {
  const W = 440;
  const H = 260;
  const m = { l: 48, r: 14, t: 14, b: 44 };
  const wd = wavelengthDomain(c);
  const [y0, y1] = reflectanceDomain(c);
  const sx = (um: number) => m.l + logT(um, wd) * (W - m.l - m.r);
  const sy = scale([y0, y1], [H - m.b, m.t]);
  const { used, other, excluded } = plotted(c);
  const t = c.taxonomy?.template;
  const band = c.hydration.band_um;
  const xTicks = [0.75, 1, 1.5, 2, 3, 4, 5].filter((x) => x >= wd[0] && x <= wd[1]);
  const area = t
    ? [
        ...t.wavelength_um.map((w, i) => `${sx(w)},${sy((t.reflectance[i] ?? 0) + (t.sigma[i] ?? 0))}`),
        ...[...t.wavelength_um].reverse().map((w, j) => {
          const i = t.wavelength_um.length - 1 - j;
          return `${sx(w)},${sy((t.reflectance[i] ?? 0) - (t.sigma[i] ?? 0))}`;
        }),
      ].join(" ")
    : null;
  const label = `Reflectance against wavelength: ${used.length + other.length} points${t ? `, with the ${t.class_name}-class average spectrum` : ""}.`;
  return (
    <figure className={styles.figure}>
      <svg viewBox={`0 0 ${W} ${H}`} className={report.chart} role="img" aria-label={label}>
        {band.length === 2 && band[1]! <= wd[1] && (
          <rect x={sx(band[0]!)} width={sx(band[1]!) - sx(band[0]!)} y={m.t} height={H - m.b - m.t} className={styles.waterBand} />
        )}
        {niceTicks(y0, y1, 4).map((v) => (
          <g key={v}>
            <line className={report.gridLine} x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} />
            <text className={report.tick} x={m.l - 6} y={sy(v) + 4} textAnchor="end">
              {fmt(v, 1)}
            </text>
          </g>
        ))}
        {xTicks.map((x) => (
          <text key={x} className={report.tick} x={sx(x)} y={H - m.b + 18} textAnchor="middle">
            {x}
          </text>
        ))}
        <text className={report.axisLabel} x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle">
          wavelength (µm)
        </text>
        <text className={report.axisLabel} transform={`translate(12 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">
          relative reflectance
        </text>
        {area && <polygon points={area} className={styles.templateArea} />}
        {t && (
          <polyline
            points={t.wavelength_um.map((w, i) => `${sx(w)},${sy(t.reflectance[i] ?? 0)}`).join(" ")}
            className={styles.templateLine}
            fill="none"
          />
        )}
        {[...other, ...used].map((p, i) => {
          const r = p.reflectance!;
          const e = p.reflectance_err!;
          const isUsed = p.use === "taxonomy";
          return (
            <g key={`${p.epoch_id}-${p.wavelength_um}-${i}`} className={isUsed ? styles.used : styles.other}>
              <line x1={sx(p.wavelength_um)} x2={sx(p.wavelength_um)} y1={sy(r - e)} y2={sy(r + e)} />
              <circle cx={sx(p.wavelength_um)} cy={sy(r)} r={isUsed ? 4 : 3.5} />
            </g>
          );
        })}
      </svg>
      <figcaption className={report.note}>
        <span className={styles.keyUsed} aria-hidden="true" /> compared with asteroid types{" "}
        {other.length > 0 && (
          <>
            · <span className={styles.keyOther} aria-hidden="true" /> other reflected-light points{" "}
          </>
        )}
        {t && (
          <>
            · <span className={styles.keyTemplate} aria-hidden="true" /> {t.class_name}-class average ± spread (DeMeo et al. 2009){" "}
          </>
        )}
        {band.length === 2 && band[1]! <= wd[1] && <>· shaded: 2.7–3.1 µm water band </>}
        · ±1σ error bars.
        {excluded.length > 0 && ` ${excluded.length} ${excluded.length === 1 ? "sighting is" : "sightings are"} left out (heat glow, another night or no flux).`}
      </figcaption>
    </figure>
  );
}
