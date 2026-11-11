"use client";

import { useMemo } from "react";
import type { Epoch, GridWcs, Mover } from "@/lib/contract";
import { fieldTracks, type FieldTracks } from "@/lib/fieldTracks";
import { formatHours } from "@/lib/format";
import { WhenVisible } from "../WhenVisible";
import { Figure3D } from "./Figure3D";
import styles from "./Figure3D.module.css";

const S = 320;

/** The tracks on the sky alone (north up, east left), as SVG: the fallback without WebGL. */
export function FieldTracksFlat({ data }: { data: FieldTracks }) {
  const xy = (p: { x: number; y: number }) => [((p.x + 1) / 2) * (S - 40) + 20, ((1 - p.y) / 2) * (S - 40) + 20] as const;
  return (
    <svg
      viewBox={`0 0 ${S} ${S}`}
      className={styles.flat}
      role="img"
      aria-label={`Paths of ${data.tracks.length} moving ${data.tracks.length === 1 ? "object" : "objects"} across this patch of sky over ${formatHours(data.hours)}`}
    >
      <rect x={20} y={20} width={S - 40} height={S - 40} fill="none" stroke="var(--text-muted)" strokeOpacity={0.6} />
      <text x={S / 2} y={14} textAnchor="middle">
        North
      </text>
      <text x={4} y={S / 2} transform={`rotate(-90 10 ${S / 2})`} textAnchor="middle">
        East
      </text>
      {data.tracks.map((tr) => {
        const color = tr.simulated ? "var(--cool)" : "var(--accent)";
        const first = xy(tr.pts[0]!);
        const last = xy(tr.pts.at(-1)!);
        return (
          <g key={tr.id}>
            <polyline points={tr.pts.map((p) => xy(p).map((v) => v.toFixed(1)).join(",")).join(" ")} fill="none" stroke={color} strokeWidth={1.5} />
            <circle cx={first[0]} cy={first[1]} r={3} fill="none" stroke={color} />
            <circle cx={last[0]} cy={last[1]} r={3.5} fill={color} />
            <text x={Math.min(last[0] + 6, S - 110)} y={Math.max(last[1] - 6, 32)} style={{ fill: color }}>
              {tr.simulated ? `${tr.name} (SIMULATED)` : tr.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * "The same patch, with time as the third dimension": shown under the blink viewer when the
 * field has at least one tracked mover. three.js loads only when this scrolls into view.
 */
export function FieldTracksPanel({
  wcs,
  epochs,
  movers,
  moverName,
}: {
  wcs: GridWcs;
  epochs: Epoch[];
  movers: Mover[];
  moverName: (m: Mover) => string;
}) {
  // Names change when the live JPL result arrives; the geometry does not.
  const names = movers.map(moverName).join("|");
  const data = useMemo(
    () => fieldTracks(wcs, epochs, movers, moverName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wcs, epochs, movers, names],
  );
  if (!data) return null;
  const n = data.tracks.length;
  return (
    <section className="card" aria-labelledby="tracks3d-title" style={{ padding: "var(--space-4)", marginTop: "var(--space-4)" }}>
      <h2 id="tracks3d-title" style={{ marginTop: 0, fontSize: "var(--text-lg)" }}>
        The same patch, with time as the third dimension
      </h2>
      <p style={{ color: "var(--text-muted)" }}>
        Stack every image of this patch in the order it was taken, {formatHours(data.hours)} from bottom to top. A star sits at the same
        spot in each, so it would draw a vertical line. {n === 1 ? "The moving object leans" : `The ${n} moving objects lean`} across the
        stack: each dot is one measured position, and the faint line on the floor is the path on the sky.
      </p>
      <WhenVisible minHeight={360}>
        <Figure3D load={() => import("./FieldTracksScene")} props={{ data }} flat={<FieldTracksFlat data={data} />} label="the 3D track view" />
      </WhenVisible>
    </section>
  );
}
