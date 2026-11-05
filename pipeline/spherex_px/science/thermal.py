"""Asteroid size and albedo from SPHEREx's 3-5 um thermal emission (NEATM).

At 3-5 um an asteroid near the Sun shines in two ways: reflected sunlight, and heat. NEOWISE
measured sizes for more than 150,000 asteroids from that heat until it was switched off in
August 2024. SPHEREx sees the same glow in its longest channels (3.8-5.0 um), so its spectra can
size asteroids too. This module does it in four steps:

1. **Reflected light** (0.7-2.6 um): divide each flux by sunlight in the same channel
   (``solar_spectrum``) and by the geometry factor Phi(alpha) / (r^2 delta^2), fit a straight
   line to that reflectance against wavelength, and extrapolate it to 3-5 um, times sunlight.
   Channels between 2.6 and 3.3 um are left out (the 3 um hydrated-mineral band). A 15%
   systematic error is put on the extrapolation (reflectance past 2.5 um is not a straight line
   for every asteroid).
2. **Thermal excess** = measured flux minus the extrapolated reflected light, in channels at
   3.3 um and longer. An object is sized only when the excess is at least 3 sigma in at least
   two separate SPHEREx channels; otherwise only an upper limit on its size is given.
3. **NEATM** (Near-Earth Asteroid Thermal Model; Harris 1998, Icarus 131, 291): a sphere whose
   day side is in instantaneous equilibrium with sunlight, temperature T_ss (cos theta)^(1/4)
   from the sub-solar point, nothing on the night side, and a beaming parameter eta that
   absorbs roughness and thermal inertia. The flux seen at phase angle alpha is integrated
   over the visible, illuminated surface. Size and albedo are tied together by the absolute
   magnitude H: D = 1329 km / sqrt(p_V) * 10^(-H/5) (Fowler & Chillemi 1992; Harris & Lagerros
   2002), and the Bond albedo A = q p_V with q = 0.290 + 0.684 G (Bowell et al. 1989).
   eta is fixed (with a spread) because 3.8-5.0 um alone cannot pin it: 1.0 +- 0.2 for main-belt
   and more distant objects (Masiero et al. 2011, ApJ 741, 68 find a mean of 1.0 for main-belt
   asteroids) and 1.4 +- 0.5 for near-Earth objects (Mainzer et al. 2011, ApJ 743, 156).
   Emissivity 0.9.
4. **Uncertainties** by Monte Carlo: every draw perturbs each flux by its error, picks one orbit
   clone (or JPL's geometry), draws H, G, eta and the extrapolation error, and refits
   everything. The reported size is the median of the draws, with the 16th-84th percentiles.

H comes from JPL's Small-Body Database for objects JPL identified. For the rest it is estimated
from SPHEREx's own reflected light at the shortest wavelengths, converted to the V band with a
typical asteroid colour (an extra 0.15-0.3 mag of uncertainty); see ``h_from_reflectance``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

from .geometry import Geometry
from .solar_spectrum import solar_fnu_ujy

H_PLANCK = 6.62607015e-34
K_B = 1.380649e-23
C_M_S = 299_792_458.0
SIGMA_SB = 5.670374419e-8
AU_M = 149_597_870_700.0
AU_KM = AU_M / 1000
#: Total solar irradiance at 1 AU (Kopp & Lean 2011, GRL 38, L01706), W m^-2.
SOLAR_CONSTANT = 1361.0
EMISSIVITY = 0.9
#: D (km) = D_CONST_KM / sqrt(p_V) * 10^(-H/5).
D_CONST_KM = 1329.0
UJY = 1e-32

#: Reflectance is fitted between these wavelengths (um).
REFLECT_MIN_UM, REFLECT_MAX_UM = 0.70, 2.60
#: Thermal excess is measured at and beyond this wavelength (um), past the 3 um band.
THERMAL_MIN_UM = 3.30
#: Systematic error of the reflectance extrapolated to 3-5 um (fraction of the reflected light).
EXTRAPOLATION_SYS = 0.15
#: Error added in quadrature to every flux (calibration, rotation between visits).
FLUX_FLOOR = 0.07
#: Sizing rule: at least MIN_BANDS separate channels with excess >= MIN_SIGMA.
MIN_SIGMA = 3.0
MIN_BANDS = 2
#: Default slope parameter (Bowell et al. 1989) and its spread when JPL has none.
G_DEFAULT, G_SIGMA = 0.15, 0.10
#: Spread of a JPL catalogue H (Pravec et al. 2012, Icarus 221, 365: catalogue H values are off
#: by 0.1-0.4 mag).
H_SIGMA_JPL = 0.25
ETA_PRIORS = {"neo": (1.4, 0.5), "default": (1.0, 0.2)}
ETA_RANGE = (0.5, 3.2)


# ----------------------------------------------------------------------------- basics


def phase_hg(alpha_deg, g):
    """IAU H-G phase function Phi(alpha) (Bowell et al. 1989)."""
    t = np.tan(np.radians(np.asarray(alpha_deg, float)) / 2)
    p1 = np.exp(-3.33 * t**0.63)
    p2 = np.exp(-1.87 * t**1.22)
    return (1 - g) * p1 + g * p2


def phase_integral(g):
    """Phase integral q = 0.290 + 0.684 G (Bowell et al. 1989)."""
    return 0.290 + 0.684 * np.asarray(g, float)


def albedo_from_d(d_km, h):
    return (D_CONST_KM * 10 ** (-np.asarray(h, float) / 5) / np.asarray(d_km, float)) ** 2


def d_from_albedo(pv, h):
    return D_CONST_KM / np.sqrt(np.asarray(pv, float)) * 10 ** (-np.asarray(h, float) / 5)


def subsolar_temperature(r_au, bond_albedo, eta, emissivity=EMISSIVITY):
    """NEATM sub-solar temperature (K)."""
    a = np.clip(bond_albedo, 0.0, 0.95)
    return (
        (1 - a) * SOLAR_CONSTANT / (eta * emissivity * SIGMA_SB * np.asarray(r_au) ** 2)
    ) ** 0.25


def hc_over_k_um() -> float:
    return H_PLANCK * C_M_S / K_B * 1e6  # 14387.77 um K


# ----------------------------------------------------------------------------- NEATM flux


def _neatm_integral_exact(
    x0: float, alpha_rad: float, n_theta: int = 96, n_phi: int = 128
) -> float:
    """J(x0, alpha) = integral of cos^2(theta) cos(phi - alpha) / (exp(x0 / u^(1/4)) - 1),
    u = cos(theta) cos(phi), over the illuminated surface visible from the observer
    (theta in [-pi/2, pi/2], phi in [alpha - pi/2, pi/2]). x0 = h nu / (k T_ss)."""
    tn, tw = np.polynomial.legendre.leggauss(n_theta)
    pn, pw = np.polynomial.legendre.leggauss(n_phi)
    th = tn * math.pi / 4 + math.pi / 4  # [0, pi/2]; the integrand is even in theta
    lo, hi = alpha_rad - math.pi / 2, math.pi / 2
    ph = (pn + 1) / 2 * (hi - lo) + lo
    u = np.cos(th)[:, None] * np.cos(ph)[None, :]
    with np.errstate(over="ignore"):
        planck = 1 / np.expm1(x0 / np.maximum(u, 1e-12) ** 0.25)
    f = np.cos(th)[:, None] ** 2 * np.cos(ph - alpha_rad)[None, :] * planck
    return float(2 * (math.pi / 4) * ((hi - lo) / 2) * (tw @ f @ pw))


_LOGX = np.linspace(math.log(0.3), math.log(200.0), 360)
_ALPHA = np.linspace(0.0, 160.0, 161)


@lru_cache(maxsize=1)
def _table() -> np.ndarray:
    """ln J on the (ln x0, alpha) grid (computed once, ~1 s)."""
    tn, tw = np.polynomial.legendre.leggauss(64)
    pn, pw = np.polynomial.legendre.leggauss(96)
    th = tn * math.pi / 4 + math.pi / 4
    x0 = np.exp(_LOGX)
    out = np.empty((len(_LOGX), len(_ALPHA)))
    for k, a in enumerate(np.radians(_ALPHA)):
        lo, hi = a - math.pi / 2, math.pi / 2
        ph = (pn + 1) / 2 * (hi - lo) + lo
        u = np.cos(th)[:, None] * np.cos(ph)[None, :]
        geom = np.cos(th)[:, None] ** 2 * np.cos(ph - a)[None, :]
        q = np.maximum(u, 1e-12) ** -0.25
        with np.errstate(over="ignore"):
            planck = 1 / np.expm1(x0[:, None, None] * q[None])
        f = np.einsum("i,xij,j->x", tw, geom[None] * planck, pw)
        out[:, k] = np.log(np.maximum(2 * (math.pi / 4) * ((hi - lo) / 2) * f, 1e-300))
    return out


def neatm_integral(x0, alpha_deg) -> np.ndarray:
    """J(x0, alpha) by bilinear interpolation of ln J in (ln x0, alpha)."""
    tab = _table()
    lx = np.clip(np.log(np.asarray(x0, float)), _LOGX[0], _LOGX[-1])
    al = np.clip(np.asarray(alpha_deg, float), _ALPHA[0], _ALPHA[-1])
    lx, al = np.broadcast_arrays(lx, al)
    fx = (lx - _LOGX[0]) / (_LOGX[1] - _LOGX[0])
    fa = (al - _ALPHA[0]) / (_ALPHA[1] - _ALPHA[0])
    i = np.clip(fx.astype(int), 0, len(_LOGX) - 2)
    j = np.clip(fa.astype(int), 0, len(_ALPHA) - 2)
    tx, ta = fx - i, fa - j
    v = (
        tab[i, j] * (1 - tx) * (1 - ta)
        + tab[i + 1, j] * tx * (1 - ta)
        + tab[i, j + 1] * (1 - tx) * ta
        + tab[i + 1, j + 1] * tx * ta
    )
    return np.exp(v)


def neatm_fnu_ujy(wavelength_um, d_km, t_ss, delta_au, alpha_deg, emissivity=EMISSIVITY):
    """NEATM thermal flux density (uJy) of a sphere of diameter ``d_km``.

    F_nu = emissivity (D/2)^2 / delta^2 * (2 h nu^3 / c^2) * J(h nu / k T_ss, alpha).
    """
    lam_m = np.asarray(wavelength_um, float) * 1e-6
    nu = C_M_S / lam_m
    x0 = hc_over_k_um() / (np.asarray(wavelength_um, float) * np.asarray(t_ss, float))
    rad = np.asarray(d_km, float) * 500.0  # radius in m
    dist = np.asarray(delta_au, float) * AU_M
    bnu_scale = 2 * H_PLANCK * nu**3 / C_M_S**2
    return emissivity * (rad / dist) ** 2 * bnu_scale * neatm_integral(x0, alpha_deg) / UJY


# ----------------------------------------------------------------------------- data


@dataclass(frozen=True)
class Point:
    wavelength_um: float
    bandwidth_um: float
    flux_ujy: float
    flux_err_ujy: float
    band_index: int | None
    epoch: int  # column of the geometry arrays


@dataclass(frozen=True)
class HPrior:
    h: float | None  # None: estimate from SPHEREx's own reflected light
    sigma: float = H_SIGMA_JPL
    g: float = G_DEFAULT
    g_sigma: float = G_SIGMA
    source: str = "spherex_reflectance"


@dataclass
class ExcessPoint:
    band_index: int | None
    wavelength_um: float
    flux_ujy: float
    reflected_ujy: float
    excess_ujy: float
    excess_err_ujy: float
    sigma: float


@dataclass
class ThermalResult:
    status: str  # sized | upper_limit | not_sizable
    reason: str
    n_thermal_points: int = 0
    n_significant_bands: int = 0
    diameter_km: float | None = None
    diameter_lo_km: float | None = None
    diameter_hi_km: float | None = None
    diameter_upper_limit_km: float | None = None
    albedo: float | None = None
    albedo_lo: float | None = None
    albedo_hi: float | None = None
    h: float | None = None
    h_sigma: float | None = None
    h_source: str | None = None
    g: float | None = None
    eta: float | None = None
    eta_sigma: float | None = None
    eta_mode: str = "fixed"
    t_subsolar_k: float | None = None
    r_au: float | None = None
    delta_au: float | None = None
    alpha_deg: float | None = None
    model_epoch: int | None = None
    excess: list[ExcessPoint] = field(default_factory=list)
    model_wavelength_um: list[float] = field(default_factory=list)
    model_reflected_ujy: list[float] = field(default_factory=list)
    model_thermal_ujy: list[float] = field(default_factory=list)
    n_mc: int = 0


# ----------------------------------------------------------------------------- fitting


def _wls_line(x, y, w):
    """Row-wise weighted least squares y = a + b x. x: (n,), y, w: (K, n). Returns a, b, cov."""
    s0 = w.sum(1)
    s1 = (w * x).sum(1)
    s2 = (w * x * x).sum(1)
    t0 = (w * y).sum(1)
    t1 = (w * x * y).sum(1)
    det = s0 * s2 - s1 * s1
    a = (s2 * t0 - s1 * t1) / det
    b = (s0 * t1 - s1 * t0) / det
    cov = np.stack([np.stack([s2, -s1], -1), np.stack([-s1, s0], -1)], -2) / det[:, None, None]
    return a, b, cov


def h_from_reflectance(rho_v):
    """Absolute magnitude from geometric albedo x (radius / 1 AU)^2 in V (rho_v).

    By the definition of H, p_V (D / 2 AU)^2 = (D_CONST_KM 10^(-H/5) / 2 AU)^2."""
    return -5 * np.log10(2 * AU_KM * np.sqrt(np.maximum(rho_v, 1e-300)) / D_CONST_KM)


def colour_factor(lam_ref_um: float) -> tuple[float, float]:
    """Typical reflectance at lam_ref relative to V (0.55 um), mean and spread, spanning C- to
    S-type asteroids (Bus-DeMeo taxonomy, DeMeo et al. 2009, Icarus 202, 160)."""
    if lam_ref_um <= 1.0:
        return 1.15, 0.12
    if lam_ref_um <= 1.6:
        return 1.25, 0.18
    return 1.30, 0.25


def eta_prior(distance_class: str | None) -> tuple[float, float]:
    return ETA_PRIORS["neo"] if distance_class == "neo" else ETA_PRIORS["default"]


def _solve_d(excess, w, lam, r, delta, alpha, h, q, eta, d0=None, iters=8):
    """Diameter whose NEATM flux best matches the excess (weighted least squares in D^2),
    iterating the weak dependence of temperature on albedo. Arrays are (K, n); h, q, eta (K,)."""
    k = excess.shape[0]
    d = np.full(k, 5.0) if d0 is None else d0.copy()
    for _ in range(iters):
        pv = albedo_from_d(d, h)
        t = subsolar_temperature(r, (q * pv)[:, None], eta[:, None])
        tmpl = neatm_fnu_ujy(lam[None, :], 1.0, t, delta, alpha)
        num = (w * excess * tmpl).sum(1)
        den = (w * tmpl * tmpl).sum(1)
        s = np.maximum(num / den, 1e-8)
        d = np.sqrt(s)
    return d, np.sqrt(1 / den), tmpl


def fit(
    points: list[Point],
    geometry: Geometry,
    hprior: HPrior,
    eta: tuple[float, float] = ETA_PRIORS["default"],
    n_mc: int = 400,
    seed: int = 0,
    fit_eta: bool = False,
) -> ThermalResult:
    """Separate reflected light from heat and fit NEATM. See the module docstring."""
    pts = sorted(points, key=lambda p: p.wavelength_um)
    short = [
        p for p in pts if REFLECT_MIN_UM <= p.wavelength_um < REFLECT_MAX_UM and p.flux_err_ujy > 0
    ]
    therm = [p for p in pts if p.wavelength_um >= THERMAL_MIN_UM and p.flux_err_ujy > 0]
    res = ThermalResult(status="not_sizable", reason="", n_thermal_points=len(therm), n_mc=0)
    if len(therm) < MIN_BANDS:
        res.reason = (
            f"SPHEREx measured it in {len(therm)} channel(s) at 3.3-5 um; at least {MIN_BANDS} "
            "are needed to see heat."
        )
        return res
    span = short[-1].wavelength_um - short[0].wavelength_um if short else 0.0
    if len(short) < 3 or span < 0.25:
        res.reason = (
            "Too few measurements at 0.7-2.6 um to model its reflected sunlight, so heat cannot "
            "be told apart from reflected light."
        )
        return res

    def arr(ps, attr):
        return np.array([getattr(p, attr) for p in ps], float)

    ls, lt = arr(short, "wavelength_um"), arr(therm, "wavelength_um")
    fs, ft = arr(short, "flux_ujy"), arr(therm, "flux_ujy")
    es = np.hypot(arr(short, "flux_err_ujy"), FLUX_FLOOR * np.abs(fs))
    et = np.hypot(arr(therm, "flux_err_ujy"), FLUX_FLOOR * np.abs(ft))
    sun_s = solar_fnu_ujy(ls, arr(short, "bandwidth_um"))
    sun_t = solar_fnu_ujy(lt, arr(therm, "bandwidth_um"))
    ep_s = np.array([p.epoch for p in short])
    ep_t = np.array([p.epoch for p in therm])
    lam0 = float(np.round(ls.mean(), 3))
    lam_ref = float(max(ls[0], 0.75))
    col_mu, col_sig = colour_factor(lam_ref)

    rng = np.random.default_rng(seed)
    # Draw 0 is the nominal fit (no noise); the rest are Monte Carlo draws.
    k = n_mc + 1
    nominal = geometry.median()
    gi = rng.integers(0, geometry.n_samples, size=k)
    geo = geometry.take(gi)
    geo = Geometry(
        np.vstack([nominal.r_au, geo.r_au[1:]]),
        np.vstack([nominal.delta_au, geo.delta_au[1:]]),
        np.vstack([nominal.alpha_deg, geo.alpha_deg[1:]]),
        geometry.source,
    )
    z = rng.standard_normal
    noise = np.vstack([np.zeros(1), np.ones((k - 1, 1))])
    fs_k = fs[None, :] + noise * z((k, len(fs))) * es[None, :]
    ft_k = ft[None, :] + noise * z((k, len(ft))) * et[None, :]
    g_k = np.clip(hprior.g + noise[:, 0] * z(k) * hprior.g_sigma, -0.2, 0.8)
    extrap_k = 1 + noise[:, 0] * z(k) * EXTRAPOLATION_SYS
    col_k = np.clip(col_mu + noise[:, 0] * z(k) * col_sig, 0.7, 2.0)
    h_draw = None if hprior.h is None else hprior.h + noise[:, 0] * z(k) * hprior.sigma
    if fit_eta:
        eta_grid = np.linspace(ETA_RANGE[0], ETA_RANGE[1], 28)
    eta_k = np.clip(eta[0] + noise[:, 0] * z(k) * eta[1], *ETA_RANGE)

    r_s, d_s, a_s = geo.r_au[:, ep_s], geo.delta_au[:, ep_s], geo.alpha_deg[:, ep_s]
    r_t, d_t, a_t = geo.r_au[:, ep_t], geo.delta_au[:, ep_t], geo.alpha_deg[:, ep_t]
    gf_s = phase_hg(a_s, g_k[:, None]) / (r_s**2 * d_s**2)
    gf_t = phase_hg(a_t, g_k[:, None]) / (r_t**2 * d_t**2)
    q_k = phase_integral(g_k)

    therm_short = np.zeros_like(fs_k)
    d_k = None
    for _ in range(3):
        rho = (fs_k - therm_short) / (sun_s[None, :] * gf_s)
        w_rho = (sun_s[None, :] * gf_s / es[None, :]) ** 2
        a, b, cov = _wls_line(ls - lam0, rho, w_rho)
        rho_t = a[:, None] + b[:, None] * (lt - lam0)[None, :]
        refl_t = np.maximum(rho_t, 0) * sun_t[None, :] * gf_t * extrap_k[:, None]
        rho_ref = a + b * (lam_ref - lam0)
        h_k = h_draw if h_draw is not None else h_from_reflectance(rho_ref / col_k)
        # Error of the reflected light at each thermal channel (nominal draw): line fit + extrapolation.
        dl = lt - lam0
        var_rho = cov[0, 0, 0] + 2 * dl * cov[0, 0, 1] + dl**2 * cov[0, 1, 1]
        sig_refl = np.hypot(
            np.sqrt(np.maximum(var_rho, 0)) * sun_t * gf_t[0], EXTRAPOLATION_SYS * refl_t[0]
        )
        sig_x = np.hypot(et, sig_refl)
        w = 1 / sig_x**2
        excess = ft_k - refl_t
        if fit_eta:
            best = np.full(k, np.inf)
            d_best = np.zeros(k)
            eta_best = np.zeros(k)
            for e in eta_grid:
                ee = np.full(k, e)
                d_e, _, tmpl = _solve_d(excess, w[None, :], lt, r_t, d_t, a_t, h_k, q_k, ee, d0=d_k)
                chi = (w * (excess - d_e[:, None] ** 2 * tmpl) ** 2).sum(1)
                better = chi < best
                best = np.where(better, chi, best)
                d_best = np.where(better, d_e, d_best)
                eta_best = np.where(better, e, eta_best)
            d_k, eta_k = d_best, eta_best
            _, sig_s, tmpl = _solve_d(
                excess, w[None, :], lt, r_t, d_t, a_t, h_k, q_k, eta_k, d0=d_k, iters=1
            )
        else:
            d_k, sig_s, tmpl = _solve_d(
                excess, w[None, :], lt, r_t, d_t, a_t, h_k, q_k, eta_k, d0=d_k
            )
        # Heat leaking into the short channels (matters only for objects close to the Sun).
        pv = albedo_from_d(d_k, h_k)
        t_s = subsolar_temperature(r_s, (q_k * pv)[:, None], eta_k[:, None])
        therm_short = neatm_fnu_ujy(ls[None, :], d_k[:, None], t_s, d_s, a_s)

    # Significance on the nominal draw.
    x0 = excess[0]
    sig0 = x0 / sig_x
    bands = {
        (p.band_index if p.band_index is not None else round(p.wavelength_um, 3))
        for p, s in zip(therm, sig0, strict=True)
        if s >= MIN_SIGMA
    }
    res.n_significant_bands = len(bands)
    res.excess = [
        ExcessPoint(
            band_index=p.band_index,
            wavelength_um=p.wavelength_um,
            flux_ujy=p.flux_ujy,
            reflected_ujy=float(refl_t[0, i]),
            excess_ujy=float(x0[i]),
            excess_err_ujy=float(sig_x[i]),
            sigma=float(sig0[i]),
        )
        for i, p in enumerate(therm)
    ]
    res.n_mc = n_mc
    hk = np.asarray(h_k)
    res.h = float(np.median(hk[1:])) if n_mc else float(hk[0])
    res.h_sigma = float(np.std(hk[1:])) if n_mc else None
    res.h_source = hprior.source if hprior.h is not None else "spherex_reflectance"
    res.g = hprior.g
    res.eta_mode = "fitted" if fit_eta else "fixed"
    res.eta = float(np.median(eta_k[1:])) if (fit_eta and n_mc) else eta[0]
    res.eta_sigma = float(np.std(eta_k[1:])) if (fit_eta and n_mc) else eta[1]
    mid = int(np.argmin(np.abs(lt - np.median(lt))))
    res.model_epoch = int(ep_t[mid])
    res.r_au = float(nominal.r_au[0, ep_t[mid]])
    res.delta_au = float(nominal.delta_au[0, ep_t[mid]])
    res.alpha_deg = float(nominal.alpha_deg[0, ep_t[mid]])

    mc = slice(1, None) if n_mc else slice(0, 1)
    if res.n_significant_bands >= MIN_BANDS:
        res.status = "sized"
        dd = d_k[mc]
        pv = albedo_from_d(d_k, h_k)[mc]
        res.diameter_km, res.diameter_lo_km, res.diameter_hi_km = (
            float(x) for x in np.percentile(dd, [50, 16, 84])
        )
        res.albedo, res.albedo_lo, res.albedo_hi = (
            float(x) for x in np.percentile(pv, [50, 16, 84])
        )
        d_model = res.diameter_km
        res.reason = (
            f"Heat detected at {res.n_significant_bands} SPHEREx channels (at least "
            f"{MIN_SIGMA:.0f} sigma above reflected sunlight)."
        )
    else:
        res.status = "upper_limit"
        # 3-sigma upper limit on the NEATM flux scale (D^2), per draw: the diameter whose
        # best-fit scale plus 3 sigma equals D^2, iterated because temperature depends on D
        # through the albedo. Reported: the 84th percentile over the draws.
        d_ul = np.full(k, 10.0)
        for _ in range(30):
            pv = albedo_from_d(d_ul, h_k)
            t = subsolar_temperature(r_t, (q_k * pv)[:, None], eta_k[:, None])
            tmpl = neatm_fnu_ujy(lt[None, :], 1.0, t, d_t, a_t)
            num = (w[None, :] * excess * tmpl).sum(1)
            den = (w[None, :] * tmpl * tmpl).sum(1)
            s_ul = np.maximum(num / den, 0) + MIN_SIGMA / np.sqrt(den)
            d_ul = np.sqrt(d_ul * np.sqrt(s_ul))  # damped fixed point
        res.diameter_upper_limit_km = float(np.percentile(d_ul[mc], 84))
        d_model = res.diameter_upper_limit_km
        res.reason = (
            f"No heat at {MIN_SIGMA:.0f} sigma in {MIN_BANDS} or more SPHEREx channels: too cold "
            "or too faint to size."
        )

    # Model curves for the plot, at the nominal geometry of the middle thermal channel.
    grid = np.round(np.linspace(0.75, 5.0, 86), 4)
    j = res.model_epoch
    gfac = float(
        phase_hg(nominal.alpha_deg[0, j], hprior.g)
        / (nominal.r_au[0, j] ** 2 * nominal.delta_au[0, j] ** 2)
    )
    sun_g = solar_fnu_ujy(grid, grid / 41.0)
    refl = np.maximum(a[0] + b[0] * (grid - lam0), 0) * sun_g * gfac
    h0 = float(hk[0])
    pv0 = float(albedo_from_d(d_model, h0))
    t0 = float(subsolar_temperature(nominal.r_au[0, j], phase_integral(hprior.g) * pv0, res.eta))
    res.t_subsolar_k = t0
    th = neatm_fnu_ujy(grid, d_model, t0, nominal.delta_au[0, j], nominal.alpha_deg[0, j])
    res.model_wavelength_um = [float(x) for x in grid]
    res.model_reflected_ujy = [float(x) for x in refl]
    res.model_thermal_ujy = [float(x) for x in th]
    return res
