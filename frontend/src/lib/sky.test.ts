import { describe, expect, it } from "vitest";
import { MOLLWEIDE_HALF_WIDTH, cellPath, credibleLevels, eclipticToEquatorial, galacticToEquatorial, linePath, mollweide, wrap180 } from "./sky";

describe("mollweide", () => {
  it("maps the center, poles and edges", () => {
    expect(mollweide(0, 0).x).toBeCloseTo(0, 12);
    expect(mollweide(0, 0).y).toBeCloseTo(0, 12);
    expect(mollweide(0, 90).y).toBeCloseTo(Math.SQRT2, 9);
    expect(mollweide(0, -90).y).toBeCloseTo(-Math.SQRT2, 9);
    expect(Math.abs(mollweide(180, 0).x)).toBeCloseTo(MOLLWEIDE_HALF_WIDTH, 9);
  });

  it("puts increasing RA to the left, like the sky seen from inside", () => {
    expect(mollweide(30, 0).x).toBeLessThan(0);
    expect(mollweide(330, 0).x).toBeGreaterThan(0);
    expect(mollweide(30, 0, 30).x).toBeCloseTo(0, 12);
  });

  it("is equal-area: the latitude band area fraction matches the sphere", () => {
    // Fraction of the sphere above Dec 30° is (1 − sin 30°)/2 = 0.25; on the map it is the area
    // of the ellipse above y(30°): θ from 2θ + sin2θ = π/2.
    const y = mollweide(0, 30).y / Math.SQRT2;
    const t = Math.asin(y);
    const frac = (Math.PI / 2 - t - Math.sin(2 * t) / 2) / Math.PI;
    expect(frac).toBeCloseTo(0.25, 6);
  });
});

describe("frames", () => {
  it("wraps angles", () => {
    expect(wrap180(190)).toBe(-170);
    expect(wrap180(-180)).toBe(180);
    expect(wrap180(360)).toBe(0);
  });

  it("converts ecliptic to equatorial", () => {
    const s = eclipticToEquatorial(90, 0);
    expect(s.ra_deg).toBeCloseTo(90, 6);
    expect(s.dec_deg).toBeCloseTo(23.4392911, 6);
    const v = eclipticToEquatorial(0, 0);
    expect(v.ra_deg).toBeCloseTo(0, 6);
    expect(v.dec_deg).toBeCloseTo(0, 6);
  });

  it("converts galactic to equatorial (IAU reference points)", () => {
    const gc = galacticToEquatorial(0, 0);
    expect(gc.ra_deg).toBeCloseTo(266.405, 2);
    expect(gc.dec_deg).toBeCloseTo(-28.936, 2);
    const ngp = galacticToEquatorial(0, 90);
    expect(ngp.ra_deg).toBeCloseTo(192.859, 2);
    expect(ngp.dec_deg).toBeCloseTo(27.128, 2);
  });
});

describe("paths", () => {
  const id = (p: { x: number; y: number }) => p;
  it("breaks lines at the map edge", () => {
    const d = linePath([{ ra_deg: 170, dec_deg: 0 }, { ra_deg: 179, dec_deg: 0 }, { ra_deg: 181, dec_deg: 0 }, { ra_deg: 190, dec_deg: 0 }], id);
    expect(d.match(/M/g)).toHaveLength(2);
  });

  it("draws a closed cell", () => {
    const d = cellPath(10, 20, 5, id);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });
});

describe("credibleLevels", () => {
  it("takes the densest cells first until each level is reached", () => {
    const cells = [0.5, 0.2, 0.15, 0.1, 0.05, 0].map((f, i) => ({ ra_deg: i, dec_deg: 0, fraction: f }));
    expect(credibleLevels(cells)).toEqual([0.68, 0.68, 0.95, 0.95, null, null]);
  });

  it("normalises fractions that don't sum to 1", () => {
    const cells = [5, 2, 1.5, 1, 0.5].map((f, i) => ({ ra_deg: i, dec_deg: 0, fraction: f }));
    expect(credibleLevels(cells)).toEqual([0.68, 0.68, 0.95, 0.95, null]);
  });

  it("is empty without data", () => {
    expect(credibleLevels([])).toEqual([]);
  });
});
