"""The common tangent-plane grid every field image and x_grid/y_grid refer to."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from astropy.wcs import WCS
from reproject import reproject_interp

from ..schemas import GridWcs

DEFAULT_CDELT_ARCSEC = 6.15


@dataclass(frozen=True)
class Grid:
    ra_deg: float
    dec_deg: float
    size_deg: float
    cdelt_arcsec: float = DEFAULT_CDELT_ARCSEC

    @property
    def width_px(self) -> int:
        n = int(math.ceil(self.size_deg * 3600 / self.cdelt_arcsec))
        return n + (n % 2)  # even, so the center falls on a pixel corner

    @property
    def height_px(self) -> int:
        return self.width_px

    @property
    def crpix(self) -> tuple[float, float]:
        return (self.width_px / 2 + 0.5, self.height_px / 2 + 0.5)

    def wcs(self) -> WCS:
        w = WCS(naxis=2)
        w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        w.wcs.crval = [self.ra_deg, self.dec_deg]
        w.wcs.crpix = list(self.crpix)
        d = self.cdelt_arcsec / 3600
        w.wcs.cdelt = [-d, d]  # north up, east left
        w.pixel_shape = (self.width_px, self.height_px)
        return w

    def contract(self) -> GridWcs:
        return GridWcs(
            crval=[round(self.ra_deg, 7), round(self.dec_deg, 7)],
            crpix=list(self.crpix),
            cdelt_arcsec=self.cdelt_arcsec,
            width_px=self.width_px,
            height_px=self.height_px,
            rotation_deg=0.0,
        )

    def world_to_grid(self, ra, dec) -> tuple[np.ndarray, np.ndarray]:
        """1-based FITS grid coordinates (contract x_grid, y_grid)."""
        x, y = self.wcs().all_world2pix(np.atleast_1d(ra), np.atleast_1d(dec), 1)
        return x, y

    def reproject(self, data: np.ndarray, wcs: WCS) -> np.ndarray:
        out, footprint = reproject_interp(
            (data, wcs), self.wcs(), shape_out=(self.height_px, self.width_px)
        )
        out[footprint == 0] = np.nan
        return out.astype(np.float32)


def tangent_offsets_arcsec(ra, dec, ra0: float, dec0: float) -> tuple[np.ndarray, np.ndarray]:
    """Gnomonic (xi, eta) offsets in arcsec of (ra, dec) about (ra0, dec0); xi points east."""
    ra, dec = np.radians(np.asarray(ra, float)), np.radians(np.asarray(dec, float))
    a0, d0 = math.radians(ra0), math.radians(dec0)
    cosc = np.sin(d0) * np.sin(dec) + np.cos(d0) * np.cos(dec) * np.cos(ra - a0)
    xi = np.cos(dec) * np.sin(ra - a0) / cosc
    eta = (np.cos(d0) * np.sin(dec) - np.sin(d0) * np.cos(dec) * np.cos(ra - a0)) / cosc
    k = 180 / math.pi * 3600
    return xi * k, eta * k


def tangent_to_world(
    xi_arcsec, eta_arcsec, ra0: float, dec0: float
) -> tuple[np.ndarray, np.ndarray]:
    k = math.pi / 180 / 3600
    xi, eta = np.asarray(xi_arcsec, float) * k, np.asarray(eta_arcsec, float) * k
    a0, d0 = math.radians(ra0), math.radians(dec0)
    denom = np.cos(d0) - eta * np.sin(d0)
    ra = a0 + np.arctan2(xi, denom)
    dec = np.arctan2(np.sin(d0) + eta * np.cos(d0), np.hypot(xi, denom))
    return np.degrees(ra) % 360, np.degrees(dec)


def angular_sep_arcsec(ra1, dec1, ra2, dec2) -> np.ndarray:
    ra1, dec1, ra2, dec2 = (np.radians(np.asarray(v, float)) for v in (ra1, dec1, ra2, dec2))
    s = np.sin((dec2 - dec1) / 2) ** 2 + np.cos(dec1) * np.cos(dec2) * np.sin((ra2 - ra1) / 2) ** 2
    return np.degrees(2 * np.arcsin(np.sqrt(np.clip(s, 0, 1)))) * 3600
