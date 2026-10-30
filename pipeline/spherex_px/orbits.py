"""Orbits for published objects: fit, cache, and the files the API serves.

The fit (science/orbit.py) takes seconds per object, so it runs when a field is built, which
the survey spreads over many machines, and is cached next to the candidate in
``candidates/<id>/orbit.json`` with a hash of the detections it used. ``publish`` reads the
cache (fitting any object that has none or whose detections changed) and writes, per object:

- the orbit block of ``objects/<id>.json`` (elements, uncertainty, distance);
- ``objects/<id>/clones.json``: the sampled orbit clones (the uncertainty cloud);
- ``objects/<id>/prediction.json``: where it will be over the next 60 days, seen from Earth.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
from astropy.time import Time
from pydantic import BaseModel

from . import schemas as S
from .science import orbit as O

log = logging.getLogger(__name__)

#: Bump when the fit changes, so cached orbits are refitted.
ORBIT_VERSION = "1"
PREDICTION_DAYS = 60


class OrbitRecord(BaseModel):
    """Everything a fit produced; internal (the API serves OrbitalElements and the files)."""

    input_hash: str
    status: str
    epoch_tdb: float
    r: list[float]
    v: list[float]
    elements: list[float]
    covariance: list[list[float]] | None
    rms_arcsec: float
    chi2: float
    n_obs: int
    arc_days: float
    clones_r: list[list[float]]
    clones_v: list[list[float]]
    n_accepted: int
    helio_distance: list[float]
    observer_distance: list[float]

    def fit(self) -> O.OrbitFit:
        return O.OrbitFit(
            status=self.status,
            epoch_tdb=self.epoch_tdb,
            r=np.array(self.r),
            v=np.array(self.v),
            elements=np.array(self.elements),
            covariance=None if self.covariance is None else np.array(self.covariance),
            rms_arcsec=self.rms_arcsec,
            chi2=self.chi2,
            n_obs=self.n_obs,
            arc_days=self.arc_days,
            clones_r=np.array(self.clones_r),
            clones_v=np.array(self.clones_v),
            n_accepted=self.n_accepted,
            helio_distance=tuple(self.helio_distance),
            observer_distance=tuple(self.observer_distance),
        )


def input_hash(dets: list[S.Detection]) -> str:
    key = [
        (
            round(d.mjd, 8),
            round(d.ra_deg, 7),
            round(d.dec_deg, 7),
            d.pos_err_arcsec,
            d.spacecraft_geocentric_km,
        )
        for d in sorted(dets, key=lambda d: d.mjd)
    ]
    return hashlib.sha256(json.dumps([ORBIT_VERSION, key]).encode()).hexdigest()[:16]


def fit_detections(dets: list[S.Detection], seed: int = 0) -> OrbitRecord | None:
    if len(dets) < 3 or any(d.spacecraft_geocentric_km is None for d in dets):
        return None
    f = O.fit_orbit(O.Observations.from_detections(dets), rng=np.random.default_rng(seed))
    if f is None:
        return None
    return OrbitRecord(
        input_hash=input_hash(dets),
        status=f.status,
        epoch_tdb=f.epoch_tdb,
        r=f.r.tolist(),
        v=f.v.tolist(),
        elements=f.elements.tolist(),
        covariance=None if f.covariance is None else np.asarray(f.covariance).tolist(),
        rms_arcsec=f.rms_arcsec,
        chi2=f.chi2,
        n_obs=f.n_obs,
        arc_days=f.arc_days,
        clones_r=f.clones_r.tolist(),
        clones_v=f.clones_v.tolist(),
        n_accepted=f.n_accepted,
        helio_distance=list(f.helio_distance),
        observer_distance=list(f.observer_distance),
    )


def orbit_path(out_dir: Path, candidate_id: str) -> Path:
    return out_dir / "candidates" / candidate_id / "orbit.json"


def orbit_for(out_dir: Path, c: S.CandidateDetail) -> OrbitRecord | None:
    """The cached orbit for a candidate, fitting (and caching) it when missing or stale."""
    if c.classification == S.Classification.injected or c.motion.model == S.MotionModel.none:
        return None
    p = orbit_path(out_dir, c.candidate_id)
    h = input_hash(c.detections)
    if p.exists():
        rec = OrbitRecord.model_validate_json(p.read_text())
        if rec.input_hash == h:
            return rec
    seed = int(h[:8], 16)
    rec = fit_detections(c.detections, seed=seed)
    p.parent.mkdir(parents=True, exist_ok=True)
    if rec is not None:
        p.write_text(rec.model_dump_json())
        log.info(
            "%s: %s orbit, a=%.2f AU e=%.2f",
            c.candidate_id,
            rec.status,
            rec.elements[0],
            rec.elements[1],
        )
    return rec


def _sym(m: np.ndarray) -> list[list[float]]:
    return [[float(f"{x:.6g}") for x in row] for row in m]


CHECK_DAYS = 30.0


def check_point(rec: OrbitRecord) -> S.PredictionPoint:
    """Clones' geocentric position 30 days after the last detection."""
    mjd_utc = rec.epoch_tdb - O.TDB_MINUS_UTC + rec.arc_days + CHECK_DAYS
    geo = O.observer_helio(np.array([mjd_utc]), None)
    ra, dec, major, minor, pa = O.predict_sky(rec.fit(), np.array([mjd_utc]), geo)
    return S.PredictionPoint(
        time_utc=Time(mjd_utc, format="mjd").isot[:19] + "Z",
        mjd=round(float(mjd_utc), 6),
        ra_deg=round(float(ra[0]), 6),
        dec_deg=round(float(dec[0]), 6),
        sigma_major_arcsec=round(float(major[0]), 1),
        sigma_minor_arcsec=round(float(minor[0]), 1),
        sigma_pa_deg=round(float(pa[0]), 1),
    )


