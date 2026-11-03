"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { GrowthDay } from "@/lib/staticData";
import styles from "./GrowthCharts.module.css";

type Key = "tiles_searched" | "area_deg2" | "candidates" | "objects" | "identified" | "unidentified";

const int = (v: number) => v.toLocaleString("en-US");

/** Fixed order and colors: a series keeps its color whichever others are hidden. */
const SERIES: { key: Key; label: string; color: string; fmt: (v: number, d: GrowthDay) => string }[] = [
  { key: "tiles_searched", label: "Patches of sky searched", color: "#3987e5", fmt: int },
  {
    key: "area_deg2",
    label: "Sky searched",
    color: "#d95926",
    fmt: (v, d) => `${v.toFixed(1)} deg² · ${d.sky_percent.toFixed(2)}%`,
  },
  { key: "candidates", label: "Candidates found", color: "#199e70", fmt: int },
  { key: "objects", label: "Objects tracked", color: "#c98500", fmt: int },
  { key: "identified", label: "Identified (known to JPL)", color: "#d55181", fmt: int },
  { key: "unidentified", label: "Unidentified", color: "#9085e9", fmt: int },
];

const H = 340;
const M = { top: 16, right: 16, bottom: 32, left: 44 };

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const short = (d: string) =>
  new Date(dayMs(d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const val = (d: GrowthDay, k: Key): number | null => (typeof d[k] === "number" ? (d[k] as number) : null);

/**
 * The survey's cumulative totals, one point per day, on one axis: each line is indexed to its
 * own latest value (100% = today), so different units grow side by side. Real values are in the
 * readout, which the crosshair or the slider moves through.
 */
export function GrowthCharts({ days }: { days: GrowthDay[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [shown, setShown] = useState<Set<Key>>(() => new Set(SERIES.map((s) => s.key)));
  const [at, setAt] = useState(days.length - 1);
  const sliderId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (days.length < 2) return null;
  const latest = (k: Key) => {
    for (let i = days.length - 1; i >= 0; i--) {
      const v = val(days[i]!, k);
      if (v) return v;
    }
    return null;
  };
  const series = SERIES.filter((s) => latest(s.key) !== null);
  const visible = series.filter((s) => shown.has(s.key));

  const iw = width - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const t0 = dayMs(days[0]!.date);
  const span = Math.max(1, dayMs(days[days.length - 1]!.date) - t0);
  const x = (i: number) => M.left + ((dayMs(days[i]!.date) - t0) / span) * iw;
  const idx = (s: (typeof SERIES)[number], v: number) => (100 * v) / latest(s.key)!;
  const yMax = Math.max(
    100,
    ...visible.flatMap((s) => days.map((d) => val(d, s.key)).filter((v): v is number => v !== null).map((v) => idx(s, v))),
  );
  const yTop = Math.ceil(yMax / 25) * 25;
  const y = (pct: number) => M.top + ih - (pct / yTop) * ih;
  const ticks = Array.from({ length: yTop / 25 + 1 }, (_, i) => i * 25);

  const path = (s: (typeof SERIES)[number]) => {
    let d = "";
    let pen = false;
    days.forEach((day, i) => {
      const v = val(day, s.key);
      if (v === null) return void (pen = false);
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(idx(s, v)).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const nearest = (px: number) => {
    let best = 0;
    for (let i = 1; i < days.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    return best;
  };
  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAt(nearest(e.clientX - r.left));
  };
  const toggle = (k: Key) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(k) && next.size > 1) next.delete(k);
      else next.add(k);
      return next;
    });

  const day = days[at]!;
  const xLabels = days.length <= 8 ? days.map((_, i) => i) : [0, Math.floor((days.length - 1) / 2), days.length - 1];

  return (
    <section className={styles.growth} aria-labelledby="growth-heading">
      <p className="eyebrow">Survey growth</p>
      <h2 id="growth-heading" className={styles.heading}>
        The search grows every day
      </h2>
      <p className={styles.lede}>
        New patches of sky are searched four times a day. Each line is shown as a share of its latest
        total, so all of them can share one axis; the readout gives the real numbers.
      </p>

      <div className={`card ${styles.panel}`}>
        <ul className={styles.legend} aria-label="Lines (select to show or hide)">
          {series.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                className={styles.key}
                aria-pressed={shown.has(s.key)}
                onClick={() => toggle(s.key)}
              >
                <span className={styles.swatch} style={{ background: s.color }} aria-hidden="true" />
                {s.label}
              </button>
            </li>
          ))}
        </ul>

        <div className={styles.readout} aria-live="polite">
          <span className={styles.readDate}>{short(day.date)}</span>
          <dl className={styles.readList}>
            {visible.map((s) => {
              const v = val(day, s.key);
              return (
                <div key={s.key}>
                  <dt>
                    <span className={styles.lineKey} style={{ background: s.color }} aria-hidden="true" />
                    {s.label}
                  </dt>
                  <dd className="mono">{v === null ? "not recorded" : s.fmt(v, day)}</dd>
                </div>
              );
            })}
          </dl>
        </div>

        <div ref={wrap} className={styles.plot}>
          <svg
            width={width}
            height={H}
            className={styles.svg}
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            role="img"
            aria-label={`Survey totals from ${short(days[0]!.date)} to ${short(days[days.length - 1]!.date)}; see the table below for every value.`}
          >
            <defs>
              <filter id="growth-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? styles.base : styles.grid} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className={styles.tick}>
                  {t}%
                </text>
              </g>
            ))}
            {xLabels.map((i) => (
              <text
                key={i}
                x={x(i)}
                y={H - 8}
                textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}
                className={styles.tick}
              >
                {short(days[i]!.date)}
              </text>
            ))}
            <line x1={x(at)} x2={x(at)} y1={M.top} y2={M.top + ih} className={styles.cross} />
            {visible.map((s) => (
              <path key={s.key} d={path(s)} stroke={s.color} className={styles.line} filter="url(#growth-glow)" />
            ))}
            {visible.map((s) =>
              days.map((d, i) => {
                const v = val(d, s.key);
                if (v === null) return null;
                return (
                  <circle
                    key={`${s.key}-${d.date}`}
                    cx={x(i)}
                    cy={y(idx(s, v))}
                    r={i === at ? 5.5 : 3}
                    fill={s.color}
                    className={styles.dot}
                  />
                );
              }),
            )}
          </svg>
        </div>

        <label htmlFor={sliderId} className={styles.scrubLabel}>
          Scrub through days
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={days.length - 1}
          step={1}
          value={at}
          onChange={(e) => setAt(Number(e.target.value))}
          className={styles.scrub}
          aria-valuetext={short(day.date)}
        />

        <details className={styles.table}>
          <summary>Show the numbers as a table</summary>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  {series.map((s) => (
                    <th key={s.key} scope="col">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.date}>
                    <th scope="row">{short(d.date)}</th>
                    {series.map((s) => {
                      const v = val(d, s.key);
                      return (
                        <td key={s.key} className="mono">
                          {v === null ? "–" : s.fmt(v, d)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}
