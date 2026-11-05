import { describe, expect, it } from "vitest";
import { complexName, logT, pct, plotted, reflectanceDomain, wavelengthDomain } from "./composition";
import type { CompositionPoint, ObjectComposition } from "./contract";

const pt = (w: number, r: number | null, use: CompositionPoint["use"] = "taxonomy"): CompositionPoint => ({
  band_index: 1,
  wavelength_um: w,
  epoch_id: "e01",
  mjd: 60000,
  flux_ujy: 100,
  flux_err_ujy: 5,
  geometry_factor: 1,
  reflectance: r,
  reflectance_err: r === null ? null : 0.1,
  thermal_fraction: null,
  use,
  excluded_reason: r === null ? "thermal emission may be more than 10% of the light" : null,
});

const comp = { points: [pt(0.8, 0.9), pt(1.1, 1.0), pt(2.9, 0.95, "hydration"), pt(4.5, null, "none")], taxonomy: null } as unknown as ObjectComposition;

describe("composition helpers", () => {
  it("splits points by use", () => {
    const p = plotted(comp);
    expect(p.used).toHaveLength(2);
    expect(p.other).toHaveLength(1);
    expect(p.excluded).toHaveLength(1);
  });
  it("chooses domains that cover the data", () => {
    const [a, b] = wavelengthDomain(comp);
    expect(a).toBe(0.7);
    expect(b).toBeGreaterThan(4.5);
    const [lo, hi] = reflectanceDomain(comp);
    expect(lo).toBeLessThan(0.8);
    expect(hi).toBeGreaterThan(1.1);
    expect(logT(0.7, [0.7, 5])).toBe(0);
    expect(logT(5, [0.7, 5])).toBeCloseTo(1);
  });
  it("formats", () => {
    expect(complexName("S")).toBe("Stony (S)");
    expect(complexName(null)).toBe("—");
    expect(pct(0.123, 1)).toBe("12.3%");
    expect(pct(null)).toBe("—");
  });
});