def orbital_elements(rec: OrbitRecord, object_id: str) -> S.OrbitalElements:
    a, e, i, node, peri, mean = rec.elements
    return S.OrbitalElements(
        epoch_mjd=round(rec.epoch_tdb, 6),
        a_au=round(a, 4),
        e=round(e, 4),
        i_deg=round(i, 3),
        node_deg=round(node, 3),
        peri_deg=round(peri, 3),
        mean_anomaly_deg=round(mean, 3),
        q_au=round(a * (1 - e), 4),
        method="least_squares" if rec.status == "refined" else "ranging",
        rms_arcsec=round(rec.rms_arcsec, 3),
        n_detections=rec.n_obs,
        arc_hours=round(rec.arc_days * 24, 3),
        covariance=None if rec.covariance is None else _sym(np.array(rec.covariance)),
        n_clones=len(rec.clones_r),
        clones_url=f"/data/objects/{object_id}/clones.json",
        helio_distance_au=S.DistanceEstimate(
            best=round(rec.helio_distance[0], 3),
            lo=round(rec.helio_distance[1], 3),
            hi=round(rec.helio_distance[2], 3),
        ),
        n_ranging_orbits=rec.n_accepted,
        check_30d=check_point(rec),
        reported_orbit=(
            "Least-squares fit to all detections."
            if rec.status == "refined"
            else "The arc is too short to fix one orbit, so this is the most circular of the "
            f"{rec.n_accepted} sampled orbits that fit the detections; the clones show the range."
        ),
    )


def clones_doc(rec: OrbitRecord, object_id: str, version: str) -> S.OrbitClones:
    el = O.elements(np.array(rec.clones_r), np.array(rec.clones_v))
    return S.OrbitClones(
        pipeline_version=version,
        object_id=object_id,
        epoch_mjd=round(rec.epoch_tdb, 6),
        frame="heliocentric J2000 ecliptic",
        clones=[
            S.CloneElements(
                a_au=round(float(x[0]), 5),
                e=round(float(x[1]), 5),
                i_deg=round(float(x[2]), 4),
                node_deg=round(float(x[3]), 4),
                peri_deg=round(float(x[4]), 4),
                mean_anomaly_deg=round(float(x[5]), 4),
            )
            for x in el
        ],
    )


def prediction_doc(
    rec: OrbitRecord, object_id: str, version: str, now: datetime
) -> S.ObjectPrediction:
    """Daily geocentric positions with clone-scatter ellipses, starting today (UTC)."""
    start = now.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=UTC)
    times = [start + timedelta(days=k) for k in range(PREDICTION_DAYS + 1)]
    mjd = Time(times).mjd
    geo = O.observer_helio(mjd, None)
    ra, dec, major, minor, pa = O.predict_sky(rec.fit(), mjd, geo)
    worst = float(np.max(major))
    last_obs = Time(rec.epoch_tdb - O.TDB_MINUS_UTC + rec.arc_days, format="mjd").datetime
    since = f"{rec.arc_days * 24:.0f} hours of observations ending {last_obs:%B %Y}"
    if worst > 3600:
        note = (
            f"The orbit comes from {since}, so where it is now is uncertain by about "
            f"{worst / 3600:.0f} degrees: it needs new observations to be found again."
        )
    else:
        note = f"The orbit comes from {since}; positions are uncertain by up to {worst:.0f} arcseconds (1 sigma)."
    return S.ObjectPrediction(
        pipeline_version=version,
        object_id=object_id,
        generated_utc=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        orbit_epoch_mjd=round(rec.epoch_tdb, 6),
        observer="geocenter",
        days=PREDICTION_DAYS,
        note_plain=note,
        points=[
            S.PredictionPoint(
                time_utc=t.strftime("%Y-%m-%dT%H:%M:%SZ"),
                mjd=round(float(m), 5),
                ra_deg=round(float(r), 5),
                dec_deg=round(float(d), 5),
                sigma_major_arcsec=round(float(a), 1),
                sigma_minor_arcsec=round(float(b), 1),
                sigma_pa_deg=round(float(p), 1),
                vmag_estimate=None,
            )
            for t, m, r, d, a, b, p in zip(times, mjd, ra, dec, major, minor, pa, strict=True)
        ],
    )


#: Share of the clones that must agree before a distance class is named.
CLASS_AGREEMENT = 0.68


def clone_class(clones_r: np.ndarray) -> S.DistanceClass:
    """The distance class most clones fall in, if at least CLASS_AGREEMENT of them do; otherwise
    unknown. Short arcs often leave the distance spanning several classes (validation/orbits.json
    measures how often), and then the class is not named."""
    from .objects import distance_class

    r = np.linalg.norm(np.asarray(clones_r, float), axis=1)
    classes = [
        distance_class(S.DistanceEstimate(best=float(x), lo=float(x), hi=float(x))) for x in r
    ]
    best = max(set(classes), key=classes.count)
    if best == S.DistanceClass.unknown or classes.count(best) < CLASS_AGREEMENT * len(classes):
        return S.DistanceClass.unknown
    return best


def distance_class_of(rec: OrbitRecord) -> S.DistanceClass:
    return clone_class(np.array(rec.clones_r))
