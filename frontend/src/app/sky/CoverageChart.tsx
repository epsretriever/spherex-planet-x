"use client";

import { useEffect, useRef, useState } from "react";
import { formatUtcDate } from "@/lib/format";
import type { GrowthDay } from "@/lib/staticData";
import styles from "./SkyView.module.css";

const M = { l: 44, r: 16, t: 16, b: 28 };

/** Share of the sky searched, one point per day the survey published (growth.json). */
export function CoverageChart({ days }: { days: GrowthDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the container's real width so the text stays at its real size on a phone.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(960);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 560 ? 170 : 220;
  const pts = days.filter((d) => Number.isFinite(d.sky_percent));
  if (pts.length < 2) return null;
  const t = pts.map((d) => Date.parse(`${d.date}T00:00:00Z`));
  const t0 = t[0]!;
  const t1 = Math.max(t[t.length - 1]!, t0 + 86400000);
  const yMax = niceMax(Math.max(...pts.map((d) => d.sky_percent)));
  const x = (ms: number) => M.l + ((ms - t0) / (t1 - t0)) * (W - M.l - M.r);
  const y = (v: number) => H - M.b - (v / yMax) * (H - M.t - M.b);
  const line = pts.map((d, i) => `${i ? "L" : "M"}${x(t[i]!).toFixed(1)} ${y(d.sky_percent).toFixed(1)}`).join("");
  const area = `${line}L${x(t[t.length - 1]!).toFixed(1)} ${y(0)}L${x(t0).toFixed(1)} ${y(0)}Z`;
  const ticks = [0, yMax / 2, yMax];
  const h = hover !== null ? pts[hover]! : pts[pts.length - 1]!;
  const hi = hover ?? pts.length - 1;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(x(t[i]!) - px) < Math.abs(x(t[best]!) - px)) best = i;
    setHover(best);
  };

  return (
    <figure className={`card ${styles.coverage}`}>
      <figcaption className={styles.coverageHead}>
        <h2 className={styles.coverageTitle}>Sky searched over time</h2>
        <p className={styles.coverageReadout} aria-live="polite">
          <span className="mono">{h.sky_percent.toFixed(2)}%</span> of the sky · {h.tiles_searched.toLocaleString("en-US")} patches ·{" "}
          {formatUtcDate(`${h.date}T00:00:00Z`)}
        </p>
      </figcaption>
      <div ref={box}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.coverageSvg}
        role="img"
        aria-label={`Share of the sky searched, from ${pts[0]!.sky_percent.toFixed(2)}% on ${pts[0]!.date} to ${pts[pts.length - 1]!.sky_percent.toFixed(2)}% on ${pts[pts.length - 1]!.date}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className={styles.gridLine} />
            <text x={M.l - 6} y={y(v) + 4} textAnchor="end" className={styles.axisText}>
              {v.toFixed(yMax < 1 ? 1 : 0)}%
            </text>
          </g>
        ))}
        <path d={area} className={styles.coverageArea} />
        <path d={line} className={styles.coverageLine} />
        <line x1={x(t[hi]!)} x2={x(t[hi]!)} y1={M.t} y2={H - M.b} className={styles.crosshair} />
        {pts.map((d, i) => (
          <circle key={d.date} cx={x(t[i]!)} cy={y(d.sky_percent)} r={i === hi ? 5 : 4} className={styles.coverageDot} />
        ))}
        <text x={M.l} y={H - 8} className={styles.axisText}>
          {formatUtcDate(`${pts[0]!.date}T00:00:00Z`)}
        </text>
        <text x={W - M.r} y={H - 8} textAnchor="end" className={styles.axisText}>
          {formatUtcDate(`${pts[pts.length - 1]!.date}T00:00:00Z`)}
        </text>
      </svg>
      </div>
      <table className="visually-hidden">
        <caption>Share of the sky searched by date</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Sky searched</th>
            <th scope="col">Patches</th>
          </tr>
        </thead>
        <tbody>
          {pts.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.sky_percent.toFixed(3)}%</td>
              <td>{d.tiles_searched}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function niceMax(v: number) {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
  return steps.find((s) => s >= v * 1.05) ?? 100;
}
