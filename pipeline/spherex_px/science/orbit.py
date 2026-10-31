"""Preliminary orbits from SPHEREx astrometry: statistical ranging, least squares and clones.

A SPHEREx track spans one to a few days, too short for a unique orbit: many orbits fit the
positions equally well. So we map the whole family that does (statistical ranging, Virtanen
et al. 2001, Icarus 154, 412):

1. Take the first and last detections. For many trial topocentric distances of the object at
   those two times (and small trial offsets within their astrometric errors), the two
   heliocentric positions and the time between them fix one orbit (Lambert's problem).
2. Predict every detection from that orbit (two-body motion around the Sun, light time
   included, seen from SPHEREx's real position) and keep orbits whose chi-square is within
   DELTA_CHI2 of the best.
3. Refine the best one by least squares over all detections. If its covariance is well
   determined (the arc is long enough), the orbit is "refined" and clones are drawn from the
   covariance; otherwise it is "preliminary" and clones are drawn from the accepted ranging
   orbits, weighted by their likelihood.

Positions are heliocentric, in ICRS (equatorial J2000) axes, in AU and days; elements are
reported in the J2000 ecliptic frame. Observer positions are Earth's (astropy's built-in
ephemeris) plus SPHEREx's geocentric position from each exposure header. Perturbations by the
planets are ignored, which is far below the uncertainty of a days-long arc.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from astropy.coordinates import get_body_barycentric
from astropy.time import Time
from scipy.optimize import least_squares

#: Gaussian gravitational constant squared: GM_sun in AU^3 / day^2.
MU = 0.01720209895**2
#: Speed of light in AU / day.
C_AU_DAY = 173.144632674
AU_KM = 149_597_870.7
#: J2000 obliquity of the ecliptic.
EPS = math.radians(84381.448 / 3600)
ARCSEC = math.pi / 180 / 3600
#: TDB - UTC near 2025 (37 leap seconds + 32.184 s), in days.
TDB_MINUS_UTC = 69.184 / 86400

#: Orbits within this chi-square of the best are kept (3 sigma for 2 sampled parameters).
DELTA_CHI2 = 11.8
#: Error added in quadrature to each detection's quoted error (SPHEREx PSF-fit systematics).
ASTROMETRY_FLOOR_ARCSEC = 0.5
N_CLONES = 100


def _rot_eq_to_ecl() -> np.ndarray:
    c, s = math.cos(EPS), math.sin(EPS)
    return np.array([[1, 0, 0], [0, c, s], [0, -s, c]])


EQ_TO_ECL = _rot_eq_to_ecl()


def unit_vector(ra_deg, dec_deg) -> np.ndarray:
    ra, dec = np.radians(ra_deg), np.radians(dec_deg)
    return np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], axis=-1)


def radec(v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    ra = np.degrees(np.arctan2(v[..., 1], v[..., 0])) % 360
    dec = np.degrees(np.arcsin(np.clip(v[..., 2] / np.linalg.norm(v, axis=-1), -1, 1)))
    return ra, dec


def observer_helio(mjd_utc: np.ndarray, sc_geo_km: np.ndarray | None) -> np.ndarray:
    """Heliocentric observer positions (AU, ICRS axes): Earth + SPHEREx's geocentric offset."""
    t = Time(np.atleast_1d(mjd_utc), format="mjd", scale="utc")
    earth = get_body_barycentric("earth", t).xyz.to_value("AU").T
    sun = get_body_barycentric("sun", t).xyz.to_value("AU").T
    out = earth - sun
    if sc_geo_km is not None:
        out = out + np.asarray(sc_geo_km, float).reshape(-1, 3) / AU_KM
    return out


# ------------------------------------------------------------------------- two-body motion


