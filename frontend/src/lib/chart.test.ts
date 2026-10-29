import { describe, expect, it } from "vitest";
import { extent, niceTicks, rampColor, scale, wavelengthT } from "./chart";

describe("chart helpers", () => {
  it("makes round ticks", () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0.75, 5, 4)).toEqual([1, 2, 3, 4, 5]);
    expect(niceTicks(3, 3)).toEqual([3]);
  });

  it("pads extents and handles a single value", () => {
    expect(extent([0, 10], 0.1)).toEqual([-1, 11]);
    expect(extent([5])[0]).toBeLessThan(5);
    expect(extent([])).toEqual([0, 1]);
  });

  it("maps linearly", () => {
    expect(scale([0, 10], [100, 200])(5)).toBe(150);
  });

  it("colors the SPHEREx range from violet to yellow", () => {
    expect(wavelengthT(0.75)).toBeCloseTo(0);
    expect(wavelengthT(5)).toBeCloseTo(1);
    expect(rampColor(0)).toBe("rgb(74 12 107)");
    expect(rampColor(1)).toBe("rgb(247 209 61)");
  });
});
