"""Anomaly ranking for objects (build plan section 3.3).

Anomaly ranking: an Isolation Forest over measured features of every published object
(motion rate, how steeply it moves across the ecliptic, ecliptic latitude, distance from the
Sun, and infrared colour), so the objects least like the rest come first. Each object gets a
one-line reason from the feature furthest from the population's median. The ranking is relative
to the objects we have tracked; "unusual" never means "new" or "unexplained".

An NEO likelihood (section 3.4) is not published: the fraction of orbit clones with
perihelion below 1.3 AU was tested on the published objects JPL identified, and gave 0.9 or
more for known main-belt asteroids (1623 Vivian 0.97, 2030 Belyaev 0.91), because short arcs
allow near-Earth orbits and the clones carry no population prior. It needs a Digest2-style
population weighting first.
"""

from __future__ import annotations

import math
import warnings

import astropy.units as u
import numpy as np
from astropy.coordinates import BarycentricMeanEcliptic, SkyCoord

from . import schemas as S

#: Colour is measured below this wavelength (reflected sunlight), microns.
REFLECTED_MAX_UM = 2.5
ANOMALY_METHOD = "isolation_forest_v1"
SEED = 20261102
#: Fewer objects than this and a ranking means little; none is written.
MIN_OBJECTS = 10

FEATURES = {
    "log_rate": "motion rate",
    "cross_ecliptic": "motion across the ecliptic",
    "abs_ecl_lat": "distance from the ecliptic",
    "log_helio_au": "distance from the Sun",
    "colour": "infrared colour (0.75-2.5 µm)",
}


def _ecliptic_motion(o: S.ObjectDetail) -> tuple[float | None, float]:
    """|sin| of the motion's angle to the ecliptic, and |ecliptic latitude| (deg)."""
    d0 = min(o.detections, key=lambda d: d.mjd)
    c = SkyCoord(d0.ra_deg * u.deg, d0.dec_deg * u.deg).transform_to(BarycentricMeanEcliptic())
    lat = abs(float(c.lat.deg))
    m = o.motion
    if m.ra_rate_arcsec_per_hr is None or m.dec_rate_arcsec_per_hr is None:
        return None, lat
    dt = 1.0  # hour
    d1 = SkyCoord(
        (d0.ra_deg + m.ra_rate_arcsec_per_hr * dt / 3600 / math.cos(math.radians(d0.dec_deg)))
        * u.deg,
        (d0.dec_deg + m.dec_rate_arcsec_per_hr * dt / 3600) * u.deg,
    ).transform_to(BarycentricMeanEcliptic())
    dlon = ((float(d1.lon.deg) - float(c.lon.deg) + 180) % 360 - 180) * math.cos(
        math.radians(float(c.lat.deg))
    )
    dlat = float(d1.lat.deg) - float(c.lat.deg)
    norm = math.hypot(dlon, dlat)
    return (abs(dlat) / norm if norm > 0 else None), lat


def _colour(o: S.ObjectDetail) -> float | None:
    """Spectral slope d log(flux) / d log(wavelength) in reflected sunlight (below
    REFLECTED_MAX_UM). Longer wavelengths are left out: there an asteroid's own thermal emission
    can rise steeply, so slopes over different bands would not be comparable."""
    pts = [
        p
        for p in (o.spectrum.points if o.spectrum else [])
        if p.flux_ujy > 0 and p.wavelength_um < REFLECTED_MAX_UM
    ]
    if len(pts) < 4:
        return None
    x = np.log([p.wavelength_um for p in pts])
    if np.ptp(x) < 0.1:
        return None
    y = np.log([p.flux_ujy for p in pts])
    return float(np.polyfit(x, y, 1)[0])


def features_of(o: S.ObjectDetail) -> dict[str, float | None]:
    cross, lat = _ecliptic_motion(o)
    rate = o.motion.rate_arcsec_per_hr
    helio = o.orbit.helio_distance_au.best if o.orbit and o.orbit.helio_distance_au else None
    return {
        "log_rate": math.log10(rate) if rate and rate > 0 else None,
        "cross_ecliptic": cross,
        "abs_ecl_lat": lat,
        "log_helio_au": math.log10(helio) if helio and helio > 0 else None,
        "colour": _colour(o),
    }


