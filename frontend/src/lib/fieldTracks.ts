import type { Epoch, GridWcs, Mover } from "./contract";

/** One mover's path through a patch of sky and through time, scaled for drawing. */
export interface TrackLine {
  id: string;
  name: string;
  /** A test source planted in the images: always labelled SIMULATED. */
  simulated: boolean;
  /** x: −1 (left of the image, east) to 1; y: −1 (south) to 1 (north); t: 0 (first image) to 1 (last). */
  pts: { x: number; y: number; t: number }[];
}

export interface FieldTracks {
  tracks: TrackLine[];
  /** When SPHEREx visited (exposures less than 30 minutes apart are one visit), as t in 0–1. */
  visits: number[];
  firstUtc: string;
  lastUtc: string;
  hours: number;
}

const VISIT_GAP_DAYS = 30 / (24 * 60);

/**
 * The movers of a field as lines in (sky x, sky y, time): a star would be a vertical line, a
 * moving object leans. Null when there is no time span or no track with two or more points.
 */
export function fieldTracks(
  wcs: Pick<GridWcs, "width_px" | "height_px">,
  epochs: Pick<Epoch, "mjd" | "time_utc">[],
  movers: Mover[],
  nameOf: (m: Mover) => string,
): FieldTracks | null {
  const times = epochs.filter((e) => Number.isFinite(e.mjd)).sort((a, b) => a.mjd - b.mjd);
  if (times.length < 2 || !(wcs.width_px > 0) || !(wcs.height_px > 0)) return null;
  const t0 = times[0]!.mjd;
  const span = times.at(-1)!.mjd - t0;
  if (!(span > 0)) return null;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const tracks: TrackLine[] = [];
  for (const m of movers) {
    const pts = m.track
      .filter((p) => [p.x_grid, p.y_grid, p.mjd].every(Number.isFinite))
      .sort((a, b) => a.mjd - b.mjd)
      .map((p) => ({
        x: clamp((p.x_grid / wcs.width_px) * 2 - 1),
        y: clamp((p.y_grid / wcs.height_px) * 2 - 1),
        t: Math.max(0, Math.min(1, (p.mjd - t0) / span)),
      }));
    if (pts.length >= 2) tracks.push({ id: m.candidate_id, name: nameOf(m), simulated: m.classification === "injected", pts });
  }
  if (!tracks.length) return null;
  const visits: number[] = [];
  let last = -Infinity;
  for (const e of times) {
    if (e.mjd - last > VISIT_GAP_DAYS) visits.push((e.mjd - t0) / span);
    last = e.mjd;
  }
  return { tracks, visits, firstUtc: times[0]!.time_utc, lastUtc: times.at(-1)!.time_utc, hours: span * 24 };
}
