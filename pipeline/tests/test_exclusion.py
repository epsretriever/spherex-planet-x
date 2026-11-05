import json
import math

import numpy as np
import pytest

from spherex_px import exclusion as E
from spherex_px.injection import planet_mag_ab
from spherex_px.science import brightness as B
from spherex_px.science.completeness import Grid, RateModel, at_mag, m50


class C:
    def __init__(self, mag, rate, frac):
        self.mag_ab, self.rate_arcsec_per_hr, self.fraction = mag, rate, frac


def toy_grid():
    # Two rates, three magnitudes; complete when bright and fast.
    cells = [
        C(15.0, 1.0, 0.0), C(16.0, 1.0, 0.0), C(17.0, 1.0, 0.0),
        C(15.0, 10.0, 0.9), C(16.0, 10.0, 0.6), C(17.0, 10.0, 0.1),
    ]  # fmt: skip
    return Grid.from_cells(cells, min_rate=0.5)


# --- brightness -------------------------------------------------------------------------


def test_reflected_light_matches_the_injection_studys_neptune_prediction():
    nep = B.Planet(B.NEPTUNE_DIAMETER_KM, 0.41)
    for r in (30.0, 300.0, 1000.0):
        # Flux at exactly 1.25 um, quadrature geometry vs the study's opposition geometry:
        refl, _ = B.flux_jy(nep, r, B.J_UM)
        geom = 5 * math.log10(math.sqrt(r * r - 1) / (r - 1))
        # 1329 km and V_sun = -26.76 agree to ~0.002 mag
        assert B.jy_to_ab(refl) == pytest.approx(planet_mag_ab(r) + geom, abs=0.005)


def test_flux_scales_with_diameter_squared_and_sunlight_with_distance():
    a, b = B.Planet(1000.0, 0.3), B.Planet(2000.0, 0.3)
    ma = [m.total_ab for m in B.band_mags(a, 2.0)]
    mb = [m.total_ab for m in B.band_mags(b, 2.0)]
    assert all(
        x - y == pytest.approx(5 * math.log10(2), abs=1e-9) for x, y in zip(ma, mb, strict=True)
    )
    # Reflected: 1/(r^2 Delta^2)
    r1, _ = B.flux_jy(a, 10.0, 1.0)
    r2, _ = B.flux_jy(a, 20.0, 1.0)
    assert r1 / r2 == pytest.approx((20**2 * (20**2 - 1)) / (10**2 * (10**2 - 1)))


def test_blackbody_thermal_is_negligible_for_a_cold_planet_but_not_a_warm_asteroid():
    cold = B.band_mags(B.Planet(B.NEPTUNE_DIAMETER_KM, 0.41, t_int_k=59.0), 300.0)
    assert all(m.thermal_ab > m.reflected_ab + 20 for m in cold)
    warm = B.band_mags(B.Planet(10.0, 0.05), 1.5)
    assert warm[-1].thermal_ab < warm[-1].reflected_ab  # dark NEO: thermal wins at 4.7 um
    assert warm[0].thermal_ab > warm[0].reflected_ab + 10


def test_temperature_and_planck_limits():
    assert B.temperature_k(1.0, 0.0) == pytest.approx(B.T_EQ_1AU_K)
    assert B.temperature_k(4.0, 0.0) == pytest.approx(B.T_EQ_1AU_K / 2)
    assert B.temperature_k(500.0, 0.4, 47.0) == pytest.approx(47.0, abs=0.1)
    assert B.planck_nu(4.7, 2.0) == 0.0  # Wien exponent underflows
    assert B.planck_nu(1.0, 0.0) == 0.0
    with pytest.raises(ValueError):
        B.observer_distance_au(1.0)


def test_six_spherex_detectors_from_the_calibration_table():
    bands = B.spherex_bands()
    assert [b.detector for b in bands] == [1, 2, 3, 4, 5, 6]
    assert bands[0].wl_min_um < 0.76 and bands[-1].wl_max_um > 4.99
    assert all(len(b.channels_um) == 17 for b in bands)


# --- completeness -----------------------------------------------------------------------


