import type { GridWcs } from "./contract";

/**
 * Converts a common-grid position (1-based FITS x_grid / y_grid) into
 * continuous image coordinates where (0, 0) is the top-left corner of the
 * rendered image, per docs/api-contract.md:
 *   col = x_grid - 0.5,  row = height_px - y_grid + 0.5
 */
export function gridToImage(x_grid: number, y_grid: number, heightPx: number): { col: number; row: number } {
  return { col: x_grid - 0.5, row: heightPx - y_grid + 0.5 };
}

const D2R = Math.PI / 180;

/**
 * Projects RA/Dec onto the field's TAN grid. Returns 1-based grid x/y with
 * north up and east left at rotation 0. Callers should validate against a
 * known detection before trusting it (see `projectionMatches`).
 */
export function skyToGrid(raDeg: number, decDeg: number, wcs: GridWcs): { x: number; y: number } | null {
  const [ra0, dec0] = wcs.crval;
  const [crpix1, crpix2] = wcs.crpix;
  if ([ra0, dec0, crpix1, crpix2, wcs.cdelt_arcsec].some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    return null;
  }
  const a = raDeg * D2R;
  const d = decDeg * D2R;
  const a0 = ra0! * D2R;
  const d0 = dec0! * D2R;
  const cosC = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  if (cosC <= 0) return null;
  // Standard coordinates in degrees: xi toward east, eta toward north.
  const xi = ((Math.cos(d) * Math.sin(a - a0)) / cosC) / D2R;
  const eta = ((Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosC) / D2R;
  const rot = (wcs.rotation_deg ?? 0) * D2R;
  const xr = xi * Math.cos(rot) - eta * Math.sin(rot);
  const yr = xi * Math.sin(rot) + eta * Math.cos(rot);
  const scale = wcs.cdelt_arcsec / 3600;
  // East is left, so x decreases as xi grows.
  return { x: crpix1! - xr / scale, y: crpix2! + yr / scale };
}

/** True when the projection reproduces known grid positions within `tolPx`. */
export function projectionMatches(
  points: { ra_deg: number; dec_deg: number; x_grid: number; y_grid: number }[],
  wcs: GridWcs,
  tolPx = 1,
): boolean {
  if (!points.length) return false;
  return points.every((p) => {
    const g = skyToGrid(p.ra_deg, p.dec_deg, wcs);
    return !!g && Math.hypot(g.x - p.x_grid, g.y - p.y_grid) <= tolPx;
  });
}
