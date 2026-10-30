from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

from spherex_px import schemas as S
from spherex_px.science import orbit as O

DATA = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data" / "candidates"


def test_elements_round_trip_and_two_body_motion():
    el = np.array([[2.6, 0.12, 8.0, 120.0, 40.0, 200.0], [40.0, 0.2, 15.0, 10.0, 300.0, 5.0]])
    r, v = O.state_from_elements(el)
    assert O.elements(r, v) == pytest.approx(el, abs=1e-8)
    # Forward and back, and a full period returns to the start.
    r2, v2 = O.propagate(r, v, np.array([30.0, 30.0]))
    r3, _ = O.propagate(r2, v2, np.array([-30.0, -30.0]))
    assert np.abs(r3 - r).max() < 1e-12
    period = 2 * np.pi * np.sqrt(el[0, 0] ** 3 / O.MU)
    rp, _ = O.propagate(r[:1], v[:1], np.array([period]))
    assert np.abs(rp - r[:1]).max() < 1e-9
    # Lambert recovers the velocity that connects two positions, over the arcs ranging uses
    # (the first and last detections of a track, days apart).
    for dt in (0.1, 0.5, 1.4, 4.0, 30.0):
        r2, _ = O.propagate(r, v, np.array([dt, dt]))
        v1, ok = O.lambert(r, r2, np.array([dt, dt]))
        assert ok.all() and np.abs(v1 - v).max() / np.abs(v).max() < 1e-10


def test_elements_are_in_the_ecliptic_frame():
    # A circular orbit in the ecliptic plane has inclination 0 whatever its equatorial tilt.
    r, v = O.state_from_elements(np.array([[1.0, 0.0, 0.0, 0.0, 0.0, 90.0]]))
    assert r[0, 2] != pytest.approx(0.0, abs=1e-6)  # equatorial z is not zero
    assert O.elements(r, v)[0, 2] == pytest.approx(0.0, abs=1e-8)


def _synthetic(el, cand):
    """A known orbit observed at a real candidate's times, from SPHEREx's real positions."""
    real = O.Observations.from_detections(cand.detections)
    r0, v0 = O.state_from_elements(np.array([el]))
    t0 = real.mjd_tdb[:1]
    ra, dec, _ = O.predict_radec(r0, v0, t0, real.mjd_tdb, real.obs)
    return O.Observations(real.mjd_tdb, ra[0], dec[0], real.sigma_arcsec, real.obs), r0[0]


@pytest.fixture
def cand():
    p = DATA / "aquarius-b-c01.json"
    if not p.exists():
        pytest.skip("published data not present")
    return S.CandidateDetail.model_validate_json(p.read_text())


def _visible_orbit(cand, a, e, i, rng):
    real = O.Observations.from_detections(cand.detections)
    obs0 = real.obs[0]
    while True:
        el = [a, e, i, *rng.uniform(0, 360, 3)]
        r, _ = O.state_from_elements(np.array([el]))
        topo = r[0] - obs0
        elong = np.degrees(np.arccos(-obs0 @ topo / np.linalg.norm(obs0) / np.linalg.norm(topo)))
        if 80 <= elong <= 100:
            return el


def test_ranging_brackets_a_main_belt_asteroid(cand):
    rng = np.random.default_rng(3)
    el = _visible_orbit(cand, 2.7, 0.1, 6.0, rng)
    o, r0 = _synthetic(el, cand)
    fit = O.fit_orbit(o, rng=np.random.default_rng(0), n_samples=20_000)
    assert fit is not None and fit.n_accepted > 50
    best, lo, hi = fit.helio_distance
    assert lo <= np.linalg.norm(r0) <= hi
    assert fit.rms_arcsec < 1.0  # noiseless synthetic positions fit to well under the errors
    assert fit.clones_r.shape == (O.N_CLONES, 3)


def test_prediction_and_published_files(cand, tmp_path):
    from spherex_px.orbits import (
        clones_doc,
        fit_detections,
        input_hash,
        orbital_elements,
        prediction_doc,
    )

    rec = fit_detections(cand.detections, seed=1)
    assert rec is not None and rec.input_hash == input_hash(cand.detections)
    el = orbital_elements(rec, "obj-x")
    assert el.helio_distance_au.lo <= el.helio_distance_au.best <= el.helio_distance_au.hi
    assert el.clones_url == "/data/objects/obj-x/clones.json" and el.n_clones == O.N_CLONES
    clones = clones_doc(rec, "obj-x", "test")
    assert len(clones.clones) == O.N_CLONES and all(c.e < 1 for c in clones.clones)
    pred = prediction_doc(rec, "obj-x", "test", datetime(2026, 10, 30, 15, 0, tzinfo=UTC))
    assert len(pred.points) == 61 and pred.points[0].time_utc == "2026-10-30T00:00:00Z"
    # The published arc is from June 2025; over a year later the clones disagree widely,
    # and the prediction says so in plain words.
    assert pred.points[0].sigma_major_arcsec > 3600
    assert "degrees" in pred.note_plain and "new observations" in pred.note_plain


def test_orbit_cache_is_reused_and_invalidated(cand, tmp_path):
    from spherex_px.orbits import orbit_for, orbit_path

    rec = orbit_for(tmp_path, cand)
    assert rec is not None and orbit_path(tmp_path, cand.candidate_id).exists()
    assert orbit_for(tmp_path, cand).elements == rec.elements  # from the cache
    moved = cand.model_copy(deep=True)
    moved.detections[0].ra_deg += 1e-4
    assert orbit_for(tmp_path, moved).input_hash != rec.input_hash
