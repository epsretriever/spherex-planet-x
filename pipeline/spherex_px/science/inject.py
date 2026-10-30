"""Synthetic moving sources injected into real SPHEREx cutouts (injection-recovery).

A synthetic source is rendered from the exposure's own PSF (the PSF extension, 10x
oversampled), scaled to a flat-spectrum AB magnitude, and added to the calibrated science image
with photon noise whose size is measured from the same exposure (VARIANCE grows linearly with
signal; the slope is fitted per exposure). The pipeline then runs unchanged.

Two kinds of track:
- linear: constant rate and direction on the sky, the motion of a nearby asteroid over a visit;
- parallax: a body at a fixed heliocentric distance on a circular prograde orbit in the
  ecliptic, seen from SPHEREx's actual position (Earth from the JPL ephemeris built into
  astropy, plus the spacecraft's geocentric position from each FITS header). Its apparent motion
  is the reflex of Earth's and SPHEREx's motion plus its own small orbital motion, which is how
  a distant planet would move.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from astropy.coordinates import get_body_barycentric
from astropy.time import Time
from scipy import ndimage

from .detect import Prepared
from .grid import tangent_offsets_arcsec, tangent_to_world

AU_KM = 149_597_870.7
GM_SUN_AU3_PER_DAY2 = 2.959122082855911e-4  # Gaussian gravitational constant squared
OBLIQUITY_RAD = math.radians(23.439281)


def ab_to_ujy(mag_ab: float) -> float:
    return 10 ** ((23.9 - mag_ab) / 2.5)


def native_kernel(
    psf: np.ndarray, oversample: int, fx: float, fy: float, size: int = 10
) -> np.ndarray:
    """PSF integrated over native pixels for a source at sub-pixel offset (fx, fy) in [-0.5, 0.5].

    The oversampled PSF is centered on element (n//2, n//2). The returned kernel is size x size
    native pixels; the source lies in pixel (size//2, size//2) at offset (fx, fy) from its center.
    It sums to the fraction of the PSF's total light that falls inside it (wings are lost, as in
    the measurement's aperture correction).
    """
    n = psf.shape[0]
    total = float(np.clip(psf, 0, None).sum())
    # Shift so that the source center lands at (size//2 + fx, size//2 + fy) native pixels in a
    # grid whose native pixel k covers oversampled elements [k*os, (k+1)*os).
    center_os = n // 2
    target = (size // 2 + 0.5) * oversample - 0.5
    sy = target + fy * oversample - center_os
    sx = target + fx * oversample - center_os
    shifted = ndimage.shift(np.clip(psf, 0, None), (sy, sx), order=1, mode="constant", cval=0.0)
    m = size * oversample
    block = shifted[:m, :m].reshape(size, oversample, size, oversample).sum(axis=(1, 3))
    return block / total if total > 0 else block


def noise_slope(prep: Prepared) -> float:
    """d(VARIANCE)/d(signal) for this exposure, (MJy/sr)^2 per MJy/sr, from its own pixels."""
    c = prep.cutout
    ok = ~prep.bad & np.isfinite(c.image) & np.isfinite(c.variance)
    img, var = c.image[ok], c.variance[ok]
    if img.size < 100:
        return 0.0
    lo, hi = np.percentile(img, [5, 99.5])
    bins = np.linspace(lo, hi, 25)
    idx = np.digitize(img, bins)
    xs, ys = [], []
    for k in range(1, len(bins)):
        sel = idx == k
        if sel.sum() >= 30:
            xs.append(np.median(img[sel]))
            ys.append(np.median(var[sel]))
    if len(xs) < 3:
        return 0.0
    slope = np.polyfit(xs, ys, 1)[0]
    return float(max(slope, 0.0))


@dataclass
class Injection:
    injection_id: str
    mag_ab: float
    model: str  # "linear" | "parallax"
    rate_arcsec_per_hr: float | None
    position_angle_deg: float | None
    distance_au: float | None
    positions: dict[int, tuple[float, float]]  # epoch index -> (ra, dec)


def inject(
    prep: Prepared, ra: float, dec: float, flux_ujy: float, slope: float, rng: np.random.Generator
) -> bool:
    """Add one source to prep.sci (and its noise to prep.sigma) in place. False if off-image."""
    c = prep.cutout
    if c.psf is None:
        return False
    x, y = c.wcs.all_world2pix([ra], [dec], 0)
    x, y = float(x[0]), float(y[0])
    ny, nx = prep.sci.shape
    if not (2 <= x < nx - 2 and 2 <= y < ny - 2):
        return False
    xi, yi = int(round(x)), int(round(y))
    k = native_kernel(c.psf, c.psf_oversample, x - xi, y - yi)
    h = k.shape[0] // 2
    y0, x0 = yi - h, xi - h
    ys, xs = (
        slice(max(y0, 0), min(y0 + k.shape[0], ny)),
        slice(max(x0, 0), min(x0 + k.shape[1], nx)),
    )
    kk = k[ys.start - y0 : ys.stop - y0, xs.start - x0 : xs.stop - x0]
    signal = kk * (flux_ujy / prep.ujy_per_mjysr)
    var_src = slope * signal
    noise = rng.normal(0.0, 1.0, signal.shape) * np.sqrt(var_src)
    region = prep.sci[ys, xs]
    good = np.isfinite(region)
    region[good] += (signal + noise)[good].astype(region.dtype)
    sig = prep.sigma[ys, xs]
    sig[good] = np.sqrt(sig[good] ** 2 + var_src[good]).astype(sig.dtype)
    return True


def linear_track(
    ra0: float, dec0: float, t_mid_mjd: float, rate: float, pa_deg: float, mjds: list[float]
) -> list[tuple[float, float]]:
    pa = math.radians(pa_deg)
    out = []
    for t in mjds:
        dt_h = (t - t_mid_mjd) * 24
        xi, eta = rate * dt_h * math.sin(pa), rate * dt_h * math.cos(pa)
        r, d = tangent_to_world([xi], [eta], ra0, dec0)
        out.append((float(r[0]), float(d[0])))
    return out


def _unit(ra_deg: float, dec_deg: float) -> np.ndarray:
    a, d = math.radians(ra_deg), math.radians(dec_deg)
    return np.array([math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)])


def _radec(v: np.ndarray) -> tuple[float, float]:
    v = v / np.linalg.norm(v)
    return math.degrees(math.atan2(v[1], v[0])) % 360, math.degrees(math.asin(v[2]))


def observer_au(mjd: float, sc_geo_km: np.ndarray) -> np.ndarray:
    """SPHEREx barycentric position (ICRS axes, AU): Earth + spacecraft geocentric offset."""
    e = get_body_barycentric("earth", Time(mjd, format="mjd", scale="utc")).xyz.to_value("AU")
    return np.asarray(e, float) + np.asarray(sc_geo_km, float) / AU_KM


def parallax_track(
    ra0: float,
    dec0: float,
    t_mid_mjd: float,
    distance_au: float,
    obs_mid: np.ndarray,
    observers: list[tuple[float, np.ndarray]],
) -> list[tuple[float, float]]:
    """Apparent positions of a body at heliocentric distance d seen at (ra0, dec0) at t_mid.

    The body is placed on the line of sight at the distance where |r| = d, and moves on a
    circular prograde orbit in the ecliptic plane (speed sqrt(GM/d)). Light time is ignored
    (it shifts every epoch almost equally over a two-day visit).
    """
    u = _unit(ra0, dec0)
    # solve |obs + rho*u| = d for rho > 0
    b = 2 * float(obs_mid @ u)
    c = float(obs_mid @ obs_mid) - distance_au**2
    disc = b * b - 4 * c
    if disc < 0:
        raise ValueError("line of sight never reaches that distance")
    rho = (-b + math.sqrt(disc)) / 2
    r0 = obs_mid + rho * u
    # ecliptic north pole in ICRS
    pole = np.array([0.0, -math.sin(OBLIQUITY_RAD), math.cos(OBLIQUITY_RAD)])
    tangential = np.cross(pole, r0)
    norm = np.linalg.norm(tangential)
    v = (
        tangential / norm * math.sqrt(GM_SUN_AU3_PER_DAY2 / distance_au)
        if norm > 0
        else np.zeros(3)
    )
    out = []
    for t, obs in observers:
        r = r0 + v * (t - t_mid_mjd)
        out.append(_radec(r - obs))
    return out


def track_rate(mjds: list[float], positions: list[tuple[float, float]]) -> float:
    """Mean sky rate of a track, arcsec/hr (first to last position)."""
    i, j = int(np.argmin(mjds)), int(np.argmax(mjds))
    if mjds[j] == mjds[i]:
        return 0.0
    xi, eta = tangent_offsets_arcsec(
        [positions[i][0], positions[j][0]],
        [positions[i][1], positions[j][1]],
        positions[i][0],
        positions[i][1],
    )
    return float(math.hypot(xi[1] - xi[0], eta[1] - eta[0]) / ((mjds[j] - mjds[i]) * 24))
