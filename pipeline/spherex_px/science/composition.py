"""What is it made of? Relative reflectance and taxonomy from SPHEREx's linear-variable filters.

SPHEREx sees each exposure through a different part of its linear-variable filters, so a moving
asteroid is measured at a different wavelength in each sighting and its track builds up a
coarse 0.75-5 um spectrum. This module turns those fluxes into an *indicative* composition:

1. Geometry. Between sightings the object's distances from the Sun (r) and from SPHEREx (Delta)
   and its phase angle (alpha) change. Reflected flux scales as Phi(alpha) / (r^2 Delta^2), so
   every point is scaled to the geometry at the track's median time. r, Delta and alpha come
   from each of the object's orbit clones (``science/orbit.py``) and SPHEREx's real position;
   the clones' spread in the correction factor becomes an extra error. Phi is the IAU H-G phase
   function (Bowell et al. 1989) with G = 0.15. Without an orbit, only the points from the
   single densest 12-hour window are kept, where the geometry barely changes.
2. Solar division. SPHEREx fluxes are F_nu (uJy); the Sun's spectrum is the ASTM E490-00a
   table (F_lambda, W m^-2 um^-1), averaged over each sighting's band and converted to F_nu
   (F_nu ~ F_lambda lambda^2). Their ratio is the relative reflectance, normalised to 1 over
   1.0-1.2 um.
3. Taxonomy (below 2.45 um, where the Bus-DeMeo templates end). A spectral slope is fitted, and
   the reflectance is compared with each Bus-DeMeo class mean (DeMeo et al. 2009) with a free
   scale factor. chi^2 includes the measurement error, the geometry error, a systematic floor
   for the object's rotation (sightings are hours apart, so its brightness changes) and the
   class's own spread. Relative likelihoods exp(-chi^2/2), with equal prior weight per class,
   give each complex's probability; the stated confidence is then capped by how many bands and
   how much wavelength the spectrum covers, because a short, narrow spectrum matches almost any
   class.
4. Hydration (2.7-3.1 um). The band depth relative to a straight continuum fitted at 1.6-2.68 um
   (or, with fewer points, a flat one from 2.3-2.68 um), with its error, *only* from points
   whose thermal emission is negligible.
5. Thermal emission. A dark, warm asteroid glows at 3-5 um. The thermal-to-reflected ratio at
   each wavelength is estimated with the Standard Thermal Model (Lebofsky et al. 1986: eta =
   0.756, emissivity 0.9) for a dark surface (p_V = 0.05) at the clones' closest heliocentric
   distance, which errs towards more thermal emission. Points where it may exceed 10% are not
   treated as reflected light. NEOs and other near-Sun objects lose most of 3-5 um this way.

All of this is indicative only: a single short SPHEREx track gives a coarse, partial spectrum,
and the rotation of the object is not modelled.
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass, field
from functools import lru_cache
from importlib import resources

import numpy as np

from . import orbit as O

# ---------------------------------------------------------------------------- parameters

#: Normalisation window (um): reflectance is set to 1 here.
NORM_WINDOW_UM = (1.0, 1.2)
#: Taxonomy uses points between these wavelengths (SPHEREx starts at 0.75; templates end at 2.45).
TAXONOMY_RANGE_UM = (0.74, 2.46)
#: Hydration band and continuum windows (um).
HYDRATION_BAND_UM = (2.7, 3.1)
HYDRATION_CONTINUUM_UM = (1.6, 2.68)
#: With too few points for a sloped continuum, a flat one from at least two points here.
HYDRATION_FLAT_CONTINUUM_UM = (2.3, 2.68)
#: Fractional error added in quadrature to every point: the object's rotation (lightcurves are
#: typically 0.1-0.3 mag peak to peak, i.e. ~4-10% rms, and SPHEREx's sightings are spread over
#: hours) plus flux calibration between detectors.
SYSTEMATIC_FLOOR = 0.08
#: H-G slope parameter (Bowell et al. 1989), the IAU default.
G_SLOPE = 0.15
#: Points with more than this thermal fraction are not used as reflected light.
THERMAL_FRACTION_MAX = 0.10
#: Thermal model: Standard Thermal Model beaming and emissivity, dark surface.
STM_ETA = 0.756
EMISSIVITY = 0.9
PV_DARK = 0.05
SOLAR_CONSTANT_W_M2 = 1366.1  # ASTM E490-00a
#: Without an orbit, only points within this window (hours) are kept.
SAME_NIGHT_HOURS = 12.0
#: Least data for a taxonomy result.
MIN_TAXONOMY_POINTS = 5
MIN_TAXONOMY_SPAN_UM = 0.3

SIGMA_B = 5.670374419e-8
H_PLANCK = 6.62607015e-34
C_LIGHT = 2.99792458e8
K_BOLTZ = 1.380649e-23

#: Bus-DeMeo classes grouped into complexes (DeMeo et al. 2009, table 2).
COMPLEX_OF = {
    "S": "S", "Sa": "S", "Sq": "S", "Sr": "S", "Sv": "S",
    "B": "C", "C": "C", "Cb": "C", "Cg": "C", "Cgh": "C", "Ch": "C",
    "X": "X", "Xc": "X", "Xe": "X", "Xk": "X", "Xn": "X",
    "A": "A", "D": "D", "K": "K", "L": "L", "O": "O", "Q": "Q", "R": "R", "T": "T", "V": "V",
}  # fmt: skip

#: Plain-language names for each complex, used in "Its colors look most like ...".
COMPLEX_PLAIN = {
    "S": "stony S-type asteroids (rocky, with silicate minerals)",
    "C": "carbon-rich C-type asteroids (dark and primitive)",
    "X": "X-type asteroids (a mixed group: some metal-rich, some dark and primitive; colors alone cannot tell them apart)",
    "D": "very red D-type asteroids (dark, primitive and probably rich in organics)",
    "T": "reddish T-type asteroids (dark, between the C and D types)",
    "V": "V-type asteroids (basaltic, like pieces of the asteroid Vesta)",
    "A": "A-type asteroids (rich in the mineral olivine)",
    "K": "K-type asteroids (stony, between the S and C types)",
    "L": "L-type asteroids (stony, with an unusual red visible slope)",
    "O": "rare O-type asteroids (stony, with a deep 1-micron band)",
    "Q": "Q-type asteroids (fresh, unweathered stony surfaces)",
    "R": "rare R-type asteroids (stony, rich in pyroxene and olivine)",
}

#: Broad groups used for the looser agreement figure in validation.
BROAD_OF = {
    "S": "stony", "Q": "stony", "K": "stony", "L": "stony", "A": "stony", "R": "stony",
    "O": "stony", "V": "stony", "C": "dark", "D": "dark", "T": "dark", "X": "X",
}  # fmt: skip

REFERENCES = [
    (
        "Bus-DeMeo taxonomy",
        "DeMeo, Binzel, Slivan & Bus (2009), Icarus 202, 160-180: class mean spectra",
        "https://doi.org/10.1016/j.icarus.2009.02.005",
    ),
    (
        "Solar spectrum",
        "ASTM E490-00a (2014), Standard Solar Constant and Zero Air Mass Solar Spectral Irradiance Tables",
        "https://doi.org/10.1520/E0490",
    ),
    (
        "Phase function",
        "Bowell et al. (1989), Asteroids II, 524-556: the H-G magnitude system",
        "https://ui.adsabs.harvard.edu/abs/1989aste.conf..524B",
    ),
    (
        "Thermal model",
        "Lebofsky et al. (1986), Icarus 68, 239-251: the Standard Thermal Model",
        "https://doi.org/10.1016/0019-1035(86)90021-7",
    ),
    (
        "3-micron band",
        "Rivkin et al. (2015), Asteroids IV, 65-87: hydrated minerals on asteroids",
        "https://doi.org/10.2458/azu_uapress_9780816532131-ch004",
    ),
]

# ---------------------------------------------------------------------------- reference data


def _read_csv(name: str) -> list[dict[str, str]]:
    text = resources.files("spherex_px.config").joinpath(name).read_text()
    rows = [ln for ln in text.splitlines() if ln and not ln.startswith("#")]
    return list(csv.DictReader(rows))


@lru_cache(maxsize=1)
def solar_spectrum() -> tuple[np.ndarray, np.ndarray]:
    """ASTM E490-00a: wavelength (um), irradiance at 1 AU (W m^-2 um^-1)."""
    rows = _read_csv("solar_e490.csv")
    w = np.array([float(r["wavelength_um"]) for r in rows])
    f = np.array([float(r["irradiance_w_m2_um"]) for r in rows])
    return w, f


@dataclass(frozen=True)
class Template:
    name: str
    complex: str
    wavelength_um: np.ndarray
    reflectance: np.ndarray  # normalised to 1 over NORM_WINDOW_UM
    sigma: np.ndarray  # class spread, same normalisation
    single_member: bool


@lru_cache(maxsize=1)
def templates() -> tuple[Template, ...]:
    """Bus-DeMeo class means, renormalised to 1 over 1.0-1.2 um."""
    rows = _read_csv("busdemeo_means.csv")
    w = np.array([float(r["wave"]) for r in rows])
    names = [k[: -len("_Mean")] for k in rows[0] if k.endswith("_Mean")]
    win = (w >= NORM_WINDOW_UM[0] - 1e-9) & (w <= NORM_WINDOW_UM[1] + 1e-9)
    out = []
    raw_rel_sigmas = []
    for n in names:
        m = np.array([float(r[f"{n}_Mean"]) for r in rows])
        s = np.array([float(r[f"{n}_Sigma"]) for r in rows])
        if (s > 0).all():
            raw_rel_sigmas.append(s / m)
    # A class with one member has no spread: give it the median relative spread of the others.
    median_rel = np.median(np.array(raw_rel_sigmas), axis=0)
    for n in names:
        m = np.array([float(r[f"{n}_Mean"]) for r in rows])
        s = np.array([float(r[f"{n}_Sigma"]) for r in rows])
        single = bool((s <= 0).any())
        if single:
            s = median_rel * m
        k = m[win].mean()
        out.append(Template(n, COMPLEX_OF[n], w, m / k, s / k, single))
    return tuple(out)


# ---------------------------------------------------------------------------- physics


def hg_phase(alpha_deg: np.ndarray, g: float = G_SLOPE) -> np.ndarray:
    """IAU H-G phase function Phi(alpha) (Bowell et al. 1989), 1 at zero phase."""
    a = np.radians(np.asarray(alpha_deg, float))
    t = np.tan(a / 2)
    phi1 = np.exp(-3.33 * t**0.63)
    phi2 = np.exp(-1.87 * t**1.22)
    return (1 - g) * phi1 + g * phi2


def solar_in_band(lo_um: float, hi_um: float) -> float:
    """Mean solar F_lambda (W m^-2 um^-1 at 1 AU) over a band."""
    w, f = solar_spectrum()
    sel = (w >= lo_um) & (w <= hi_um)
    if sel.sum() >= 2:
        return float(np.trapezoid(f[sel], w[sel]) / (w[sel][-1] - w[sel][0]))
    return float(np.interp((lo_um + hi_um) / 2, w, f))


def planck_lambda(wavelength_um: float, temp_k: np.ndarray) -> np.ndarray:
    """B_lambda in W m^-2 sr^-1 um^-1."""
    lam = wavelength_um * 1e-6
    x = H_PLANCK * C_LIGHT / (lam * K_BOLTZ * np.maximum(temp_k, 1e-3))
    with np.errstate(over="ignore"):
        b = 2 * H_PLANCK * C_LIGHT**2 / lam**5 / np.expm1(np.minimum(x, 700))
    return b * 1e-6


def thermal_fraction(wavelength_um: float, r_au: float, pv: float = PV_DARK) -> float:
    """Fraction of the flux at this wavelength that is thermal emission (STM, zero phase).

    Reflected: p * F_sun(lambda) / r^2. Thermal: emissivity * integral of B_lambda(T) over the
    sunlit hemisphere, T = T_ss cos(theta)^(1/4). Both per unit (radius / Delta)^2, so the
    ratio depends only on the albedo, the wavelength and r."""
    q = 0.290 + 0.684 * G_SLOPE
    bond = q * pv
    t_ss = ((1 - bond) * SOLAR_CONSTANT_W_M2 / (r_au**2 * STM_ETA * EMISSIVITY * SIGMA_B)) ** 0.25
    theta = np.linspace(0, math.pi / 2, 400)
    temp = t_ss * np.cos(theta) ** 0.25
    integrand = planck_lambda(wavelength_um, temp) * np.cos(theta) * np.sin(theta)
    thermal = EMISSIVITY * 2 * math.pi * float(np.trapezoid(integrand, theta))
    w, f = solar_spectrum()
    reflected = pv * float(np.interp(wavelength_um, w, f)) / r_au**2
    return thermal / (thermal + reflected)


# ---------------------------------------------------------------------------- geometry


@dataclass
class Geometry:
    method: str  # "orbit_clones" | "same_night_only"
    factor: np.ndarray  # multiply flux by this to bring it to the reference geometry
    factor_frac_err: np.ndarray  # clones' fractional spread in the factor
    keep: np.ndarray  # bool: point usable at all (same-night rule without an orbit)
    ref_mjd: float
    r_au: float | None = None
    delta_au: float | None = None
    phase_deg: float | None = None
    r_min_au: float | None = None  # clones' 5th percentile at the reference time
    note: str = ""


def _geometry_from_clones(
    clones_el: np.ndarray, epoch_tdb: float, mjd_utc: np.ndarray, sc_km: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """r, Delta (AU) and phase (deg), shape (n_clones, n_times), with light time."""
    r0, v0 = O.state_from_elements(clones_el)
    obs = O.observer_helio(mjd_utc, sc_km)
    t = np.asarray(mjd_utc, float) + O.TDB_MINUS_UTC
    n, m = r0.shape[0], t.shape[0]
    rr, vv = np.repeat(r0, m, axis=0), np.repeat(v0, m, axis=0)
    tt, oo = np.tile(t, n), np.tile(obs, (n, 1))
    rho = np.ones(n * m)
    for _ in range(3):
        p, _ = O.propagate(rr, vv, tt - rho / O.C_AU_DAY - epoch_tdb)
        rho = np.linalg.norm(p - oo, axis=1)
    rn = np.linalg.norm(p, axis=1)
    to_sun, to_obs = -p, oo - p
    cosa = np.einsum("ij,ij->i", to_sun, to_obs) / (rn * rho)
    alpha = np.degrees(np.arccos(np.clip(cosa, -1, 1)))
    return rn.reshape(n, m), rho.reshape(n, m), alpha.reshape(n, m)


def geometry_correction(
    mjd_utc: np.ndarray,
    sc_km: np.ndarray,
    clones_el: np.ndarray | None,
    epoch_tdb: float | None,
) -> Geometry:
    mjd_utc = np.asarray(mjd_utc, float)
    ref = float(np.median(mjd_utc))
    if clones_el is not None and len(clones_el) and epoch_tdb is not None:
        t_all = np.append(mjd_utc, ref)
        sc_ref = np.median(sc_km, axis=0, keepdims=True)
        r, d, a = _geometry_from_clones(clones_el, epoch_tdb, t_all, np.vstack([sc_km, sc_ref]))
        ok = np.isfinite(r).all(axis=1) & np.isfinite(d).all(axis=1) & np.isfinite(a).all(axis=1)
        if ok.sum() >= 3:
            r, d, a = r[ok], d[ok], a[ok]
            # Reflected flux ~ Phi(alpha) / (r^2 Delta^2): scale each point to the reference.
            f = (r[:, :-1] ** 2 * d[:, :-1] ** 2) / (r[:, -1:] ** 2 * d[:, -1:] ** 2)
            f = f * hg_phase(a[:, -1:]) / hg_phase(a[:, :-1])
            med = np.median(f, axis=0)
            spread = np.std(f, axis=0) / med
            return Geometry(
                method="orbit_clones",
                factor=med,
                factor_frac_err=spread,
                keep=np.ones(len(mjd_utc), bool),
                ref_mjd=ref,
                r_au=float(np.median(r[:, -1])),
                delta_au=float(np.median(d[:, -1])),
                phase_deg=float(np.median(a[:, -1])),
                r_min_au=float(np.percentile(r[:, -1], 5)),
                note=(
                    f"Each point is scaled to the distances and phase angle at the track's median "
                    f"time, from {int(ok.sum())} orbit clones; the clones' spread is added to the errors."
                ),
            )
    # No orbit: keep the densest SAME_NIGHT_HOURS window, where geometry barely changes.
    best, best_n = ref, 0
    for t0 in mjd_utc:
        n = int(((mjd_utc >= t0) & (mjd_utc <= t0 + SAME_NIGHT_HOURS / 24)).sum())
        if n > best_n:
            best, best_n = t0, n
    keep = (mjd_utc >= best) & (mjd_utc <= best + SAME_NIGHT_HOURS / 24)
    return Geometry(
        method="same_night_only",
        factor=np.ones(len(mjd_utc)),
        factor_frac_err=np.zeros(len(mjd_utc)),
        keep=keep,
        ref_mjd=float(np.median(mjd_utc[keep])),
        note=(
            "This object has no orbit, so its changing distance and phase angle cannot be "
            f"corrected; only the {int(keep.sum())} sightings within one {SAME_NIGHT_HOURS:g}-hour "
            "window are used, where they barely change."
        ),
    )


# ---------------------------------------------------------------------------- reflectance


@dataclass
class Point:
    band_index: int | None
    wavelength_um: float
    wl_lo_um: float
    wl_hi_um: float
    epoch_id: str
    mjd: float
    flux_ujy: float
    flux_err_ujy: float
    sc_km: tuple[float, float, float] = (0.0, 0.0, 0.0)
    # filled in by reflectance():
    reflectance: float | None = None
    reflectance_err: float | None = None
    geometry_factor: float | None = None
    thermal_fraction: float | None = None
    use: str = "none"  # taxonomy | hydration | continuum | none
    excluded_reason: str | None = None


@dataclass
class Spectrum:
    points: list[Point]
    geometry: Geometry
    norm_method: str  # points_in_window | template_fit | none
    norm_n_points: int
    thermal_flagged: bool
    thermal_note: str
    norm_value: float = 1.0  # what raw reflectance was divided by


def reflectance(points: list[Point], geom: Geometry) -> Spectrum:
    """Geometry-corrected flux / solar flux for each point, before normalisation."""
    for i, p in enumerate(points):
        p.geometry_factor = float(geom.factor[i])
        if not geom.keep[i]:
            p.excluded_reason = "different night; no orbit to correct the geometry"
            continue
        if not (np.isfinite(p.flux_ujy) and p.flux_ujy > 0 and p.flux_err_ujy > 0):
            p.excluded_reason = "no positive flux measured"
            continue
        sun = solar_in_band(p.wl_lo_um, p.wl_hi_um) * p.wavelength_um**2  # ~ F_nu of the Sun
        val = p.flux_ujy * geom.factor[i] / sun
        frac = math.sqrt(
            (p.flux_err_ujy / p.flux_ujy) ** 2 + geom.factor_frac_err[i] ** 2 + SYSTEMATIC_FLOOR**2
        )
        p.reflectance, p.reflectance_err = val, val * frac
    # Thermal emission: judged at the closest heliocentric distance the clones allow.
    r_hot = geom.r_min_au
    flagged = False
    for p in points:
        if p.wavelength_um < 2.0:
            continue
        if r_hot is None:
            if p.wavelength_um > TAXONOMY_RANGE_UM[1] and p.excluded_reason is None:
                p.excluded_reason = "no orbit, so thermal emission cannot be ruled out"
            continue
        p.thermal_fraction = round(thermal_fraction(p.wavelength_um, r_hot), 4)
        if p.thermal_fraction > THERMAL_FRACTION_MAX:
            flagged = True
            if p.excluded_reason is None:
                p.excluded_reason = "thermal emission may be more than 10% of the light"
    if r_hot is None:
        note = "Without an orbit the distance from the Sun is unknown, so points above 2.5 µm are not used."
    elif flagged:
        lam = min(
            p.wavelength_um for p in points if (p.thermal_fraction or 0) > THERMAL_FRACTION_MAX
        )
        note = (
            f"At {r_hot:.2f} AU from the Sun (closest of its orbit clones) a dark surface would be "
            f"warm enough that above about {lam:.1f} µm part of the light is its own heat, not "
            "reflected sunlight. Those points are left out."
        )
    else:
        note = (
            f"At {r_hot:.2f} AU from the Sun (closest of its orbit clones) thermal emission stays "
            "below 10% at every measured wavelength, so all points are reflected sunlight."
        )
    return Spectrum(points, geom, "none", 0, flagged, note)


def _usable(p: Point) -> bool:
    return p.reflectance is not None and p.excluded_reason is None


def normalise(spec: Spectrum, scale_from_template: float | None = None) -> None:
    """Divide reflectances so they average 1 over NORM_WINDOW_UM."""
    lo, hi = NORM_WINDOW_UM
    win = [p for p in spec.points if _usable(p) and lo <= p.wavelength_um <= hi]
    if len(win) >= 2:
        w = np.array([1 / p.reflectance_err**2 for p in win])
        k = float(np.sum(w * np.array([p.reflectance for p in win])) / w.sum())
        spec.norm_method, spec.norm_n_points = "points_in_window", len(win)
    elif scale_from_template:
        k = scale_from_template
        spec.norm_method, spec.norm_n_points = "template_fit", len(win)
    else:
        good = [p for p in spec.points if _usable(p)]
        if not good:
            return
        k = float(np.median([p.reflectance for p in good]))
        spec.norm_method, spec.norm_n_points = "median", 0
    for p in spec.points:
        if p.reflectance is not None:
            p.reflectance /= k
            p.reflectance_err /= k
    spec.norm_value *= k


# ---------------------------------------------------------------------------- taxonomy


@dataclass
class Match:
    name: str
    complex: str
    chi2: float
    dof: int
    scale: float
    probability: float = 0.0


def fit_template(w: np.ndarray, r: np.ndarray, e: np.ndarray, t: Template) -> Match:
    """chi^2 of reflectance against scale * template, scale free; template spread included."""
    tm = np.interp(w, t.wavelength_um, t.reflectance)
    ts = np.interp(w, t.wavelength_um, t.sigma)
    s = float(np.sum(r * tm / e**2) / np.sum(tm**2 / e**2))
    for _ in range(3):
        var = e**2 + (s * ts) ** 2
        s = float(np.sum(r * tm / var) / np.sum(tm**2 / var))
    var = e**2 + (s * ts) ** 2
    chi2 = float(np.sum((r - s * tm) ** 2 / var))
    return Match(t.name, t.complex, chi2, len(w) - 1, s)


def confidence_level(p_complex: float, n: int, span_um: float, reduced_chi2: float) -> str:
    """Confidence from the probability, capped by coverage and fit quality."""
    if p_complex >= 0.8 and n >= 12 and span_um >= 1.0:
        level = 3
    elif p_complex >= 0.6 and n >= 8 and span_um >= 0.6:
        level = 2
    else:
        level = 1
    if reduced_chi2 > 3:
        level -= 1  # no class fits well: the data or the model are off
    return {3: "high", 2: "medium", 1: "low"}.get(level, "low")


@dataclass
class Taxonomy:
    matches: list[Match]  # sorted, best first
    complex_probability: dict[str, float]
    best_complex: str
    runner_up_complex: str | None
    confidence: str
    n_bands: int
    span_um: float
    slope_per_um: float
    slope_err_per_um: float
    slope_range_um: tuple[float, float]
    reduced_chi2: float


def classify(w: np.ndarray, r: np.ndarray, e: np.ndarray) -> Taxonomy | None:
    """Compare a normalised reflectance spectrum (TAXONOMY_RANGE_UM) with every class mean."""
    if len(w) < MIN_TAXONOMY_POINTS or (w.max() - w.min()) < MIN_TAXONOMY_SPAN_UM:
        return None
    matches = sorted((fit_template(w, r, e, t) for t in templates()), key=lambda m: m.chi2)
    chi = np.array([m.chi2 for m in matches])
    like = np.exp(-(chi - chi.min()) / 2)
    like /= like.sum()
    for m, p in zip(matches, like, strict=True):
        m.probability = float(p)
    cp: dict[str, float] = {}
    for m in matches:
        cp[m.complex] = cp.get(m.complex, 0.0) + m.probability
    order = sorted(cp, key=lambda k: -cp[k])
    # Spectral slope: weighted straight line through the normalised reflectance.
    a = np.vstack([np.ones_like(w), w]).T
    wt = 1 / e**2
    cov = np.linalg.inv(a.T @ (a * wt[:, None]))
    coef = cov @ (a.T @ (wt * r))
    best = matches[0]
    red = best.chi2 / max(best.dof, 1)
    span = float(w.max() - w.min())
    return Taxonomy(
        matches=matches,
        complex_probability=cp,
        best_complex=order[0],
        runner_up_complex=order[1] if len(order) > 1 else None,
        confidence=confidence_level(cp[order[0]], len(w), span, red),
        n_bands=len(w),
        span_um=span,
        slope_per_um=float(coef[1]),
        slope_err_per_um=float(math.sqrt(cov[1, 1])),
        slope_range_um=(float(w.min()), float(w.max())),
        reduced_chi2=red,
    )


# ---------------------------------------------------------------------------- hydration


@dataclass
class Hydration:
    status: str  # measured | not_covered | thermal | no_orbit
    band_depth: float | None = None
    band_depth_err: float | None = None
    snr: float | None = None
    n_band: int = 0
    n_continuum: int = 0
    band_center_um: float | None = None
    continuum: str | None = None  # linear | flat


def hydration(spec: Spectrum) -> Hydration:
    """Depth of the 2.7-3.1 um band relative to a straight (or flat) continuum below 2.68 um."""
    blo, bhi = HYDRATION_BAND_UM
    clo, chi_ = HYDRATION_CONTINUUM_UM
    in_band = [
        p for p in spec.points if p.reflectance is not None and blo <= p.wavelength_um <= bhi
    ]
    band = [p for p in in_band if p.excluded_reason is None]
    cont = [p for p in spec.points if _usable(p) and clo <= p.wavelength_um <= chi_]
    if not in_band:
        return Hydration("not_covered", n_continuum=len(cont))
    if not band:
        reasons = {p.excluded_reason for p in in_band}
        st = "no_orbit" if any(r and "no orbit" in r for r in reasons) else "thermal"
        return Hydration(st, n_band=0, n_continuum=len(cont))
    cw = np.array([p.wavelength_um for p in cont])
    if len(cont) >= 3 and (cw.max() - cw.min()) >= 0.3:
        method = "linear"
        cr = np.array([p.reflectance for p in cont])
        ce = np.array([p.reflectance_err for p in cont])
        a = np.vstack([np.ones_like(cw), cw]).T
        wt = 1 / ce**2
        cov = np.linalg.inv(a.T @ (a * wt[:, None]))
        coef = cov @ (a.T @ (wt * cr))
    else:
        flo, fhi = HYDRATION_FLAT_CONTINUUM_UM
        cont = [p for p in cont if flo <= p.wavelength_um <= fhi]
        if len(cont) < 2:
            return Hydration("not_covered", n_band=len(band), n_continuum=len(cont))
        method = "flat"
        cr = np.array([p.reflectance for p in cont])
        wt = 1 / np.array([p.reflectance_err for p in cont]) ** 2
        coef = np.array([float(np.sum(wt * cr) / wt.sum()), 0.0])
        cov = np.array([[1 / wt.sum(), 0.0], [0.0, 0.0]])
    bw = np.array([p.wavelength_um for p in band])
    br = np.array([p.reflectance for p in band])
    be = np.array([p.reflectance_err for p in band])
    bwt = 1 / be**2
    band_mean = float(np.sum(bwt * br) / bwt.sum())
    band_err = float(1 / math.sqrt(bwt.sum()))
    lam = float(np.sum(bwt * bw) / bwt.sum())
    x = np.array([1.0, lam])
    cont_val = float(x @ coef)
    cont_err = float(math.sqrt(x @ cov @ x))
    depth = 1 - band_mean / cont_val
    depth_err = (band_mean / cont_val) * math.hypot(band_err / band_mean, cont_err / cont_val)
    for p in band:
        p.use = "hydration"
    for p in cont:
        if p.use == "none":
            p.use = "continuum"
    return Hydration(
        "measured",
        band_depth=depth,
        band_depth_err=depth_err,
        snr=depth / depth_err if depth_err > 0 else None,
        n_band=len(band),
        n_continuum=len(cont),
        band_center_um=lam,
        continuum=method,
    )


# ---------------------------------------------------------------------------- pipeline


@dataclass
class Result:
    spectrum: Spectrum
    taxonomy: Taxonomy | None
    hydration: Hydration
    taxonomy_points: list[Point] = field(default_factory=list)


def analyse(points: list[Point], clones_el: np.ndarray | None, epoch_tdb: float | None) -> Result:
    """Everything above for one object's spectrum points."""
    points = sorted(points, key=lambda p: p.wavelength_um)
    mjd = np.array([p.mjd for p in points])
    sc = np.array([p.sc_km for p in points], float).reshape(-1, 3)
    geom = geometry_correction(mjd, sc, clones_el, epoch_tdb)
    spec = reflectance(points, geom)
    lo, hi = TAXONOMY_RANGE_UM
    tax_pts = [p for p in spec.points if _usable(p) and lo <= p.wavelength_um <= hi]
    tax = None
    if tax_pts:
        # Provisional normalisation (window or median) so the fit works on numbers near 1.
        normalise(spec)
        w = np.array([p.wavelength_um for p in tax_pts])
        r = np.array([p.reflectance for p in tax_pts])
        e = np.array([p.reflectance_err for p in tax_pts])
        tax = classify(w, r, e)
        if spec.norm_method != "points_in_window" and tax is not None:
            # No points at 1.0-1.2 um: normalise through the best template's scale instead.
            k = tax.matches[0].scale
            for p in spec.points:
                if p.reflectance is not None:
                    p.reflectance /= k
                    p.reflectance_err /= k
            spec.norm_value *= k
            spec.norm_method = "template_fit"
            for m in tax.matches:
                m.scale /= k
            r, e = r / k, e / k
            # Slope is linear in the normalisation; refit for the reported numbers.
            tax = classify(w, r, e)
        if tax is not None:
            for p in tax_pts:
                p.use = "taxonomy"
    else:
        normalise(spec)
    hyd = hydration(spec)
    return Result(spec, tax, hyd, tax_pts)
