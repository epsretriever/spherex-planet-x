"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PlanetNineRegion, SurveyTile } from "@/lib/contract";
import { fieldHref } from "@/lib/routes";
import {
  MOLLWEIDE_HALF_WIDTH,
  cellPath,
  credibleLevels,
  eclipticToEquatorial,
  galacticToEquatorial,
  linePath,
  mollweide,
  outlinePath,
  sample,
  type Pt,
} from "@/lib/sky";
import type { SkyTile } from "./skyTile";
import styles from "./SkyMap.module.css";

export { skyTile, type SkyTile } from "./skyTile";

const W = 960;
const H = 480;
const PAD = 14;
const K = (W / 2 - PAD) / MOLLWEIDE_HALF_WIDTH;
const toSvg = (p: Pt): Pt => ({ x: W / 2 + K * p.x, y: H / 2 - K * p.y });
const at = (ra: number, dec: number) => toSvg(mollweide(ra, dec));

/** Depth colour scale: AB magnitudes from shallow to deep. */
export const DEPTH_RANGE: [number, number] = [17, 22];
const RAMP = ["--ir-2", "--ir-3", "--ir-4", "--ir-5", "--ir-6", "--ir-7"];

export function depthColor(m50: number | null): string | null {
  if (m50 === null || !Number.isFinite(m50)) return null;
  const t = (m50 - DEPTH_RANGE[0]) / (DEPTH_RANGE[1] - DEPTH_RANGE[0]);
  const i = Math.max(0, Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1))));
  return `var(${RAMP[i]})`;
}

/** Moving objects per tile: one hue family, brighter and larger with more objects (size is the second cue). */
export const OBJECT_STEPS = [
  { min: 1, label: "1 object", color: "var(--ir-4)", r: 6 },
  { min: 2, label: "2 objects", color: "var(--ir-6)", r: 8 },
  { min: 3, label: "3 or more", color: "var(--ir-7)", r: 10 },
] as const;

export function objectsStep(n: number) {
  return [...OBJECT_STEPS].reverse().find((s) => n >= s.min) ?? OBJECT_STEPS[0];
}

export type SkyColorBy = "objects" | "depth";
export type RaUnits = "deg" | "hours";

/** "123.4°" or "8h 13m": right ascension in the unit the reader picked. */
export function formatRaUnits(ra: number, units: RaUnits): string {
  const r = ((ra % 360) + 360) % 360;
  if (units === "deg") return `${r.toFixed(1)}°`;
  const h = r / 15;
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 60 ? `${(hh + 1) % 24}h 00m` : `${hh}h ${String(mm).padStart(2, "0")}m`;
}

interface Tip {
  x: number;
  y: number;
  lines: string[];
}

const TILE_STATUS_TEXT: Record<SurveyTile["status"], string> = {
  processed: "searched, moving objects found",
  empty: "searched, nothing found",
  failed: "search failed, will be retried",
  pending: "waiting to be searched",
  no_data: "no repeat SPHEREx visits",
};

/** Tiles without a field page, drawn as one path per status (hundreds of tiles, a few elements). */
const BATCHED: { status: SurveyTile["status"]; r: number; className: keyof typeof styles }[] = [
  { status: "no_data", r: 3, className: "tileNoData" },
  { status: "pending", r: 4, className: "tilePending" },
  { status: "empty", r: 4, className: "tileEmpty" },
  { status: "failed", r: 4, className: "tileFailed" },
];

const dotPath = (pts: Pt[], r: number) =>
  pts.map((p) => `M${(p.x - r).toFixed(1)} ${p.y.toFixed(1)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`).join("");

export function tileLabel(t: SkyTile, name?: string): string {
  const status = TILE_STATUS_TEXT[t.status] ?? t.status;
  const depth = t.m50_ab !== null ? `, half of simulated objects found down to magnitude ${t.m50_ab.toFixed(1)}` : "";
  return `${name ?? t.tile_id}: ${status}, ${t.n_epochs} images, ${t.n_candidates} moving ${t.n_candidates === 1 ? "object" : "objects"}${depth}`;
}

/** Usable only with a citation and a link: the region is never drawn unsourced. */
export function hasSourcedRegion(p: PlanetNineRegion | null | undefined): p is PlanetNineRegion {
  return !!p && typeof p.citation === "string" && p.citation.trim().length > 0 && typeof p.url === "string" && /^https?:\/\//.test(p.url) && Array.isArray(p.cells) && p.cells.length > 0;
}

/**
 * Mollweide all-sky map in equatorial coordinates (RA increasing to the left, as the sky looks
 * from Earth): the ecliptic, the Milky Way's plane, our searched tiles, and the published
 * Planet Nine region when the data includes it.
 */
