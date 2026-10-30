"""How well SPHEREx-length arcs determine orbits: a test on simulated asteroids.

Each simulated asteroid gets known orbital elements drawn from one of five populations
(near-Earth, main belt, Jupiter trojan, Centaur, trans-Neptunian) and is placed where SPHEREx
looks (solar elongation 80-100 degrees). Its positions are computed as SPHEREx would have
seen them at the real times and from the real spacecraft positions of a published candidate,
Gaussian noise of that candidate's astrometric errors is added, and the orbit is fitted with
exactly the pipeline's method (science/orbit.py). We then compare with the truth:

- distance: is the true heliocentric distance inside the published 5-95% interval, and is
  the distance class right;
- elements: errors in a, e and i of the reported orbit;
- prediction: error of the predicted position 30 days later, and whether the truth lies
  inside the published 2- and 3-sigma ellipses.

These are simulated objects; the comparison with JPL's orbits of real, identified objects is
done by the Worker against JPL Horizons.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import numpy as np

from . import schemas as S
from .objects import distance_class
from .orbits import clone_class
from .science import orbit as O

log = logging.getLogger(__name__)

#: (name, a range AU, e range, i range deg, extra filter on (a, e))
POPULATIONS = [
    ("neo", (1.0, 2.2), (0.1, 0.6), (0.0, 30.0), lambda a, e: a * (1 - e) < 1.3),
    ("main_belt", (2.1, 3.3), (0.0, 0.25), (0.0, 20.0), lambda a, e: True),
    ("jupiter_trojan", (5.1, 5.3), (0.0, 0.15), (0.0, 25.0), lambda a, e: True),
    ("centaur", (8.0, 25.0), (0.0, 0.4), (0.0, 30.0), lambda a, e: a * (1 - e) > 6.0),
    ("tno", (35.0, 50.0), (0.0, 0.25), (0.0, 25.0), lambda a, e: True),
]
ELONGATION_DEG = (80.0, 100.0)
PREDICT_DAYS = 30.0


@dataclass
class Trial:
    population: str
    true_r: float
    fit_r: float
    r_lo: float
    r_hi: float
    true_class: str
    fit_class: str
    da: float
    de: float
    di: float
    true_a: float
    status: str
    pred_err_arcsec: float
    pred_sigma_major: float
    inside_2sigma: bool
    inside_3sigma: bool


def _draw(rng, pop, obs0: np.ndarray, t0: float):
    name, (a0, a1), (e0, e1), (i0, i1), ok = pop
    for _ in range(100_000):
        a, e, i = rng.uniform(a0, a1), rng.uniform(e0, e1), rng.uniform(i0, i1)
        if not ok(a, e):
            continue
        el = np.array([[a, e, i, rng.uniform(0, 360), rng.uniform(0, 360), rng.uniform(0, 360)]])
        r, v = O.state_from_elements(el)
        topo = r[0] - obs0
        cos_elong = float(-obs0 @ topo) / (np.linalg.norm(obs0) * np.linalg.norm(topo))
        elong = math.degrees(math.acos(max(-1, min(1, cos_elong))))
        if ELONGATION_DEG[0] <= elong <= ELONGATION_DEG[1]:
            return el[0], r[0], v[0]
    raise RuntimeError(f"no {name} orbit in the SPHEREx field of regard")


def _ellipse_inside(dx, dy, major, minor, pa_deg, k):
    """Is offset (dx east, dy north, arcsec) inside the k-sigma ellipse?"""
    pa = math.radians(pa_deg)
    u = dx * math.sin(pa) + dy * math.cos(pa)  # along the major axis
    w = dx * math.cos(pa) - dy * math.sin(pa)
    return (u / max(major, 1e-9)) ** 2 + (w / max(minor, 1e-9)) ** 2 <= k * k


def run_trial(rng, pop, real: O.Observations, mjd_utc: np.ndarray, sc_km: np.ndarray) -> Trial:
    t0 = float(real.mjd_tdb[0])
    el, r0, v0 = _draw(rng, pop, real.obs[0], t0)
    ra, dec, _ = O.predict_radec(r0[None], v0[None], np.array([t0]), real.mjd_tdb, real.obs)
    s = real.sigma_arcsec / 3600
    ra_n = ra[0] + rng.normal(0, s) / np.cos(np.radians(dec[0]))
    dec_n = dec[0] + rng.normal(0, s)
    o = O.Observations(real.mjd_tdb, ra_n, dec_n, real.sigma_arcsec, real.obs)
    fit = O.fit_orbit(o, rng=rng)
    true_r = float(np.linalg.norm(r0))
    t_pred = np.array([mjd_utc[-1] + PREDICT_DAYS])
    geo = O.observer_helio(t_pred, None)
    if fit is None:
        return Trial(
            pop[0],
            true_r,
            math.nan,
            math.nan,
            math.nan,
            pop[0],
            "unknown",
            math.nan,
            math.nan,
            math.nan,
            el[0],
            "none",
            math.nan,
            math.nan,
            False,
            False,
        )
    pra, pdec, major, minor, pa = O.predict_sky(fit, t_pred, geo)
    tra, tdec, _ = O.predict_radec(
        r0[None], v0[None], np.array([t0]), t_pred + O.TDB_MINUS_UTC, geo
    )
    dx = ((tra[0, 0] - pra[0] + 180) % 360 - 180) * math.cos(math.radians(pdec[0])) * 3600
    dy = (tdec[0, 0] - pdec[0]) * 3600

    def cls(d):
        return distance_class(S.DistanceEstimate(best=d, lo=d, hi=d)).value

    return Trial(
        population=pop[0],
        true_r=true_r,
        fit_r=fit.helio_distance[0],
        r_lo=fit.helio_distance[1],
        r_hi=fit.helio_distance[2],
        true_class=cls(true_r),
        fit_class=clone_class(fit.clones_r).value,
        da=float(fit.elements[0] - el[0]),
        de=float(fit.elements[1] - el[1]),
        di=float(fit.elements[2] - el[2]),
        true_a=float(el[0]),
        status=fit.status,
        pred_err_arcsec=float(math.hypot(dx, dy)),
        pred_sigma_major=float(major[0]),
        inside_2sigma=_ellipse_inside(dx, dy, major[0], minor[0], pa[0], 2),
        inside_3sigma=_ellipse_inside(dx, dy, major[0], minor[0], pa[0], 3),
    )


def validate(
    candidates: list[S.CandidateDetail], per_population: int = 12, seed: int = 20261030
) -> list[Trial]:
    rng = np.random.default_rng(seed)
    geoms = []
    for c in candidates:
        dets = sorted(c.detections, key=lambda d: d.mjd)
        geoms.append(
            (
                O.Observations.from_detections(dets),
                np.array([d.mjd for d in dets]),
                np.array([d.spacecraft_geocentric_km for d in dets], float),
            )
        )
    trials = []
    for pop in POPULATIONS:
        for k in range(per_population):
            real, mjd, sc = geoms[k % len(geoms)]
            t = run_trial(rng, pop, real, mjd, sc)
            log.info(
                "%s %d: r %.2f fit %.2f [%.2f, %.2f] %s",
                pop[0],
                k,
                t.true_r,
                t.fit_r,
                t.r_lo,
                t.r_hi,
                t.status,
            )
            trials.append(t)
    return trials


def summarize(trials: list[Trial]) -> dict:
    out = {}
    for name in [p[0] for p in POPULATIONS] + ["all"]:
        ts = [
            t for t in trials if (name == "all" or t.population == name) and not math.isnan(t.fit_r)
        ]
        if not ts:
            continue
        rel = np.array([abs(t.fit_r - t.true_r) / t.true_r for t in ts])
        out[name] = {
            "n": len(ts),
            "distance_in_5_95_interval": round(
                float(np.mean([t.r_lo <= t.true_r <= t.r_hi for t in ts])), 3
            ),
            "distance_rel_error_median": round(float(np.median(rel)), 3),
            "distance_class_named": round(
                float(np.mean([t.fit_class != "unknown" for t in ts])), 3
            ),
            "distance_class_correct": (
                round(float(np.mean([t.fit_class == t.true_class for t in named])), 3)
                if (named := [t for t in ts if t.fit_class != "unknown"])
                else None
            ),
            "a_rel_error_median": round(float(np.median([abs(t.da) / t.true_a for t in ts])), 3),
            "e_abs_error_median": round(float(np.median([abs(t.de) for t in ts])), 3),
            "i_abs_error_deg_median": round(float(np.median([abs(t.di) for t in ts])), 2),
            "prediction_30d_error_arcsec_median": round(
                float(np.median([t.pred_err_arcsec for t in ts])), 1
            ),
            "prediction_30d_inside_2sigma": round(float(np.mean([t.inside_2sigma for t in ts])), 3),
            "prediction_30d_inside_3sigma": round(float(np.mean([t.inside_3sigma for t in ts])), 3),
            "refined_fraction": round(float(np.mean([t.status == "refined" for t in ts])), 3),
        }
    return out


def run(
    out_dir, candidate_ids: list[str], per_population: int = 12, seed: int = 20261030
) -> S.OrbitValidation:
    """Run the test and write validation/orbits.json."""
    from .build import utc_now, write_json
    from .version import pipeline_version

    cands = [
        S.CandidateDetail.model_validate_json((out_dir / "candidates" / f"{c}.json").read_text())
        for c in candidate_ids
    ]
    trials = validate(cands, per_population=per_population, seed=seed)
    doc = S.OrbitValidation(
        pipeline_version=pipeline_version(require_clean=True),
        generated_utc=utc_now(),
        method=(
            "Simulated asteroids with known orbits from five populations, placed at solar "
            "elongation 80-100 degrees, observed at the real times and from SPHEREx's real "
            "positions of the listed candidates with their astrometric errors, then fitted with "
            "the pipeline's orbit method (statistical ranging, least squares, clones)."
        ),
        geometry_from=candidate_ids,
        per_population=per_population,
        seed=seed,
        rows=[S.OrbitValidationRow(population=k, **v) for k, v in summarize(trials).items()],
    )
    write_json(out_dir / "validation" / "orbits.json", doc)
    return doc
