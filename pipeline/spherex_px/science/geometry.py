"""Observing geometry of a detection: distance from the Sun, from SPHEREx, and phase angle.

A shared helper for anything that converts measured flux into a physical property (reflectance,
size, albedo): those all need r (object-Sun distance), delta (object-observer distance) and the
phase angle alpha (Sun-object-observer angle).

Sources of geometry, best first:

- **JPL Horizons** for objects JPL identified (r, delta and alpha per detection time, pulled in
  CI by ``spherex-px thermal-inputs``; the sandbox that builds the site cannot reach JPL).
- **JPL's orbital elements** (SBDB) for identified objects when Horizons did not answer,
  propagated here with two-body motion.
- **Our own orbit clones** for everything else: every clone of the preliminary orbit
  (``orbits.py``) is propagated to each detection time, so the spread of the clones becomes the
  spread of r, delta and alpha.

Positions are heliocentric ICRS in AU (``science/orbit.py`` conventions). Observer positions are
Earth (astropy's built-in ephemeris) plus SPHEREx's geocentric offset from the FITS headers.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import orbit as O


@dataclass(frozen=True)
class Geometry:
    """Arrays of shape (n_samples, n_epochs)."""

    r_au: np.ndarray
    delta_au: np.ndarray
    alpha_deg: np.ndarray
    source: str

    @property
    def n_samples(self) -> int:
        return self.r_au.shape[0]

    def take(self, idx: np.ndarray) -> Geometry:
        return Geometry(self.r_au[idx], self.delta_au[idx], self.alpha_deg[idx], self.source)

    def median(self) -> Geometry:
        """The single sample closest to the median distance from the Sun (a consistent set)."""
        rmean = self.r_au.mean(axis=1)
        k = int(np.argmin(np.abs(rmean - np.median(rmean))))
        return self.take(np.array([k]))


def from_vectors(obj_helio: np.ndarray, obs_helio: np.ndarray) -> tuple[np.ndarray, ...]:
    """(r, delta, alpha_deg) from heliocentric object and observer positions (..., 3)."""
    obj = np.asarray(obj_helio, float)
    obs = np.asarray(obs_helio, float)
    to_obs = obs - obj
    r = np.linalg.norm(obj, axis=-1)
    delta = np.linalg.norm(to_obs, axis=-1)
    cos_a = np.einsum("...i,...i->...", -obj, to_obs) / np.maximum(r * delta, 1e-300)
    return r, delta, np.degrees(np.arccos(np.clip(cos_a, -1, 1)))


def from_states(
    r0: np.ndarray, v0: np.ndarray, epoch_tdb: float, mjd_utc: np.ndarray, sc_geo_km
) -> Geometry:
    """Geometry of N heliocentric states (r0, v0 at ``epoch_tdb``) at each detection time.

    Light time is ignored (it changes r and delta by far less than their uncertainty).
    """
    r0 = np.atleast_2d(np.asarray(r0, float))
    v0 = np.atleast_2d(np.asarray(v0, float))
    t = np.atleast_1d(np.asarray(mjd_utc, float))
    obs = O.observer_helio(t, sc_geo_km)  # (n_epochs, 3)
    n = r0.shape[0]
    rs = np.empty((n, len(t)))
    ds = np.empty_like(rs)
    als = np.empty_like(rs)
    for j, tj in enumerate(t):
        dt = (tj + O.TDB_MINUS_UTC) - epoch_tdb
        pos, _ = O.propagate(r0, v0, np.full(n, dt))
        rs[:, j], ds[:, j], als[:, j] = from_vectors(pos, obs[j][None, :])
    ok = np.all(np.isfinite(rs) & np.isfinite(ds) & np.isfinite(als), axis=1)
    if not ok.any():
        raise ValueError("no clone could be propagated")
    return Geometry(rs[ok], ds[ok], als[ok], "orbit_clones")


def from_elements(
    elements: list[float], epoch_tdb: float, mjd_utc, sc_geo_km, source: str
) -> Geometry:
    """Geometry from one set of ecliptic J2000 elements [a, e, i, node, peri, M] (deg)."""
    r0, v0 = O.state_from_elements(np.asarray(elements, float)[None, :])
    g = from_states(r0, v0, epoch_tdb, mjd_utc, sc_geo_km)
    return Geometry(g.r_au, g.delta_au, g.alpha_deg, source)


def fixed(r_au, delta_au, alpha_deg, source: str) -> Geometry:
    """One known geometry per epoch (e.g. JPL Horizons), as a single sample."""

    def row(x):
        return np.asarray(x, float).reshape(1, -1)

    return Geometry(row(r_au), row(delta_au), row(alpha_deg), source)