def test_completeness_rules_outside_and_inside_the_grid():
    g = toy_grid()
    assert g.fraction(15.0, 0.3) == (0.0, "below_linker_minimum")
    assert g.fraction(15.0, 200.0) == (None, "faster_than_study")
    # log-rate midpoint of 1 and 10 is sqrt(10)
    f, why = g.fraction(15.0, math.sqrt(10))
    assert why == "measured" and f == pytest.approx(0.45)
    assert g.fraction(12.0, 10.0) == (0.9, "measured")  # brighter, already >= 50%
    assert g.fraction(12.0, math.sqrt(10)) == (None, "brighter_than_study")
    assert g.fraction(19.0, 10.0) == (0.1, "measured")  # fainter, already < 50%
    assert g.m50(10.0) == pytest.approx(16.2)
    assert at_mag([1.0, 2.0], [0.9, 0.8], 3.0) == (None, "fainter_than_study")
    assert m50([1.0, 2.0], [0.4, 0.1]) is None


def test_rate_model_interpolates_in_log_log_and_inverts():
    rm = RateModel(distances=(2.0, 20.0, 200.0), rates=(50.0, 5.0, 0.5))
    assert rm.rate(20.0) == pytest.approx(5.0)
    assert rm.rate(math.sqrt(40)) == pytest.approx(math.sqrt(250))
    assert rm.rate(2000.0) == pytest.approx(0.05)  # last power law continues
    assert rm.rate(1.0) is None
    assert rm.distance_at(5.0) == pytest.approx(20.0)
    assert rm.distance_at(500.0) is None


def test_min_diameter_lands_exactly_on_fifty_percent():
    g = toy_grid()
    rm = RateModel(distances=(2.0, 100.0), rates=(10.0, 10.0 / 50))
    d = 2.0
    dmin, why = E.min_diameter_km(g, rm, d, 0.3, 0.0)
    assert why == "measured"
    res = E.planet_completeness(g, rm, B.Planet(dmin, 0.3), d)
    assert res["cons"] == pytest.approx(0.5, abs=1e-6)
    assert max(m.total_ab for m in res["mags"]) == pytest.approx(16.2, abs=1e-6)
    # Too slow: no size is enough
    assert E.min_diameter_km(g, rm, 90.0, 0.3, 0.0) == (None, "below_linker_minimum")


def test_conservative_uses_faintest_band_and_optimistic_brightest():
    g = toy_grid()
    rm = RateModel(distances=(2.0, 100.0), rates=(10.0, 0.2))
    res = E.planet_completeness(g, rm, B.Planet(300.0, 0.05), 2.0)
    mags = [m.total_ab for m in res["mags"]]
    assert res["cons"] == pytest.approx(g.fraction(max(mags), 10.0)[0])
    assert res["opt"] == pytest.approx(g.fraction(min(mags), 10.0)[0])
    assert res["cons"] <= res["opt"]


# --- sky geometry -----------------------------------------------------------------------


def test_region_weight_of_a_fully_tiled_cell_is_its_fraction():
    p9 = {"cell_deg": 5.0, "cells": [{"ra_deg": 2.5, "dec_deg": 2.5, "fraction": 0.2}]}
    step = E.PATCH_DEG
    total, n = 0.0, 0
    for i in range(int(5 / step) + 1):
        for j in range(int(5 / step) + 1):
            ra, dec = (i + 0.5) * step, (j + 0.5) * step
            if ra < 5 and dec < 5:
                total += E.region_weight(p9, ra, dec)
                n += 1
    # 17 x 17 patches of 0.09 deg2 cover 26.01 deg2 (overlapping the edge) of 24.98 deg2.
    area = E._cell_area_deg2(2.5, 5.0)
    assert n == 17 * 17
    assert total == pytest.approx(0.2 * n * 0.09 / area)
    assert E.region_weight(p9, 100.0, 2.5) == 0.0


def test_points_inside_patches_wrap_at_ra_zero():
    patches = [(0.05, 0.0), (180.0, 60.0)]
    ra = np.array([359.95, 0.25, 180.25, 180.0])
    dec = np.array([0.1, 0.0, 60.0, 60.2])
    # RA offsets shrink by cos(dec): 0.25 deg of RA at dec 60 is 0.125 deg on the sky.
    assert E.in_patches(patches, ra, dec).tolist() == [True, False, True, False]


