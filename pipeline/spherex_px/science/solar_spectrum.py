"""The Sun's spectrum at SPHEREx wavelengths: a shared helper for reflectance and thermal work.

Anything that turns an asteroid's measured flux into reflectance (flux divided by sunlight)
needs the solar flux density in the same spectral channel. This module provides it from the
ASTM E490-00a (2014) air-mass-zero reference spectrum (``config/solar_e490_2014.csv``, the
0.45-5.6 um rows of the table distributed with sbpy), averaged over each channel's bandwidth.

Units: wavelengths in microns, flux densities F_nu in microjansky (the unit of SPHEREx
photometry in this project), at 1 AU from the Sun unless ``r_au`` is given (inverse square).
"""

from __future__ import annotations

from functools import lru_cache
from importlib import resources

import numpy as np

#: Speed of light, m/s.
C_M_S = 299_792_458.0
#: 1 microjansky in W m^-2 Hz^-1.
UJY = 1e-32
#: Range of the bundled table, um.
TABLE_MIN_UM, TABLE_MAX_UM = 0.4505, 5.6
SOURCE = "ASTM E490-00a (2014) zero-air-mass solar spectrum (doi:10.1520/E0490)"


@lru_cache(maxsize=1)
def _table() -> tuple[np.ndarray, np.ndarray]:
    text = resources.files("spherex_px.config").joinpath("solar_e490_2014.csv").read_text()
    rows = [
        line.split(",")
        for line in text.splitlines()
        if line and not line.startswith("#") and line[0].isdigit()
    ]
    a = np.array(rows, dtype=float)
    return a[:, 0], a[:, 1]


def solar_flambda(wavelength_um) -> np.ndarray:
    """Solar spectral irradiance at 1 AU, W m^-2 um^-1 (linear interpolation of the table)."""
    lam, flam = _table()
    w = np.asarray(wavelength_um, float)
    if np.any((w < TABLE_MIN_UM) | (w > TABLE_MAX_UM)):
        raise ValueError(f"wavelength outside {TABLE_MIN_UM}-{TABLE_MAX_UM} um")
    return np.interp(w, lam, flam)


def solar_fnu_ujy(wavelength_um, bandwidth_um=None, r_au=1.0) -> np.ndarray:
    """Solar flux density F_nu (uJy) at ``r_au``, averaged over each channel.

    The channel is a top-hat ``wavelength_um +- bandwidth_um / 2`` (SPHEREx's channels are
    lambda / R wide, R ~ 40-130); without a bandwidth the spectrum is sampled at the centre.
    F_nu = F_lambda * lambda^2 / c, averaged in F_lambda over the channel.
    """
    w = np.atleast_1d(np.asarray(wavelength_um, float))
    if bandwidth_um is None:
        flam = solar_flambda(w)
    else:
        bw = np.broadcast_to(np.asarray(bandwidth_um, float), w.shape)
        offs = np.linspace(-0.5, 0.5, 21)
        grid = np.clip(w[:, None] + bw[:, None] * offs[None, :], TABLE_MIN_UM, TABLE_MAX_UM)
        flam = solar_flambda(grid).mean(axis=1)
    # W m^-2 um^-1 -> W m^-2 m^-1 (x 1e6); lambda in m.
    fnu = flam * 1e6 * (w * 1e-6) ** 2 / C_M_S / UJY
    out = fnu / np.asarray(r_au, float) ** 2
    return out if np.ndim(wavelength_um) else float(out[0])


def solar_constant_w_m2(lo_um: float = TABLE_MIN_UM, hi_um: float = TABLE_MAX_UM) -> float:
    """Integrated irradiance of the table between two wavelengths (a self-check)."""
    lam, flam = _table()
    m = (lam >= lo_um) & (lam <= hi_um)
    return float(np.trapezoid(flam[m], lam[m]))
