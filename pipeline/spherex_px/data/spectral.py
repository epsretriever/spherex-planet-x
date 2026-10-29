"""Wavelength handling for SPHEREx's linear variable filters.

Each Level 2 file has a WCS-WAVE binary table: control points X[nx], Y[ny] in 1-based FITS
pixel coordinates and VALUES[ny, nx, 2] holding (central wavelength, bandwidth) in microns.
Per-pixel values come from bilinear interpolation between control points (FITS Paper III
-TAB convention, as declared by CTYPE1W = 'WAVE-TAB').

The 102 spectral channels (detector, sub-channel, wavelength range, resolving power) come
from the mission's spectral_channels calibration file, recorded in config/spectral_channels.csv.
"""

from __future__ import annotations

import csv
import functools
from dataclasses import dataclass
from importlib import resources

import numpy as np


@dataclass(frozen=True)
class WaveTable:
    x: np.ndarray  # (nx,) 1-based pixel x of control points
    y: np.ndarray  # (ny,) 1-based pixel y of control points
    values: np.ndarray  # (ny, nx, 2): [..., 0] wavelength um, [..., 1] bandwidth um

    @classmethod
    def from_bintable_bytes(cls, header, data: bytes) -> WaveTable:
        """Decode the single-row WCS-WAVE table from raw FITS bytes (big-endian)."""
        cols = {}
        offset = 0
        for i in range(1, header["TFIELDS"] + 1):
            name = header[f"TTYPE{i}"].strip()
            form = header[f"TFORM{i}"].strip()
            count = int(form[:-1] or 1)
            code = form[-1]
            dtype = {"J": ">i4", "E": ">f4", "D": ">f8", "K": ">i8", "I": ">i2"}[code]
            nbytes = count * np.dtype(dtype).itemsize
            arr = np.frombuffer(data[offset : offset + nbytes], dtype=dtype).astype(float)
            tdim = header.get(f"TDIM{i}")
            if tdim:
                dims = [int(d) for d in tdim.strip("() ").split(",")]
                arr = arr.reshape(dims[::-1])  # FITS order -> C order
            cols[name] = arr
            offset += nbytes
        return cls(x=cols["X"], y=cols["Y"], values=cols["VALUES"])

    def evaluate(self, x_fits: np.ndarray, y_fits: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """(wavelength_um, bandwidth_um) at 1-based FITS pixel coordinates."""
        x_fits = np.asarray(x_fits, dtype=float)
        y_fits = np.asarray(y_fits, dtype=float)
        ix = np.clip(np.searchsorted(self.x, x_fits, side="right") - 1, 0, len(self.x) - 2)
        iy = np.clip(np.searchsorted(self.y, y_fits, side="right") - 1, 0, len(self.y) - 2)
        x0, x1 = self.x[ix], self.x[ix + 1]
        y0, y1 = self.y[iy], self.y[iy + 1]
        tx = np.where(x1 > x0, (x_fits - x0) / np.where(x1 > x0, x1 - x0, 1), 0.0)
        ty = np.where(y1 > y0, (y_fits - y0) / np.where(y1 > y0, y1 - y0, 1), 0.0)
        tx = np.clip(tx, 0, 1)[..., None]
        ty = np.clip(ty, 0, 1)[..., None]
        v = self.values
        out = (
            v[iy, ix] * (1 - tx) * (1 - ty)
            + v[iy, ix + 1] * tx * (1 - ty)
            + v[iy + 1, ix] * (1 - tx) * ty
            + v[iy + 1, ix + 1] * tx * ty
        )
        return out[..., 0], out[..., 1]

    def grid(self, x0: int, x1: int, y0: int, y1: int) -> tuple[np.ndarray, np.ndarray]:
        """Per-pixel maps for the 0-based native pixel box [x0, x1) x [y0, y1)."""
        yy, xx = np.mgrid[y0:y1, x0:x1]
        return self.evaluate(xx + 1.0, yy + 1.0)


@dataclass(frozen=True)
class Channel:
    band_index: int  # 0..101
    detector: int
    subchannel: int
    wavelength_um: float
    wl_min_um: float
    wl_max_um: float
    resolving_power: float
    bandwidth_um: float


@functools.cache
def channels() -> tuple[Channel, ...]:
    text = resources.files("spherex_px.config").joinpath("spectral_channels.csv").read_text()
    rows = [
        r for r in csv.DictReader(line for line in text.splitlines() if not line.startswith("#"))
    ]
    out = []
    for i, r in enumerate(rows):
        out.append(
            Channel(
                band_index=i,
                detector=int(r["detector"]),
                subchannel=int(r["subchannel"]),
                wavelength_um=float(r["wavelength_um"]),
                wl_min_um=float(r["wl_min_um"]),
                wl_max_um=float(r["wl_max_um"]),
                resolving_power=float(r["resolving_power"]),
                bandwidth_um=float(r["bandwidth_um"]),
            )
        )
    return tuple(out)


def band_index(detector: int, wavelength_um: float) -> int | None:
    """Channel of `detector` whose central wavelength is closest to `wavelength_um`."""
    best = None
    for ch in channels():
        if ch.detector != detector:
            continue
        d = abs(ch.wavelength_um - wavelength_um)
        if best is None or d < best[0]:
            best = (d, ch.band_index)
    if best is None:
        return None
    ch = channels()[best[1]]
    # outside the detector's coverage by more than one channel width -> no channel
    if (
        wavelength_um < ch.wl_min_um - ch.bandwidth_um
        or wavelength_um > ch.wl_max_um + ch.bandwidth_um
    ):
        return None
    return best[1]


def resolving_power(detector: int, wavelength_um: float) -> float:
    idx = band_index(detector, wavelength_um)
    if idx is None:
        return min(c.resolving_power for c in channels() if c.detector == detector)
    return channels()[idx].resolving_power


def lambda_match_tolerance(detector_a: int, lam_a: float, detector_b: int, lam_b: float) -> float:
    """Fractional tolerance 1/(2R) for calling two wavelengths matched (smaller R wins)."""
    r = min(resolving_power(detector_a, lam_a), resolving_power(detector_b, lam_b))
    return 1.0 / (2.0 * r)
