"""How bright a distant planet would look to SPHEREx: reflected sunlight plus thermal emission.

Every input is a stated assumption; the outputs are predictions, never observations.

Reflected light (standard asteroid/planet scaling, phase angle ~0):
    F_nu,refl(lambda) = F_nu,sun(lambda, 1 AU) * p * (R / 1 AU)^2 / (r^2 * Delta^2)
with r and Delta in AU. This is the same relation as D = 1329 km / sqrt(p) * 10^(-H/5) with
V = H + 5 log10(r * Delta) (Bowell et al. 1989; Harris & Lagerros 2002), because 1329 km is the
diameter of a p = 1 body with H = 0 for a solar V of -26.76. The solar spectrum is a 5772 K
blackbody (IAU 2015 Resolution B3; Prsa et al. 2016, AJ 152, 41) scaled so that its J-band
(1.25 um) AB magnitude is -26.76 - 0.27, the solar V - J_AB colour of Willmer (2018, ApJS 236,
47) that `injection.planet_mag_ab` already uses. A blackbody is only an approximation of the
solar continuum at 0.75-5 um (to roughly 10-20%).

Thermal emission (simple blackbody):
    T^4 = T_eq^4 + T_int^4,  T_eq = 278.3 K * (1 - A)^(1/4) * r^(-1/2)
    F_nu,th(lambda) = pi * B_nu(lambda, T) * (R / Delta)^2
T_eq is the equilibrium temperature of a fast-rotating sphere with Bond albedo A (taken equal to
the geometric albedo here) and emissivity 1; T_int adds internal heat as an effective temperature
floor (Neptune: 59 K effective vs 47 K equilibrium, Pearl & Conrath 1991, JGR 96, 18921; a
10 Earth-mass Planet Nine: 47 K, Linder & Mordasini 2016, A&A 589, A134). For any T below about
150 K a blackbody gives almost nothing at 3-5 um (the Wien tail). Real cold giant atmospheres are
very far from blackbodies there: Fortney et al. (2016, ApJL 824, L25) find 3-5 um thermal fluxes
~20 orders of magnitude above blackbody expectations, because the 4-5 um window shows deeper,
warmer layers. We do not model that; it is the main reason the thermal term here is a lower bound.

Viewing geometry: SPHEREx points about 90 degrees from the Sun (it scans great circles
perpendicular to the Sun-Earth line), so Delta = sqrt(r^2 - 1) AU for an object at heliocentric
distance r, with phase angle asin(1/r). The phase function is taken as 1 (no darkening), which
is optimistic at small r (30 degrees at 2 AU, 6 degrees at 10 AU, 2 degrees at 30 AU).
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

H_PLANCK = 6.62607015e-34
C_LIGHT = 2.99792458e8
K_BOLTZ = 1.380649e-23
AU_M = 1.495978707e11
R_SUN_M = 6.957e8  # IAU 2015 nominal solar radius
T_SUN_K = 5772.0  # IAU 2015 nominal solar effective temperature
AB_ZERO_JY = 3631.0
SOLAR_V = -26.76  # implied by the 1329 km constant
SOLAR_V_MINUS_J_AB = 0.27  # Willmer 2018
J_UM = 1.25
SOLAR_J_AB = SOLAR_V - SOLAR_V_MINUS_J_AB
T_EQ_1AU_K = (
    278.3  # (S / 4 sigma)^(1/4) for A = 0, solar constant S = 1361 W m^-2 (Kopp & Lean 2011)
)

EARTH_DIAMETER_KM = 12_742.0
NEPTUNE_DIAMETER_KM = 49_528.0

CHANNELS_CSV = Path(__file__).resolve().parents[1] / "config" / "spectral_channels.csv"


@dataclass(frozen=True)
class Band:
    detector: int
    wl_min_um: float
    wl_max_um: float
    wl_eff_um: float
    channels_um: tuple[float, ...]


@lru_cache(maxsize=1)
def spherex_bands() -> tuple[Band, ...]:
    """SPHEREx's six detectors with the wavelengths of their spectral channels (IRSA calibration)."""
    rows: dict[int, list[tuple[float, float, float]]] = {}
    with CHANNELS_CSV.open() as fh:
        for r in csv.DictReader(ln for ln in fh if not ln.startswith("#")):
            rows.setdefault(int(r["detector"]), []).append(
                (float(r["wavelength_um"]), float(r["wl_min_um"]), float(r["wl_max_um"]))
            )
    out = []
    for det in sorted(rows):
        ch = sorted(rows[det])
        wls = tuple(c[0] for c in ch)
        out.append(
            Band(
                detector=det,
                wl_min_um=min(c[1] for c in ch),
                wl_max_um=max(c[2] for c in ch),
                wl_eff_um=round(sum(wls) / len(wls), 3),
                channels_um=wls,
            )
        )
    return tuple(out)