def _stumpff(z: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    z = np.asarray(z, float)
    c = np.empty_like(z)
    s = np.empty_like(z)
    pos, neg, small = z > 1e-6, z < -1e-6, np.abs(z) <= 1e-6
    sp = np.sqrt(z[pos])
    c[pos] = (1 - np.cos(sp)) / z[pos]
    s[pos] = (sp - np.sin(sp)) / sp**3
    sn = np.sqrt(np.minimum(-z[neg], 700.0**2))  # beyond this the orbit is wildly hyperbolic
    with np.errstate(over="ignore", invalid="ignore"):
        c[neg] = (np.cosh(sn) - 1) / sn**2
        s[neg] = (np.sinh(sn) - sn) / sn**3
    zs = z[small]
    c[small] = 1 / 2 - zs / 24 + zs**2 / 720
    s[small] = 1 / 6 - zs / 120 + zs**2 / 5040
    return c, s


@np.errstate(over="ignore", invalid="ignore", divide="ignore")
def propagate(r0: np.ndarray, v0: np.ndarray, dt: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Two-body propagation by universal variables. r0, v0: (N, 3); dt: (N,) days."""
    r0 = np.atleast_2d(r0)
    v0 = np.atleast_2d(v0)
    dt = np.broadcast_to(np.asarray(dt, float), (r0.shape[0],)).copy()
    sq = math.sqrt(MU)
    rn = np.linalg.norm(r0, axis=1)
    vr = np.einsum("ij,ij->i", r0, v0) / rn
    alpha = 2 / rn - np.einsum("ij,ij->i", v0, v0) / MU
    chi = sq * np.abs(alpha) * dt
    chi = np.where(np.abs(alpha) < 1e-12, sq * dt / rn, chi)
    for _ in range(50):
        z = alpha * chi**2
        c, s = _stumpff(z)
        f = rn * vr / sq * chi**2 * c + (1 - alpha * rn) * chi**3 * s + rn * chi - sq * dt
        df = rn * vr / sq * chi * (1 - z * s) + (1 - alpha * rn) * chi**2 * c + rn
        step = f / df
        chi = chi - step
        if np.all(np.abs(step) < 1e-12):
            break
    z = alpha * chi**2
    c, s = _stumpff(z)
    f = 1 - chi**2 / rn * c
    g = dt - chi**3 / sq * s
    r = f[:, None] * r0 + g[:, None] * v0
    rr = np.linalg.norm(r, axis=1)
    fdot = sq / (rr * rn) * (alpha * chi**3 * s - chi)
    gdot = 1 - chi**2 / rr * c
    v = fdot[:, None] * r0 + gdot[:, None] * v0
    return r, v


@np.errstate(over="ignore", invalid="ignore", divide="ignore")
def lambert(r1: np.ndarray, r2: np.ndarray, dt: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Velocities at r1 for the short-way, single-revolution transfer r1 -> r2 in dt days.

    Universal-variable formulation (Curtis, Orbital Mechanics, algorithm 5.2), solved by
    bisection on z, then polished by shooting, vectorized over N transfers. Returns (v1, ok);
    ok means the orbit through (r1, v1) reaches r2 within 1e-10 of its distance."""
    r1n = np.linalg.norm(r1, axis=1)
    r2n = np.linalg.norm(r2, axis=1)
    cos_t = np.clip(np.einsum("ij,ij->i", r1, r2) / (r1n * r2n), -1, 1)
    theta = np.arccos(cos_t)  # short way: the transfer angle of a days-long arc is small
    a = np.sin(theta) * np.sqrt(r1n * r2n / np.maximum(1 - cos_t, 1e-300))
    sq = math.sqrt(MU)

    def y_of(z):
        c, s = _stumpff(z)
        return r1n + r2n + a * (z * s - 1) / np.sqrt(c), c, s

    def f_of(z):
        y, c, s = y_of(z)
        ok = y > 0
        yy = np.where(ok, y, 1.0)
        val = (yy / c) ** 1.5 * s + a * np.sqrt(yy) - sq * dt
        return np.where(ok, val, -np.inf)

    lo = np.full(r1.shape[0], -400.0)
    hi = np.full(r1.shape[0], 4 * math.pi**2 - 1e-9)
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        fm = f_of(mid)
        up = fm < 0
        lo = np.where(up, mid, lo)
        hi = np.where(up, hi, mid)
    z = 0.5 * (lo + hi)
    y, c, s = y_of(z)
    ok = (y > 0) & (theta > 1e-9)
    y = np.where(y > 0, y, 1.0)
    f = 1 - y / r1n
    g = a * np.sqrt(y / MU)
    v1 = (r2 - f[:, None] * r1) / np.where(np.abs(g) > 0, g, 1.0)[:, None]
    # Shooting correction: the formula above loses precision for small transfer angles, so
    # propagate, measure the miss at r2 and correct v1 (d r2 / d v1 ~ g ~ dt for short arcs).
    gg = np.where(np.abs(g) > 0, g, dt)[:, None]
    for _ in range(6):
        p, _ = propagate(r1, v1, dt)
        miss = r2 - p
        v1 = v1 + miss / gg
    p, _ = propagate(r1, v1, dt)
    ok = (
        ok
        & (np.linalg.norm(p - r2, axis=1) < 1e-10 * np.maximum(r2n, 1.0))
        & np.isfinite(v1).all(axis=1)
    )
    return v1, ok


# ------------------------------------------------------------------------- observations


@dataclass
class Observations:
    mjd_tdb: np.ndarray  # (M,)
    ra_deg: np.ndarray
    dec_deg: np.ndarray
    sigma_arcsec: np.ndarray  # per-coordinate 1-sigma, floor included
    obs: np.ndarray  # (M, 3) heliocentric observer positions, AU

    @classmethod
    def from_detections(cls, dets) -> Observations:
        """From contract Detection objects (mjd is UTC; spacecraft_geocentric_km may be None)."""
        dets = sorted(dets, key=lambda d: d.mjd)
        mjd = np.array([d.mjd for d in dets])
        sc = np.array(
            [d.spacecraft_geocentric_km if d.spacecraft_geocentric_km else [0, 0, 0] for d in dets],
            float,
        )
        err = np.array([d.pos_err_arcsec or 1.0 for d in dets], float)
        return cls(
            mjd_tdb=mjd + TDB_MINUS_UTC,
            ra_deg=np.array([d.ra_deg for d in dets]),
            dec_deg=np.array([d.dec_deg for d in dets]),
            sigma_arcsec=np.hypot(err, ASTROMETRY_FLOOR_ARCSEC),
            obs=observer_helio(mjd, sc),
        )


def predict_radec(r: np.ndarray, v: np.ndarray, t0: np.ndarray, t: np.ndarray, obs: np.ndarray):
    """Apparent RA/Dec (deg) at times t (M,) of N orbits with state (r, v) at t0 (N,).

    Light time included. Returns ra, dec, rho with shape (N, M)."""
    n, m = r.shape[0], t.shape[0]
    rr = np.repeat(r, m, axis=0)
    vv = np.repeat(v, m, axis=0)
    t0r = np.repeat(np.broadcast_to(t0, (n,)), m)
    tt = np.tile(t, n)
    oo = np.tile(obs, (n, 1))
    rho = np.full(n * m, 1.0)
    for _ in range(3):
        p, _ = propagate(rr, vv, tt - rho / C_AU_DAY - t0r)
        topo = p - oo
        rho = np.linalg.norm(topo, axis=1)
    ra, dec = radec(topo)
    return ra.reshape(n, m), dec.reshape(n, m), rho.reshape(n, m)


def residuals_arcsec(ra, dec, o: Observations) -> np.ndarray:
    """(N, M, 2) normalized residuals: (dRA cos dec, dDec) / sigma."""
    dra = ((ra - o.ra_deg + 180) % 360 - 180) * np.cos(np.radians(o.dec_deg))
    ddec = dec - o.dec_deg
    return np.stack([dra, ddec], axis=-1) * 3600 / o.sigma_arcsec[None, :, None]


# ------------------------------------------------------------------------- elements


def elements(r: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Ecliptic J2000 osculating elements [a, e, i, node, peri, M] (deg) of N states."""
    r = np.atleast_2d(r) @ EQ_TO_ECL.T
    v = np.atleast_2d(v) @ EQ_TO_ECL.T
    rn = np.linalg.norm(r, axis=1)
    h = np.cross(r, v)
    hn = np.linalg.norm(h, axis=1)
    inc = np.degrees(np.arccos(np.clip(h[:, 2] / hn, -1, 1)))
    nvec = np.stack([-h[:, 1], h[:, 0], np.zeros(len(h))], axis=1)
    nn = np.linalg.norm(nvec, axis=1)
    evec = np.cross(v, h) / MU - r / rn[:, None]
    e = np.linalg.norm(evec, axis=1)
    energy = np.einsum("ij,ij->i", v, v) / 2 - MU / rn
    a = -MU / (2 * energy)
    node = np.degrees(np.arctan2(nvec[:, 1], nvec[:, 0])) % 360
    cos_w = np.einsum("ij,ij->i", nvec, evec) / np.maximum(nn * e, 1e-300)
    peri = np.degrees(np.arccos(np.clip(cos_w, -1, 1)))
    peri = np.where(evec[:, 2] < 0, 360 - peri, peri)
    cos_nu = np.einsum("ij,ij->i", evec, r) / np.maximum(e * rn, 1e-300)
    nu = np.arccos(np.clip(cos_nu, -1, 1))
    nu = np.where(np.einsum("ij,ij->i", r, v) < 0, 2 * math.pi - nu, nu)
    ecc_anom = 2 * np.arctan2(
        np.sqrt(np.maximum(1 - e, 0)) * np.sin(nu / 2), np.sqrt(1 + e) * np.cos(nu / 2)
    )
    mean = np.degrees(ecc_anom - e * np.sin(ecc_anom)) % 360
    return np.stack([a, e, inc, node, peri, mean], axis=1)


def state_from_elements(el: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Inverse of elements() for bound orbits: (N, 6) -> heliocentric ICRS r, v."""
    el = np.atleast_2d(el)
    a, e = el[:, 0], el[:, 1]
    i, node, peri, mean = (np.radians(el[:, k]) for k in (2, 3, 4, 5))
    ecc = mean.copy()
    for _ in range(60):
        ecc = ecc - (ecc - e * np.sin(ecc) - mean) / (1 - e * np.cos(ecc))
    x = a * (np.cos(ecc) - e)
    y = a * np.sqrt(1 - e**2) * np.sin(ecc)
    rdot = np.sqrt(MU * a) / (a * (1 - e * np.cos(ecc)))
    vx = -rdot * np.sin(ecc)
    vy = rdot * np.sqrt(1 - e**2) * np.cos(ecc)
    co, so, ci, si, cw, sw = (
        np.cos(node),
        np.sin(node),
        np.cos(i),
        np.sin(i),
        np.cos(peri),
        np.sin(peri),
    )
    p = np.stack([co * cw - so * sw * ci, so * cw + co * sw * ci, sw * si], axis=1)
    q = np.stack([-co * sw - so * cw * ci, -so * sw + co * cw * ci, cw * si], axis=1)
    r = x[:, None] * p + y[:, None] * q
    v = vx[:, None] * p + vy[:, None] * q
    return r @ EQ_TO_ECL, v @ EQ_TO_ECL  # ecliptic -> equatorial (EQ_TO_ECL is orthogonal)


# ------------------------------------------------------------------------- fitting


@dataclass
class OrbitFit:
    status: str  # "preliminary" | "refined"
    epoch_tdb: float
    r: np.ndarray  # best state at epoch, (3,)
    v: np.ndarray
    elements: np.ndarray  # (6,)
    covariance: np.ndarray | None  # (6, 6) of elements
    rms_arcsec: float
    chi2: float
    n_obs: int
    arc_days: float
    clones_r: np.ndarray  # (N_CLONES, 3) at epoch
    clones_v: np.ndarray
    n_accepted: int  # ranging orbits within DELTA_CHI2
    helio_distance: tuple[float, float, float]  # median, 5th and 95th percentile of clones, AU
    observer_distance: tuple[float, float, float]  # from the first observer, same percentiles


def _chi2(r, v, t0, o: Observations) -> np.ndarray:
    ra, dec, _ = predict_radec(r, v, t0, o.mjd_tdb, o.obs)
    res = residuals_arcsec(ra, dec, o)
    return np.einsum("nmk,nmk->n", res, res)


def _ranging_eval(o: Observations, rho_a, rho_b, ua, ub):
    ia, ib = 0, len(o.mjd_tdb) - 1
    ra_ = o.obs[ia] + rho_a[:, None] * ua
    rb_ = o.obs[ib] + rho_b[:, None] * ub
    ta = o.mjd_tdb[ia] - rho_a / C_AU_DAY
    tb = o.mjd_tdb[ib] - rho_b / C_AU_DAY
    v1, ok = lambert(ra_, rb_, tb - ta)
    el = np.full((len(ok), 6), np.nan)
    if ok.any():
        el[ok] = elements(ra_[ok], v1[ok])
    good = ok & (el[:, 1] < 1) & (el[:, 0] > 0) & np.isfinite(el).all(axis=1)
    chi2 = np.full(len(ok), np.inf)
    idx = np.flatnonzero(good)
    for k in range(0, len(idx), 4000):
        j = idx[k : k + 4000]
        chi2[j] = _chi2(ra_[j], v1[j], ta[j], o)
    return ra_, v1, ta, chi2


def ranging(
    o: Observations,
    n_samples: int = 40_000,
    rng: np.random.Generator | None = None,
    rounds: int = 4,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Sample orbits through the first and last detections (bound orbits only).

    A broad first pass samples the first detection's distance log-uniformly from 0.002 to
    150 AU and the change in distance over the arc within +-0.05 AU/day; later passes resample
    around the orbits that fit, so the thin valley of acceptable orbits is mapped densely.
    Returns states at the emission time of the first detection, those epochs, and chi2."""
    rng = rng or np.random.default_rng(0)
    ia, ib = 0, len(o.mjd_tdb) - 1
    dt = o.mjd_tdb[ib] - o.mjd_tdb[ia]
    sa, sb = o.sigma_arcsec[ia] * ARCSEC, o.sigma_arcsec[ib] * ARCSEC
    base_a, base_b = (
        unit_vector(o.ra_deg[ia], o.dec_deg[ia]),
        unit_vector(o.ra_deg[ib], o.dec_deg[ib]),
    )

    def tangent(u0):
        e1 = np.cross([0.0, 0.0, 1.0], u0)
        e1 /= np.linalg.norm(e1)
        return e1, np.cross(u0, e1)

    ta_, tb_ = tangent(base_a), tangent(base_b)

    def dirs(base, tan, off):
        u = base + off[:, :1] * tan[0] + off[:, 1:] * tan[1]
        return u / np.linalg.norm(u, axis=1)[:, None]

    log_rho = rng.uniform(math.log(0.002), math.log(150.0), n_samples)
    drho = rng.uniform(-0.05, 0.05, n_samples) * dt
    off_a = rng.normal(0, sa, (n_samples, 2))
    off_b = rng.normal(0, sb, (n_samples, 2))
    pool = []
    # Exploration: find the valley of orbits that fit.
    for _ in range(rounds - 1):
        rho_a = np.exp(log_rho)
        rho_b = np.maximum(rho_a + drho, 1e-4)
        _, _, _, chi2 = _ranging_eval(
            o, rho_a, rho_b, dirs(base_a, ta_, off_a), dirs(base_b, tb_, off_b)
        )
        pool.append((chi2, log_rho, drho, off_a, off_b))
        allc = np.concatenate([p[0] for p in pool])
        fin = np.isfinite(allc)
        if not fin.any():
            return (np.empty((0, 3)),) * 2 + (np.empty(0),) * 2
        cut = max(np.min(allc[fin]) + 4 * DELTA_CHI2, np.sort(allc[fin])[min(199, fin.sum() - 1)])
        lr = np.concatenate([p[1] for p in pool])
        dr = np.concatenate([p[2] for p in pool])
        oa = np.concatenate([p[3] for p in pool])
        ob = np.concatenate([p[4] for p in pool])
        sel = np.flatnonzero(allc <= cut)
        pick = rng.choice(sel, size=n_samples, replace=True)
        log_rho = lr[pick] + rng.normal(0, 0.5 * max(float(np.std(lr[sel])), 1e-3), n_samples)
        drho = dr[pick] + rng.normal(0, 0.5 * max(float(np.std(dr[sel])), 1e-6), n_samples)
        off_a = oa[pick] + rng.normal(0, 0.5 * sa, (n_samples, 2))
        off_b = ob[pick] + rng.normal(0, 0.5 * sb, (n_samples, 2))
    # Final pass: uniform over the box the valley occupies (log-uniform first distance,
    # uniform change of distance), directions drawn from the astrometric errors. fit_orbit
    # reweights it to a prior uniform in distance.
    allc = np.concatenate([p[0] for p in pool]) if pool else np.array([])
    if pool:
        lr = np.concatenate([p[1] for p in pool])
        dr = np.concatenate([p[2] for p in pool])
        fin = np.isfinite(allc)
        sel = allc <= np.min(allc[fin]) + 4 * DELTA_CHI2
        lo_r, hi_r = lr[sel].min(), lr[sel].max()
        lo_d, hi_d = dr[sel].min(), dr[sel].max()
        pad_r, pad_d = max(0.2 * (hi_r - lo_r), 0.01), max(0.2 * (hi_d - lo_d), 1e-5)
        log_rho = rng.uniform(lo_r - pad_r, hi_r + pad_r, n_samples)
        drho = rng.uniform(lo_d - pad_d, hi_d + pad_d, n_samples)
    off_a = rng.normal(0, sa, (n_samples, 2))
    off_b = rng.normal(0, sb, (n_samples, 2))
    rho_a = np.exp(log_rho)
    rho_b = np.maximum(rho_a + drho, 1e-4)
    r, v, t0, chi2 = _ranging_eval(
        o, rho_a, rho_b, dirs(base_a, ta_, off_a), dirs(base_b, tb_, off_b)
    )
    fin = np.isfinite(chi2)
    return r[fin], v[fin], t0[fin], chi2[fin]


def _refine(r0, v0, t0, o: Observations):
    x0 = np.concatenate([r0, v0 * 100])  # velocities scaled to similar magnitude

    def fun(x):
        ra, dec, _ = predict_radec(x[None, :3], x[None, 3:] / 100, np.array([t0]), o.mjd_tdb, o.obs)
        return residuals_arcsec(ra, dec, o).ravel()

    sol = least_squares(fun, x0, method="lm", x_scale="jac", max_nfev=400)
    return sol, fun


def fit_orbit(
    o: Observations, rng: np.random.Generator | None = None, n_samples: int = 40_000
) -> OrbitFit | None:
    rng = rng or np.random.default_rng(0)
    if len(o.mjd_tdb) < 3:
        return None
    r, v, t0s, chi2 = ranging(o, n_samples=n_samples, rng=rng)
    if len(chi2) == 0:
        return None
    epoch = float(o.mjd_tdb[0])
    # Every ranging orbit at the common epoch (the first detection's time).
    r, v = propagate(r, v, epoch - t0s)
    best = int(np.argmin(chi2))
    sol, fun = _refine(r[best], v[best], epoch, o)
    resid = sol.fun
    m = len(o.mjd_tdb)
    dof = max(2 * m - 6, 1)
    chi2_best = float(resid @ resid)
    # Quoted errors that underestimate the scatter are inflated so the best fit has
    # reduced chi-square 1; the acceptance window is applied on the same scale.
    scale = max(min(chi2_best, float(chi2.min())) / dof, 1.0)
    keep = chi2 / scale <= min(chi2_best, float(chi2.min())) / scale + DELTA_CHI2
    rb, vb = sol.x[:3], sol.x[3:] / 100
    el_best = elements(rb, vb)[0]
    status, cov_el = "preliminary", None
    jac = sol.jac
    try:
        cov_x = np.linalg.inv(jac.T @ jac) * scale
        cond = np.linalg.cond(jac.T @ jac)
    except np.linalg.LinAlgError:
        cov_x, cond = None, np.inf
    if cov_x is not None and cond < 1e12 and np.all(np.diag(cov_x) > 0) and el_best[1] < 1:
        # element covariance by finite differences of the state -> elements map
        d = np.zeros((6, 6))
        for k in range(6):
            h = 1e-7 * max(abs(sol.x[k]), 1e-3)
            xp = sol.x.copy()
            xp[k] += h
            d[:, k] = (elements(xp[:3], xp[3:] / 100)[0] - el_best) / h
        cov_el = d @ cov_x @ d.T
        sig_a = math.sqrt(max(cov_el[0, 0], 0))
        if sig_a / el_best[0] < 0.1:
            status = "refined"
    if status == "refined":
        draws = rng.multivariate_normal(sol.x, cov_x, size=N_CLONES)
        cr, cv = draws[:, :3], draws[:, 3:] / 100
    else:
        # Not determined by the arc: of the orbits that fit, report the most circular one
        # (the usual choice for short arcs, in the spirit of Vaisala orbits; most asteroids
        # have low eccentricity), with clones drawn from the ranging distribution.
        el_all = elements(r[keep], v[keep])
        pick = np.flatnonzero(keep)[int(np.argmin(el_all[:, 1]))]
        rb, vb = r[pick], v[pick]
        el_best = elements(rb, vb)[0]
        ra_b, dec_b, _ = predict_radec(rb[None], vb[None], np.array([epoch]), o.mjd_tdb, o.obs)
        resid = residuals_arcsec(ra_b, dec_b, o)[0].ravel()
        chi2_best = float(resid @ resid)
        # The final pass samples the first distance log-uniformly; weighting by that distance
        # turns this into a prior uniform in distance, which validation/orbits.json showed
        # brackets distant objects far better (log-uniform pulls them too close).
        rho = np.linalg.norm(r[keep] - o.obs[0], axis=1)
        w = np.exp(-(chi2[keep] - chi2[keep].min()) / (2 * scale)) * rho
        idx = rng.choice(np.flatnonzero(keep), size=N_CLONES, replace=True, p=w / w.sum())
        cr, cv = r[idx], v[idx]
        el_clones = elements(cr, cv)
        cov_el = np.cov(el_clones.T) if len(el_clones) > 6 else None
    rn = np.linalg.norm(cr, axis=1)
    on = np.linalg.norm(cr - o.obs[0], axis=1)
    return OrbitFit(
        status=status,
        epoch_tdb=epoch,
        r=rb,
        v=vb,
        elements=el_best,
        covariance=cov_el,
        rms_arcsec=float(np.sqrt(np.mean((resid.reshape(-1, 2) * o.sigma_arcsec[:, None]) ** 2))),
        chi2=chi2_best,
        n_obs=m,
        arc_days=float(o.mjd_tdb[-1] - o.mjd_tdb[0]),
        clones_r=cr,
        clones_v=cv,
        n_accepted=int(keep.sum()),
        helio_distance=tuple(float(x) for x in np.percentile(rn, [50, 5, 95])),
        observer_distance=tuple(float(x) for x in np.percentile(on, [50, 5, 95])),
    )


def predict_sky(fit: OrbitFit, mjd_utc: np.ndarray, observer: np.ndarray):
    """Where the object will be: the centre and 1-sigma ellipse of the clones' positions.

    The clones sample the orbits that fit, so their spread is the uncertainty; for short arcs
    it is far from Gaussian, which is why the centre is the clones' mean position rather than
    the single reported orbit. Returns ra, dec (M,) and the ellipse (major, minor arcsec; PA
    deg east of north)."""
    t = np.asarray(mjd_utc, float) + TDB_MINUS_UTC
    cra, cdec, _ = predict_radec(
        fit.clones_r, fit.clones_v, np.full(len(fit.clones_r), fit.epoch_tdb), t, observer
    )
    u = unit_vector(cra, cdec).mean(axis=0)
    ra, dec = radec(u)
    major, minor, pa = [], [], []
    for j in range(len(t)):
        dx = ((cra[:, j] - ra[j] + 180) % 360 - 180) * math.cos(math.radians(dec[j])) * 3600
        dy = (cdec[:, j] - dec[j]) * 3600
        cov = np.cov(np.stack([dx, dy]))
        w, vec = np.linalg.eigh(cov)
        major.append(float(np.sqrt(max(w[1], 0))))
        minor.append(float(np.sqrt(max(w[0], 0))))
        pa.append(float(np.degrees(np.arctan2(vec[0, 1], vec[1, 1])) % 180))
    return np.atleast_1d(ra), np.atleast_1d(dec), np.array(major), np.array(minor), np.array(pa)