def _reason(name: str, value: float, median: float) -> str:
    if name == "log_rate":
        f = 10 ** (value - median)
        return (
            f"Moving {f:.1f}× faster than the median of the objects we have tracked"
            if f >= 1
            else f"Moving {1 / f:.1f}× slower than the median of the objects we have tracked"
        )
    if name == "log_helio_au":
        f = 10 ** (value - median)
        return (
            f"About {f:.1f}× farther from the Sun than the median of the objects we have tracked"
            if f >= 1
            else f"About {1 / f:.1f}× closer to the Sun than the median of the objects we have tracked"
        )
    if name == "cross_ecliptic":
        steep = math.degrees(math.asin(min(1.0, value)))
        return (
            f"Moving at {steep:.0f}° to the ecliptic, steeper than most objects we have tracked"
            if value > median
            else f"Moving almost along the ecliptic ({steep:.0f}°), flatter than most objects we have tracked"
        )
    if name == "abs_ecl_lat":
        return f"{value:.1f}° from the ecliptic, {'farther from' if value > median else 'closer to'} it than most objects we have tracked"
    return f"Infrared colour (spectral slope {value:+.2f}) {'redder' if value > median else 'bluer'} than most objects we have tracked"


def rank_anomalies(objects: list[S.ObjectDetail]) -> dict[str, S.Anomaly]:
    """Anomaly block per object id (objects with a motion fit only); empty below MIN_OBJECTS."""
    from sklearn.ensemble import IsolationForest

    # Two-detection pairs have no motion fit and likely artifacts no reliable one.
    excluded = (
        S.Classification.injected,
        S.Classification.unconfirmed_pair,
        S.Classification.likely_artifact,
    )
    real = [o for o in objects if o.classification not in excluded]
    if len(real) < MIN_OBJECTS:
        return {}
    names = list(FEATURES)
    raw = np.array(
        [[np.nan if (v := features_of(o)[n]) is None else v for n in names] for o in real], float
    )
    with warnings.catch_warnings():
        # Columns with missing values (a feature not measured for some objects) are expected.
        warnings.simplefilter("ignore", RuntimeWarning)
        return _rank(real, raw, names, IsolationForest)


def _rank(real, raw, names, IsolationForest) -> dict[str, S.Anomaly]:
    known = ~np.all(np.isnan(raw), axis=0)
    med = np.where(known, np.nanmedian(np.where(known, raw, 0.0), axis=0), 0.0)
    mad = np.nanmedian(np.abs(raw - med), axis=0) * 1.4826
    mad = np.where(known & (mad > 0), mad, np.nan_to_num(np.nanstd(raw, axis=0)) + 1e-9)
    z = (raw - med) / mad
    filled = np.where(np.isnan(z), 0.0, z)  # a missing feature is treated as typical
    forest = IsolationForest(n_estimators=500, random_state=SEED).fit(filled)
    # score_samples is higher for normal points; flip so higher = more unusual, in [0, 1].
    s = -forest.score_samples(filled)
    score = (s - s.min()) / (s.max() - s.min()) if s.max() > s.min() else np.zeros_like(s)
    order = np.argsort(-score, kind="stable")
    ranks = np.empty(len(real), int)
    ranks[order] = np.arange(1, len(real) + 1)
    out = {}
    for i, o in enumerate(real):
        k = int(np.nanargmax(np.abs(np.where(np.isnan(z[i]), 0.0, z[i]))))
        out[o.object_id] = S.Anomaly(
            score=round(float(score[i]), 3),
            rank=int(ranks[i]),
            n_ranked=len(real),
            reason_plain=_reason(names[k], float(raw[i, k]), float(med[k])),
            features=[
                S.AnomalyFeature(
                    name=n,
                    label=FEATURES[n],
                    value=None if np.isnan(raw[i, j]) else round(float(raw[i, j]), 4),
                    median=round(float(med[j]), 4),
                    z=None if np.isnan(z[i, j]) else round(float(z[i, j]), 2),
                )
                for j, n in enumerate(names)
            ],
            method=ANOMALY_METHOD,
        )
    return out