def planck_nu(wl_um: float, t_k: float) -> float:
    """B_nu in W m^-2 Hz^-1 sr^-1; 0 for T <= 0 or when the Wien exponent underflows."""
    if t_k <= 0:
        return 0.0
    nu = C_LIGHT / (wl_um * 1e-6)
    x = H_PLANCK * nu / (K_BOLTZ * t_k)
    if x > 700:
        return 0.0
    return 2 * H_PLANCK * nu**3 / C_LIGHT**2 / math.expm1(x)


def ab_to_jy(mag: float) -> float:
    return AB_ZERO_JY * 10 ** (-0.4 * mag)


def jy_to_ab(jy: float) -> float:
    return math.inf if jy <= 0 else -2.5 * math.log10(jy / AB_ZERO_JY)


@lru_cache(maxsize=4096)
def solar_flux_jy(wl_um: float) -> float:
    """Solar F_nu at 1 AU (Jy): blackbody shape, anchored at J to the solar J_AB magnitude."""
    return ab_to_jy(SOLAR_J_AB) * planck_nu(wl_um, T_SUN_K) / planck_nu(J_UM, T_SUN_K)


def observer_distance_au(r_au: float) -> float:
    """Distance from SPHEREx to an object at heliocentric distance r seen 90 degrees from the Sun."""
    if r_au <= 1.0:
        raise ValueError("SPHEREx's 90-degree pointing only reaches objects beyond 1 AU")
    return math.sqrt(r_au * r_au - 1.0)


def temperature_k(r_au: float, bond_albedo: float, t_int_k: float = 0.0) -> float:
    t_eq = T_EQ_1AU_K * (1.0 - bond_albedo) ** 0.25 / math.sqrt(r_au)
    return (t_eq**4 + max(0.0, t_int_k) ** 4) ** 0.25


@dataclass(frozen=True)
class Planet:
    diameter_km: float
    geometric_albedo: float
    t_int_k: float = 0.0


@dataclass(frozen=True)
class BandMag:
    detector: int
    wl_eff_um: float
    reflected_ab: float
    thermal_ab: float
    total_ab: float


def flux_jy(planet: Planet, r_au: float, wl_um: float) -> tuple[float, float]:
    """(reflected, thermal) F_nu in Jy at one wavelength."""
    delta = observer_distance_au(r_au)
    radius_au = planet.diameter_km * 1e3 / 2 / AU_M
    refl = solar_flux_jy(wl_um) * planet.geometric_albedo * radius_au**2 / (r_au**2 * delta**2)
    t = temperature_k(r_au, planet.geometric_albedo, planet.t_int_k)
    omega = math.pi * (radius_au / delta) ** 2  # pi * B_nu * (R/Delta)^2
    therm = planck_nu(wl_um, t) * omega * 1e26
    return refl, therm


def band_mags(planet: Planet, r_au: float) -> list[BandMag]:
    """AB magnitude in each SPHEREx detector: F_nu averaged over the detector's channels."""
    out = []
    for b in spherex_bands():
        fl = [flux_jy(planet, r_au, w) for w in b.channels_um]
        refl = sum(f[0] for f in fl) / len(fl)
        therm = sum(f[1] for f in fl) / len(fl)
        out.append(
            BandMag(
                detector=b.detector,
                wl_eff_um=b.wl_eff_um,
                reflected_ab=jy_to_ab(refl),
                thermal_ab=jy_to_ab(therm),
                total_ab=jy_to_ab(refl + therm),
            )
        )
    return out
