"""Composition science: geometry, solar division, taxonomy, hydration and thermal checks."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

import numpy as np
import pytest

from spherex_px import composition as comp
from spherex_px import schemas as S
from spherex_px.science import composition as C
from spherex_px.science import orbit as O

DATA = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data"
# Same pattern as worker/src/ai/core.ts FORBIDDEN: no discovery claims in any generated text.
FORBIDDEN = re.compile(
    r"\b(discover\w*|new planet|first ever|never (been )?seen before)\b|\b(is|could be|might be|may be|likely|probably|found) (a |the )?(planet x|planet nine|planet 9)\b",
    re.I,
)


def _template(name: str) -> C.Template:
    return next(t for t in C.templates() if t.name == name)


def _points_from_template(name, wavelengths, frac_err=0.02, rng=None, scale=1.0):
    """Fake fluxes for a body with exactly this class's reflectance (unit tests only)."""
    t = _template(name)
    pts = []
    for i, w in enumerate(wavelengths):
        refl = float(np.interp(w, t.wavelength_um, t.reflectance)) * scale
        sun = C.solar_in_band(w - w / 80, w + w / 80) * w**2
        f = refl * sun
        if rng is not None:
            f *= 1 + rng.normal() * frac_err
        pts.append(
            C.Point(
                i % 102, w, w - w / 80, w + w / 80, f"e{i:02d}", 60800 + i * 0.02, f, f * frac_err
            )
        )
    return pts


# ---------------------------------------------------------------------------- reference data


def test_reference_data_shapes_and_normalisation():
    w, f = C.solar_spectrum()
    assert w.min() <= 0.7 and w.max() >= 5.0
    assert np.all(np.diff(w) > 0) and np.all(f > 0)
    # E490 at 1 um is ~0.75 W m^-2 nm^-1 (= 750 W m^-2 um^-1).
    assert 650 < np.interp(1.0, w, f) < 800
    names = [t.name for t in C.templates()]
    assert len(names) == 25 and {"S", "C", "X", "V", "D"} <= set(names)
    for t in C.templates():
        win = (t.wavelength_um >= 1.0) & (t.wavelength_um <= 1.2)
        assert t.reflectance[win].mean() == pytest.approx(1.0, abs=1e-9)
        assert np.all(t.sigma > 0)


def test_hg_phase_function():
    assert C.hg_phase(0.0) == pytest.approx(1.0)
    p = C.hg_phase(np.array([5.0, 20.0, 40.0]))
    assert np.all(np.diff(p) < 0)
    # Bowell et al. 1989, G = 0.15: about 0.5 mag fainter at 10 degrees.
    assert -2.5 * math.log10(float(C.hg_phase(10.0))) == pytest.approx(0.55, abs=0.1)


# ---------------------------------------------------------------------------- reflectance


def test_solar_division_recovers_a_flat_reflector():
    wl = np.linspace(0.8, 2.4, 20)
    pts = _points_from_template("C", wl)
    for p, w in zip(pts, wl, strict=True):  # make it perfectly grey
        p.flux_ujy = C.solar_in_band(p.wl_lo_um, p.wl_hi_um) * w**2 * 3.0
        p.flux_err_ujy = p.flux_ujy * 0.01
    res = C.analyse(pts, None, None)
    refl = [p.reflectance for p in res.spectrum.points if p.reflectance is not None]
    assert np.allclose(refl, 1.0, atol=1e-6)
    assert res.taxonomy.slope_per_um == pytest.approx(0.0, abs=1e-6)
    assert res.spectrum.norm_method == "points_in_window"


def test_taxonomy_recovers_clear_classes_with_good_coverage():
    rng = np.random.default_rng(1)
    wl = np.linspace(0.76, 2.44, 40)
    for name, cx in (("S", "S"), ("C", "C"), ("V", "V"), ("D", "D")):
        res = C.analyse(_points_from_template(name, wl, 0.01, rng), None, None)
        assert res.taxonomy is not None
        assert res.taxonomy.best_complex == cx, name
        assert res.taxonomy.matches[0].probability >= res.taxonomy.matches[1].probability


def test_confidence_is_capped_by_coverage():
    rng = np.random.default_rng(2)
    narrow = C.analyse(_points_from_template("S", np.linspace(1.2, 1.6, 6), 0.02, rng), None, None)
    assert narrow.taxonomy is not None and narrow.taxonomy.confidence == "low"
    too_few = C.analyse(_points_from_template("S", np.linspace(1.2, 1.3, 4), 0.02, rng), None, None)
    assert too_few.taxonomy is None
    assert C.confidence_level(0.95, 30, 1.6, 1.0) == "high"
    assert C.confidence_level(0.95, 30, 1.6, 5.0) == "medium"
    assert C.confidence_level(0.95, 7, 1.6, 1.0) == "low"


