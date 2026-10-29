"use client";

import { useState } from "react";
import { rampColor } from "@/lib/chart";
import type { InjectionStudy, RecoveryCell } from "@/lib/contract";
import { fmt } from "@/lib/format";
import styles from "./RecoveryGrid.module.css";

const pct = (f: number) => `${Math.round(f * 100)}%`;
const rateLabel = (r: number) => `${r}″/hr`;

/**
 * Recovery fraction for each (brightness, speed) cell of the injection
 * study, with Wilson 95% intervals. Rows are magnitudes (bright at top),
 * columns are rates.
 */
export function RecoveryGrid({ study }: { study: InjectionStudy }) {
  const mags = [...study.mag_bins_ab].sort((a, b) => a - b);
  const rates = [...study.rate_bins_arcsec_per_hr].sort((a, b) => a - b);
  const cell = new Map(study.grid.map((c) => [`${c.mag_ab}|${c.rate_arcsec_per_hr}`, c]));
  const [active, setActive] = useState<RecoveryCell | null>(null);

  return (
    <div className={styles.wrap}>
      <div className={styles.scroller} role="region" aria-label="Recovery grid (scrolls sideways)" tabIndex={0}>
        <table className={styles.grid}>
          <caption className="visually-hidden">
            Fraction of simulated objects recovered, by brightness (rows, AB magnitude) and speed (columns, arcseconds per hour), with
            95% intervals.
          </caption>
          <thead>
            <tr>
              <th scope="col" className={styles.corner}>
                <span>brightness ↓</span>
                <span>speed →</span>
              </th>
              {rates.map((r) => (
                <th key={r} scope="col" className="mono">
                  {rateLabel(r)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mags.map((m) => (
              <tr key={m}>
                <th scope="row" className="mono">
                  AB {fmt(m, 1)}
                </th>
                {rates.map((r) => {
                  const c = cell.get(`${m}|${r}`);
                  if (!c) {
                    return (
                      <td key={r} className={styles.empty}>
                        <span className="visually-hidden">not tested</span>
                      </td>
                    );
                  }
                  const bg = rampColor(0.1 + c.fraction * 0.9);
                  return (
                    <td key={r}>
                      <button
                        type="button"
                        className={styles.cell}
                        style={{ background: bg, color: c.fraction > 0.55 ? "#140a02" : "#f3eef9" }}
                        aria-pressed={active === c}
                        onClick={() => setActive(active === c ? null : c)}
                        onMouseEnter={() => setActive(c)}
                        aria-label={`AB ${fmt(m, 1)}, ${rateLabel(r)}: ${c.n_recovered} of ${c.n_injected} recovered (${pct(c.fraction)}, 95% interval ${pct(c.ci_low)} to ${pct(c.ci_high)})`}
                      >
                        <span className={styles.pct}>{pct(c.fraction)}</span>
                        <span className={styles.n}>
                          {c.n_recovered}/{c.n_injected}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.side}>
        <div className={styles.legend} aria-hidden="true">
          <span>0%</span>
          <span className={styles.ramp} />
          <span>100%</span>
        </div>
        <div className={styles.detail} aria-live="polite">
          {active ? (
            <>
              <p className={styles.detailTitle}>
                AB {fmt(active.mag_ab, 1)} at {rateLabel(active.rate_arcsec_per_hr)}
              </p>
              <p>
                Recovered <strong className="mono">{active.n_recovered}</strong> of{" "}
                <strong className="mono">{active.n_injected}</strong> planted objects ({pct(active.fraction)}).
              </p>
              <p className="muted">
                95% interval: {pct(active.ci_low)}–{pct(active.ci_high)}
              </p>
            </>
          ) : (
            <p className="muted">Tap or hover a cell to see how many planted objects were found there.</p>
          )}
        </div>
      </div>
    </div>
  );
}