def _write_out(tmp_path):
    study = json.loads(
        (
            E.Path(__file__).parents[2] / "frontend/public/data/injection/aquarius-2025w23.json"
        ).read_text()
    )
    (tmp_path / "injection").mkdir()
    (tmp_path / "injection" / "index.json").write_text(
        json.dumps({"studies": [{"study_id": study["study_id"]}]})
    )
    (tmp_path / "injection" / f"{study['study_id']}.json").write_text(json.dumps(study))
    tile = {
        "tile_id": "aquarius-a",
        "center": {"ra_deg": 346.53, "dec_deg": -6.384},
        "ecliptic_lon_deg": 345.13,
        "ecliptic_lat_deg": -0.57,
        "status": "processed",
        "m50_ab": 17.32,
    }
    sv = dict(tile, tile_id="sv-x", center={"ra_deg": 10.0, "dec_deg": 4.0}, m50_ab=None)
    sv["ecliptic_lon_deg"], sv["ecliptic_lat_deg"] = 10.6, -0.3
    sv2 = dict(sv, tile_id="sv-y")  # same grid point another week: one patch
    failed = dict(sv, tile_id="sv-z", status="failed", ecliptic_lon_deg=50.0)
    survey = {
        "generated_utc": "2026-01-01T00:00:00Z",
        "tiles": [tile, sv, sv2, failed],
        "empty_cells": {"size_deg": 0.3, "n_tiles": 2, "positions": [[20.0, 8.0], [40.0, 15.0]]},
        "totals": {"n_failed": 1},
        "planet_nine": {
            "citation": "Brown & Batygin 2021",
            "url": "https://data.caltech.edu/records/8fjad-x7y61",
            "cell_deg": 5.0,
            "n_population": 10,
            "n_remaining": 4,
            "cells": [{"ra_deg": 22.5, "dec_deg": 7.5, "fraction": 1.0}],
        },
    }
    (tmp_path / "survey.json").write_text(json.dumps(survey))
    return study


def test_build_counts_patches_and_reports_the_motion_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(E, "pipeline_version", lambda require_clean: "0.1.0+git.test")
    _write_out(tmp_path)
    pop = {
        "ra": np.array([20.0, 20.1, 200.0, 40.0]),
        "dec": np.array([8.0, 8.05, 0.0, 15.0]),
        "R": np.array([500.0, 300.0, 700.0, 4.0]),
        "rad": np.array([3.0, 4.0, 3.5, 3.0]),
        "albedo": np.array([0.5, 0.5, 0.5, 0.5]),
        "V": np.array([22.0, 21.0, 23.0, 5.0]),
        "ZTF": np.array([0, 0, 0, 1]),
        "DES": np.zeros(4),
        "PS1": np.zeros(4),
    }
    doc = E.build(tmp_path, pop)
    assert doc.survey.n_patches_searched == 4  # sv-x/sv-y merge, failed excluded, 2 empty
    assert doc.survey.area_deg2_searched == pytest.approx(0.36)
    assert [t.tile_id for t in doc.measured_tiles] == ["aquarius-a"]
    assert doc.reach_summary.d_linker_limit_au == pytest.approx(52.5, abs=1)
    assert doc.reach_summary.d_max_any_au == 30.0
    assert all(r.testable == "no" for r in doc.reach if r.distance_au >= 100)
    p = doc.planet_nine.population
    assert (p.n_open, p.n_open_in_searched) == (3, 2)
    assert p.n_faster_than_linker_minimum == 0
    assert p.expected_recovered == 0.0 and p.fraction_excluded == 0.0
    # one empty patch sits in the only Planet Nine cell
    assert doc.planet_nine.region_fraction_in_searched == pytest.approx(
        0.09 / E._cell_area_deg2(7.5, 5.0), rel=1e-4
    )
    # Consistency rows are the study's distance tracks, one per (distance, magnitude)
    assert len(doc.consistency) == 7 * 9
