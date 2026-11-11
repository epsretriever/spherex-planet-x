import { describe, expect, it } from "vitest";
import { norm } from "./orbit";
import { planetRing, rangeSegment, systemBody, systemExtent, systemPlanets, systemReach } from "./system";

const orbit = { epoch_mjd: 60848.02, a_au: 2.4, e: 0, i_deg: 0, node_deg: 0, peri_deg: 0, mean_anomaly_deg: 90, helio_distance_au: { lo: 1.8, hi: 2.9 } };

describe("solar-system view data", () => {
  it("places a body where its orbit puts it at the epoch", () => {
    const b = systemBody("obj-a", "Object A", orbit)!;
    expect(b.p[0]).toBeCloseTo(0, 3);
    expect(b.p[1]).toBeCloseTo(2.4, 3);
    expect(b.p[2]).toBeCloseTo(0, 3);
    expect(b.date).toBe("2025-06-22");
    expect(b.range).toEqual([1.8, 2.9]);
  });

  it("skips orbits that can't be drawn", () => {
    expect(systemBody("x", "x", null)).toBeNull();
    expect(systemBody("x", "x", { ...orbit, e: 1.2 })).toBeNull();
    expect(systemBody("x", "x", { ...orbit, a_au: Number.NaN })).toBeNull();
  });

  it("draws the distance range along the line from the Sun", () => {
    const b = systemBody("obj-a", "Object A", orbit)!;
    const [lo, hi] = rangeSegment(b)!;
    expect(norm(lo)).toBeCloseTo(1.8, 6);
    expect(norm(hi)).toBeCloseTo(2.9, 6);
    expect(lo[0] / norm(lo)).toBeCloseTo(b.p[0] / norm(b.p), 6);
    expect(rangeSegment({ ...b, range: null })).toBeNull();
  });

  it("frames the bulk of the objects, past Jupiter, and keeps outer planets only when needed", () => {
    const b = systemBody("obj-a", "Object A", orbit)!;
    const far = { ...b, id: "far", p: [0, 20, 0] as [number, number, number] };
    const many = [...Array.from({ length: 99 }, () => b), far];
    expect(systemReach([b])).toBeCloseTo(5.6);
    expect(systemReach(many)).toBeCloseTo(5.6); // one outlier doesn't shrink the view
    expect(systemExtent(many)).toBe(20);
    expect(systemPlanets(systemExtent([b])).map((p) => p.name)).toEqual(["Earth", "Mars", "Jupiter"]);
    expect(systemPlanets(systemExtent(many)).map((p) => p.name)).toEqual(["Earth", "Mars", "Jupiter", "Saturn", "Uranus"]);
    expect(planetRing(systemPlanets(3)[0]!, 8)).toHaveLength(9);
  });
});
