import { describe, expect, it } from "vitest";
import type { Mover } from "./contract";
import { fieldTracks } from "./fieldTracks";

const wcs = { width_px: 100, height_px: 100 };
const epochs = [
  { mjd: 60000, time_utc: "2023-02-25T00:00:00Z" },
  { mjd: 60000.005, time_utc: "2023-02-25T00:07:12Z" },
  { mjd: 60001, time_utc: "2023-02-26T00:00:00Z" },
];
const mover = (id: string, classification: Mover["classification"], pts: [number, number, number][]): Mover =>
  ({
    candidate_id: id,
    classification,
    label_plain: "",
    quality_level: "high",
    rate_arcsec_per_hr: 30,
    track: pts.map(([x, y, mjd], i) => ({ epoch_id: `e${i}`, time_utc: "", mjd, ra_deg: 0, dec_deg: 0, x_grid: x, y_grid: y })),
  }) as Mover;

describe("fieldTracks", () => {
  it("scales positions to the image and time to the field's span, in time order", () => {
    const ft = fieldTracks(wcs, epochs, [mover("a", "unmatched", [[75, 50, 60001], [25, 50, 60000]])], (m) => m.candidate_id)!;
    expect(ft.tracks[0]!.pts).toEqual([
      { x: -0.5, y: 0, t: 0 },
      { x: 0.5, y: 0, t: 1 },
    ]);
    expect(ft.hours).toBeCloseTo(24);
    expect(ft.visits).toHaveLength(2); // exposures 7 minutes apart are one visit
  });

  it("keeps simulated movers marked", () => {
    const ft = fieldTracks(wcs, epochs, [mover("s", "injected", [[10, 10, 60000], [20, 20, 60001]])], () => "x")!;
    expect(ft.tracks[0]!.simulated).toBe(true);
  });

  it("is null without a time span or a track of two points", () => {
    expect(fieldTracks(wcs, epochs.slice(0, 1), [mover("a", "unmatched", [[1, 1, 60000], [2, 2, 60001]])], () => "x")).toBeNull();
    expect(fieldTracks(wcs, epochs, [mover("a", "unmatched", [[1, 1, 60000]])], () => "x")).toBeNull();
    expect(fieldTracks(wcs, epochs, [], () => "x")).toBeNull();
  });
});
