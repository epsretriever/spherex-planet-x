import { describe, expect, it } from "vitest";
import type { GridWcs } from "./contract";
import { gridToImage, projectionMatches, skyToGrid } from "./grid";

const wcs: GridWcs = { crval: [150, 2], crpix: [88, 88], cdelt_arcsec: 6.15, width_px: 175, height_px: 175, rotation_deg: 0 };

describe("gridToImage", () => {
  it("follows the contract's conversion", () => {
    // Bottom-left pixel center in FITS (1, 1) is the image's bottom-left pixel center.
    expect(gridToImage(1, 1, 175)).toEqual({ col: 0.5, row: 174.5 });
    expect(gridToImage(1, 175, 175)).toEqual({ col: 0.5, row: 0.5 });
  });
});

describe("skyToGrid", () => {
  it("puts the reference position at the reference pixel", () => {
    const g = skyToGrid(150, 2, wcs)!;
    expect(g.x).toBeCloseTo(88);
    expect(g.y).toBeCloseTo(88);
  });

  it("puts north up and east left", () => {
    const north = skyToGrid(150, 2 + 61.5 / 3600, wcs)!;
    expect(north.y).toBeCloseTo(98, 1);
    const east = skyToGrid(150 + 61.5 / 3600 / Math.cos((2 * Math.PI) / 180), 2, wcs)!;
    expect(east.x).toBeCloseTo(78, 1);
  });

  it("is checked against known positions before use", () => {
    const p = { ra_deg: 150.01, dec_deg: 2.01 };
    const g = skyToGrid(p.ra_deg, p.dec_deg, wcs)!;
    expect(projectionMatches([{ ...p, x_grid: g.x, y_grid: g.y }], wcs)).toBe(true);
    expect(projectionMatches([{ ...p, x_grid: g.x + 5, y_grid: g.y }], wcs)).toBe(false);
    expect(projectionMatches([], wcs)).toBe(false);
  });
});
