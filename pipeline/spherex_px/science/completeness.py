"""Detection completeness as a function of (AB magnitude, sky rate), from an injection study.

Only measured numbers go in: the recovery fractions of SIMULATED linear-track objects on the
study's grid of magnitudes and rates, and the median sky rate the study measured for objects at
fixed heliocentric distances seen from SPHEREx's real position. Between grid points we
interpolate (linearly in magnitude and in log rate). Outside the grid we answer only where the
answer follows from the pipeline itself or from a measured bin, and say which:

- slower than the linker's minimum rate: 0, because the linker never forms such a track;
- faster than the fastest (or, above the linker minimum, slower than the slowest) rate studied:
  not measured (None);
- brighter than the brightest magnitude studied: the brightest bin's fraction if that is already
  at least 50% (brighter is easier, up to saturation), otherwise not measured;
- fainter than the faintest magnitude studied: the faintest bin's fraction if that is already
  below 50%, otherwise not measured.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Grid:
    mags: tuple[float, ...]
    rates: tuple[float, ...]
    # frac[i_rate][i_mag]
    frac: tuple[tuple[float, ...], ...]
    min_rate: float  # linker minimum, arcsec/hr

    @classmethod
    def from_cells(cls, cells, min_rate: float) -> Grid:
        """cells: iterables with mag_ab, rate_arcsec_per_hr, fraction (linear tracks only)."""
        mags = tuple(sorted({c.mag_ab for c in cells}))
        rates = tuple(sorted({c.rate_arcsec_per_hr for c in cells}))
        lookup = {(c.rate_arcsec_per_hr, c.mag_ab): c.fraction for c in cells}
        frac = tuple(tuple(float(lookup[(r, m)]) for m in mags) for r in rates)
        return cls(mags=mags, rates=rates, frac=frac, min_rate=min_rate)

    def column(self, rate: float) -> tuple[list[float] | None, str]:
        """Fractions at every magnitude bin for one rate, or None with the reason."""
        if rate < self.min_rate:
            return [0.0] * len(self.mags), "below_linker_minimum"
        if rate > self.rates[-1] or rate < self.rates[0]:
            return None, "faster_than_study" if rate > self.rates[-1] else "slower_than_study"
        lr = [math.log10(r) for r in self.rates]
        x = math.log10(rate)
        return [
            float(np.interp(x, lr, [self.frac[i][j] for i in range(len(self.rates))]))
            for j in range(len(self.mags))
        ], "measured"

    def fraction(self, mag: float, rate: float) -> tuple[float | None, str]:
        col, why = self.column(rate)
        if col is None:
            return None, why
        if why == "below_linker_minimum":
            return 0.0, why
        return at_mag(list(self.mags), col, mag)

    def best(self, rate: float) -> tuple[float | None, str]:
        col, why = self.column(rate)
        return (None if col is None else max(col)), why

    def m50(self, rate: float) -> float | None:
        col, _ = self.column(rate)
        return None if col is None else m50(list(self.mags), col)


def at_mag(mags: list[float], fracs: list[float], mag: float) -> tuple[float | None, str]:
    """Fraction at one magnitude from one column (rules in the module docstring)."""
    if mag < mags[0]:
        return (fracs[0], "measured") if fracs[0] >= 0.5 else (None, "brighter_than_study")
    if mag > mags[-1]:
        return (fracs[-1], "measured") if fracs[-1] < 0.5 else (None, "fainter_than_study")
    return float(np.interp(mag, mags, fracs)), "measured"


def m50(mags: list[float], fracs: list[float]) -> float | None:
    """Faintest magnitude where the fraction crosses 50% going faint (None if it never does)."""
    pts = list(zip(mags, fracs, strict=True))
    for (m1, f1), (m2, f2) in zip(pts, pts[1:], strict=False):
        if f1 >= 0.5 > f2:
            return round(m1 + (f1 - 0.5) / (f1 - f2) * (m2 - m1), 2)
    return None


@dataclass(frozen=True)
class RateModel:
    """Median sky rate versus heliocentric distance, as the study measured it (log-log)."""

    distances: tuple[float, ...]
    rates: tuple[float, ...]

    def rate(self, distance_au: float) -> float | None:
        """Interpolated rate; beyond the farthest distance the last segment's power law
        continues (only ever used to say an object is slower still). None inside the closest."""
        d, r = self.distances, self.rates
        if distance_au < d[0]:
            return None
        ld, lr = [math.log10(x) for x in d], [math.log10(x) for x in r]
        x = math.log10(distance_au)
        if x <= ld[-1]:
            return 10 ** float(np.interp(x, ld, lr))
        slope = (lr[-1] - lr[-2]) / (ld[-1] - ld[-2])
        return 10 ** (lr[-1] + slope * (x - ld[-1]))

    def distance_at(self, rate: float) -> float | None:
        """Distance where the median rate equals `rate` (rates fall with distance)."""
        d, r = self.distances, self.rates
        pairs = list(zip(d, r, strict=True))
        for (d1, r1), (d2, r2) in zip(pairs, pairs[1:], strict=False):
            if r1 >= rate >= r2 and r1 != r2:
                t = (math.log10(rate) - math.log10(r1)) / (math.log10(r2) - math.log10(r1))
                return 10 ** (math.log10(d1) + t * (math.log10(d2) - math.log10(d1)))
        return None


def log_grid(lo: float, hi: float, n: int) -> list[float]:
    return [float(x) for x in np.geomspace(lo, hi, n)]