def test_template_fit_normalisation_without_window_points():
    pts = _points_from_template("S", np.linspace(1.3, 2.4, 12), 0.01, scale=4.0)
    res = C.analyse(pts, None, None)
    assert res.spectrum.norm_method == "template_fit"
    # After normalising through the best template, that template's scale is 1.
    assert res.taxonomy.matches[0].scale == pytest.approx(1.0, rel=1e-6)


# ---------------------------------------------------------------------------- geometry


def test_geometry_correction_follows_inverse_square_and_phase():
    # A main-belt orbit near opposition, seen over two days from Earth's centre.
    el = np.array([[2.6, 0.05, 3.0, 80.0, 30.0, 10.0]])
    epoch = 60850.0
    mjd = np.linspace(60849.0, 60851.0, 9)
    sc = np.zeros((len(mjd), 3))
    g = C.geometry_correction(mjd, sc, el, epoch)
    assert g.method == "orbit_clones" or g.method == "same_night_only"
    clones = np.repeat(el, 5, axis=0)
    g = C.geometry_correction(mjd, sc, clones, epoch)
    assert g.method == "orbit_clones"
    r, d, a = C._geometry_from_clones(
        el, epoch, np.append(mjd, g.ref_mjd), np.zeros((len(mjd) + 1, 3))
    )
    expect = (r[0, :-1] ** 2 * d[0, :-1] ** 2) / (r[0, -1] ** 2 * d[0, -1] ** 2)
    expect *= C.hg_phase(a[0, -1]) / C.hg_phase(a[0, :-1])
    assert np.allclose(g.factor, expect)
    assert np.allclose(g.factor_frac_err, 0, atol=1e-12)  # identical clones: no spread
    # The factor is 1 at the reference time and the distances are sensible.
    mid = int(np.argmin(abs(mjd - g.ref_mjd)))
    assert g.factor[mid] == pytest.approx(1.0, abs=1e-9)
    assert 1.5 < g.r_au < 3.0 and 0.5 < g.delta_au < 4.0 and 0 <= g.phase_deg < 40


def test_geometry_phase_angle_matches_vectors():
    el = np.array([[2.2, 0.1, 5.0, 120.0, 60.0, 200.0]])
    mjd = np.array([60800.0, 60800.5])
    r, d, a = C._geometry_from_clones(el, 60800.0, mjd, np.zeros((2, 3)))
    r0, v0 = O.state_from_elements(el)
    obs = O.observer_helio(mjd[:1], None)[0]
    p = r0[0]  # epoch equals the first time; light time moves it slightly
    alpha = math.degrees(
        math.acos(np.dot(-p, obs - p) / (np.linalg.norm(p) * np.linalg.norm(obs - p)))
    )
    assert a[0, 0] == pytest.approx(alpha, abs=0.05)
    assert r[0, 0] == pytest.approx(np.linalg.norm(p), rel=1e-3)


def test_without_orbit_only_one_night_is_used():
    pts = _points_from_template("S", np.linspace(0.8, 2.0, 10))
    for i, p in enumerate(pts):
        p.mjd = 60800.0 + (0.01 * i if i < 7 else 3 + 0.01 * i)
    res = C.analyse(pts, None, None)
    assert res.spectrum.geometry.method == "same_night_only"
    excluded = [
        p for p in res.spectrum.points if p.excluded_reason and "night" in p.excluded_reason
    ]
    assert len(excluded) == 3


# ---------------------------------------------------------------------------- thermal, hydration


def test_thermal_fraction_grows_near_the_sun_and_at_long_wavelengths():
    assert C.thermal_fraction(1.5, 2.5) < 1e-6
    assert C.thermal_fraction(4.5, 1.0) > 0.9  # NEO: 4.5 um is mostly heat
    assert C.thermal_fraction(3.0, 1.0) > C.thermal_fraction(3.0, 2.5)
    assert C.thermal_fraction(4.5, 2.5) > C.thermal_fraction(3.0, 2.5)


def _hydration_points(depth: float, r_au: float):
    wl = list(np.linspace(1.65, 2.6, 8)) + [2.75, 2.85, 2.95, 3.05]
    pts = []
    for i, w in enumerate(wl):
        refl = 1.0 * (1 - depth if 2.7 <= w <= 3.1 else 1.0)
        sun = C.solar_in_band(w - 0.02, w + 0.02) * w**2
        f = refl * sun
        pts.append(C.Point(i, w, w - 0.02, w + 0.02, f"e{i:02d}", 60800 + i * 0.02, f, f * 0.01))
    geom = C.Geometry("orbit_clones", np.ones(len(pts)), np.zeros(len(pts)), np.ones(len(pts), bool),
                      60800.0, r_au, 1.5, 10.0, r_au)  # fmt: skip
    spec = C.reflectance(pts, geom)
    C.normalise(spec)
    return C.hydration(spec)


def test_hydration_band_depth_and_thermal_guard():
    h = _hydration_points(0.15, 3.0)
    assert h.status == "measured"
    assert h.band_depth == pytest.approx(0.15, abs=1e-6)
    assert h.band_depth_err > 0 and h.snr > 0
    assert _hydration_points(0.0, 3.0).band_depth == pytest.approx(0.0, abs=1e-6)
    # Near the Sun, 2.7-3.1 um is partly heat: no hydration claim is made.
    assert _hydration_points(0.15, 0.9).status == "thermal"