export function SkyMap({
  tiles,
  planetNine,
  tileName,
  emptyCells,
  colorBy = "objects",
  raUnits = "deg",
}: {
  tiles: SkyTile[];
  planetNine?: PlanetNineRegion | null;
  tileName?: (t: SkyTile) => string | undefined;
  /** Searched patches with nothing found ([ra_deg, dec_deg]), as the survey publishes them since v1.2. */
  emptyCells?: [number, number][];
  /** What the colour of a tile with moving objects shows. */
  colorBy?: SkyColorBy;
  /** Right ascension labels in degrees (0–360°) or the astronomers' hours (0–24h). */
  raUnits?: RaUnits;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const statics = useMemo(() => {
    const raLines = Array.from({ length: 12 }, (_, i) => i * 30).map((ra) => ({
      ra,
      d: linePath(Array.from({ length: 91 }, (_, j) => ({ ra_deg: ra === 180 ? 179.999 : ra, dec_deg: -90 + j * 2 })), toSvg),
    }));
    const decLines = [-60, -30, 0, 30, 60].map((dec) => ({
      dec,
      d: linePath(sample((t) => ({ ra_deg: t === 360 ? 179.999 : (t + 180.001) % 360, dec_deg: dec }), 3), toSvg),
    }));
    return {
      outline: outlinePath(toSvg),
      raLines,
      decLines,
      ecliptic: linePath(sample((l) => eclipticToEquatorial(l, 0), 1), toSvg),
      galactic: linePath(sample((l) => galacticToEquatorial(l, 0), 1), toSvg),
    };
  }, []);

  const region = useMemo(() => {
    if (!hasSourcedRegion(planetNine)) return null;
    const levels = credibleLevels(planetNine.cells);
    return planetNine.cells
      .map((c, i) => ({ c, level: levels[i] }))
      .filter((x): x is { c: typeof x.c; level: number } => x.level !== null)
      .map(({ c, level }) => ({ level, d: cellPath(c.ra_deg, c.dec_deg, planetNine.cell_deg, toSvg) }));
  }, [planetNine]);

  const p9Peak = useMemo(() => {
    if (!hasSourcedRegion(planetNine)) return null;
    const best = [...planetNine.cells].sort((a, b) => b.fraction - a.fraction)[0];
    return best ? at(best.ra_deg, best.dec_deg) : null;
  }, [planetNine]);
  const raLabels = [0, 60, 120, 180, 240, 300].map((ra) => ({ ra, p: at(ra === 180 ? 179.5 : ra, 0) }));
  const decLabels = [60, 30, -30, -60].map((dec) => ({ dec, p: at(0, dec) }));
  const show = (e: React.PointerEvent | React.FocusEvent, lines: string[]) => {
    const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as SVGSVGElement);
    const box = svg.getBoundingClientRect();
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = "clientX" in e ? e.clientX : r.left + r.width / 2;
    const py = "clientY" in e ? e.clientY : r.top;
    setTip({ x: px - box.left, y: py - box.top, lines });
  };
  const hide = () => setTip(null);
  const statusTip = (status: SkyTile["status"], n: number) => [
    `${TILE_STATUS_TEXT[status] ?? status}`,
    `${n.toLocaleString("en-US")} ${n === 1 ? "patch" : "patches"} like this`,
  ];
  const eclLabel = at(eclipticToEquatorial(100, 0).ra_deg, eclipticToEquatorial(100, 0).dec_deg);
  const galLabel = at(galacticToEquatorial(60, 0).ra_deg, galacticToEquatorial(60, 0).dec_deg);

  return (
    <div className={styles.wrap}>
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.map} role="group" aria-label="All-sky map in equatorial coordinates" onPointerLeave={hide}>
      <defs>
        <clipPath id="sky-clip">
          <path d={statics.outline} />
        </clipPath>
        <pattern id="p9-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" className={styles.hatch} />
        </pattern>
      </defs>
      <path d={statics.outline} className={styles.sky} />
      <g clipPath="url(#sky-clip)" aria-hidden="true">
        {statics.decLines.map((l) => (
          <path key={`dec${l.dec}`} d={l.d} className={l.dec === 0 ? styles.equator : styles.grid} />
        ))}
        {statics.raLines.map((l) => (
          <path key={`ra${l.ra}`} d={l.d} className={styles.grid} />
        ))}
        {region && (
          <g>
            {region
              .filter((r) => r.level > 0.68)
              .map((r, i) => (
                <path key={`o${i}`} d={r.d} className={styles.p9Outer} />
              ))}
            {region
              .filter((r) => r.level <= 0.68)
              .map((r, i) => (
                <path key={`i${i}`} d={r.d} className={styles.p9Inner} />
              ))}
          </g>
        )}
        <path d={statics.galactic} className={styles.galactic} />
        <path d={statics.ecliptic} className={styles.ecliptic} />
      </g>
      <path d={statics.outline} className={styles.rim} />
      <g aria-hidden="true">
        {raLabels.map(({ ra, p }) => (
          <text key={ra} x={p.x} y={p.y + 16} className={styles.raLabel} textAnchor="middle">
            {raUnits === "hours" ? `${ra / 15}h` : `${ra}°`}
          </text>
        ))}
        {decLabels.map(({ dec, p }) => (
          <text key={dec} x={p.x + 4} y={p.y + (dec > 0 ? -4 : 14)} className={styles.raLabel}>
            {dec > 0 ? `+${dec}°` : `−${-dec}°`}
          </text>
        ))}
        <text x={eclLabel.x} y={eclLabel.y - 26} className={styles.eclLabel} textAnchor="middle">
          Ecliptic: path of the planets
        </text>
        <text x={galLabel.x} y={galLabel.y - 8} className={styles.galLabel} textAnchor="middle">
          Milky Way
        </text>
      </g>
      <g>
        {BATCHED.map(({ status, r, className }) => {
          const pts = tiles.filter((t) => t.status === status).map((t) => at(t.center.ra_deg, t.center.dec_deg));
          if (status === "empty" && emptyCells) for (const [ra, dec] of emptyCells) pts.push(at(ra, dec));
          return pts.length ? (
            <path
              key={status}
              d={dotPath(pts, r)}
              className={styles[className]}
              aria-hidden="true"
              onPointerMove={(e) => show(e, statusTip(status, pts.length))}
            />
          ) : null;
        })}
        {/* Tiles with moving objects: one link each, to their field. */}
        {tiles
          .filter((t) => t.status === "processed")
          .map((t) => {
            const p = at(t.center.ra_deg, t.center.dec_deg);
            const step = objectsStep(t.n_candidates);
            const color = colorBy === "depth" ? (depthColor(t.m50_ab) ?? "var(--track)") : step.color;
            const r = colorBy === "depth" ? 7 : step.r;
            const label = tileLabel(t, tileName?.(t));
            const tipLines = [
              tileName?.(t) ?? t.tile_id,
              `${t.n_candidates} moving ${t.n_candidates === 1 ? "object" : "objects"} · ${t.n_epochs} images`,
              `RA ${formatRaUnits(t.center.ra_deg, raUnits)}, Dec ${t.center.dec_deg >= 0 ? "+" : "−"}${Math.abs(t.center.dec_deg).toFixed(1)}°`,
              ...(t.m50_ab !== null ? [`Depth: half found down to AB ${t.m50_ab.toFixed(1)}`] : []),
              t.field_id ? "Select to open this patch" : "",
            ].filter(Boolean);
            const hover = {
              onPointerEnter: (e: React.PointerEvent) => show(e, tipLines),
              onPointerMove: (e: React.PointerEvent) => show(e, tipLines),
              onFocus: (e: React.FocusEvent) => show(e, tipLines),
              onBlur: hide,
            };
            const mark = (
              <>
                <circle cx={p.x} cy={p.y} r={22} className={styles.hit} />
                <circle cx={p.x} cy={p.y} r={r + 7} className={styles.halo} style={{ stroke: color }} />
                <circle cx={p.x} cy={p.y} r={r} className={styles.tile} style={{ fill: color }} />
                <title>{label}</title>
              </>
            );
            return t.field_id ? (
              <Link key={t.tile_id} href={fieldHref(t.field_id)} aria-label={label} className={styles.tileLink} prefetch={false} {...hover}>
                {mark}
              </Link>
            ) : (
              <g key={t.tile_id} role="img" aria-label={label} {...hover}>
                {mark}
              </g>
            );
          })}
      </g>
        {p9Peak && (
          <g className={styles.p9Pin} aria-label="Planet Nine search region: where it would most likely be, if it exists">
            <circle cx={p9Peak.x} cy={p9Peak.y} r={9} />
            <line x1={p9Peak.x} y1={p9Peak.y - 9} x2={p9Peak.x} y2={p9Peak.y - 40} />
            <text x={p9Peak.x} y={p9Peak.y - 46} textAnchor="middle">
              Planet Nine search region
            </text>
          </g>
        )}
    </svg>
    {tip && (
      <div className={styles.tip} style={{ left: tip.x, top: tip.y }} role="tooltip">
        {tip.lines.map((l, i) => (
          <span key={i} className={i === 0 ? styles.tipTitle : undefined}>
            {l}
          </span>
        ))}
      </div>
    )}
    </div>
  );
}