# ---------------------------------------------------------------------------- validation helpers


def test_truth_complex_mapping():
    assert comp.truth_complex("Sq", None)[2] == "S"
    assert comp.truth_complex("Ch", "C")[2] == "C"
    assert comp.truth_complex(None, "M")[2] == "X"
    assert comp.truth_complex(None, "CX:")[2] == "C"
    assert comp.truth_complex("", "S")[1] == "Tholen"
    assert comp.truth_complex(None, None) == (None, None, None)


# ---------------------------------------------------------------------------- real objects


def _real_objects(n=40):
    paths = sorted((DATA / "objects").glob("*.json"))
    return [json.loads(p.read_text()) for p in paths[:n]]


@pytest.mark.skipif(not (DATA / "objects").exists(), reason="no published objects")
def test_real_objects_produce_valid_honest_compositions():
    for obj in _real_objects():
        doc = comp.compose(obj, DATA, "0.0.0+test", "2026-01-01T00:00:00Z")
        S.ObjectComposition.model_validate_json(doc.model_dump_json())
        assert doc.indicative_only is True
        assert doc.simulated == (obj["classification"] == "injected")
        texts = [
            doc.result_plain,
            doc.hydration.verdict_plain,
            doc.thermal.note_plain,
            doc.geometry.note_plain,
            *doc.caveats,
        ]
        if doc.taxonomy:
            texts += [doc.taxonomy.best_complex_plain, doc.taxonomy.confidence_plain]
            assert doc.result_plain.startswith("Its colors look most like")
        for t in texts:
            assert not FORBIDDEN.search(t), t
        # Every point traces to a published spectrum point; nothing is invented.
        src = {(p["epoch_id"], p["wavelength_um"]) for p in obj["spectrum"]["points"]}
        assert {(p.epoch_id, p.wavelength_um) for p in doc.points} <= {
            (e, round(w, 4)) for e, w in src
        }
        for p in doc.points:
            if p.use == "taxonomy":
                assert p.reflectance is not None and p.excluded_reason is None
            if p.thermal_fraction is not None and p.thermal_fraction > C.THERMAL_FRACTION_MAX:
                assert p.reflectance is None


@pytest.mark.skipif(not (DATA / "objects").exists(), reason="no published objects")
def test_validation_runs_with_a_truth_file(tmp_path):
    objs = _real_objects(12)
    (tmp_path / "objects").mkdir()
    for obj in objs:
        d = tmp_path / "objects" / obj["object_id"]
        d.mkdir()
        clones = DATA / "objects" / obj["object_id"] / "clones.json"
        if clones.exists():
            (d / "clones.json").write_text(clones.read_text())
        doc = comp.compose(obj, tmp_path, "0.0.0+test")
        (d / comp.COMPOSITION_FILE).write_text(doc.model_dump_json())
    # A truth file in the workflow's format (values here exercise the code path only).
    truth = {"query_utc": "2026-01-01T00:00:00Z", "n_identified": 2, "rows": [
        {"object_id": objs[0]["object_id"], "designation": "test-a", "spec_B": "S", "spec_T": None, "sbdb_url": "https://ssd.jpl.nasa.gov/"},
        {"object_id": objs[1]["object_id"], "designation": "test-b", "spec_B": None, "spec_T": None, "sbdb_url": "https://ssd.jpl.nasa.gov/"},
    ]}  # fmt: skip
    tp = tmp_path / "truth.json"
    tp.write_text(json.dumps(truth))
    v = comp.validate(tmp_path, "0.0.0+test", tp)
    S.CompositionValidation.model_validate_json(v.model_dump_json())
    assert v.n_objects == len(objs) and v.n_identified == 2 and v.n_with_taxonomy == 1
    assert v.n_compared <= 1
    assert [r.confidence for r in v.simulated_recovery] == ["high", "medium", "low", "all"]


def test_hydration_flat_continuum_with_few_short_side_points():
    wl = [0.9, 1.1, 2.45, 2.6, 2.8, 2.95]
    pts = []
    for i, w in enumerate(wl):
        refl = 0.9 if 2.7 <= w <= 3.1 else 1.0
        f = refl * C.solar_in_band(w - 0.02, w + 0.02) * w**2
        pts.append(C.Point(i, w, w - 0.02, w + 0.02, f"e{i:02d}", 60800 + i * 0.02, f, f * 0.01))
    geom = C.Geometry(
        "orbit_clones", np.ones(6), np.zeros(6), np.ones(6, bool), 60800.0, 3.0, 2.0, 5.0, 3.0
    )
    spec = C.reflectance(pts, geom)
    C.normalise(spec)
    h = C.hydration(spec)
    assert h.status == "measured" and h.continuum == "flat"
    assert h.band_depth == pytest.approx(0.10, abs=1e-6)
