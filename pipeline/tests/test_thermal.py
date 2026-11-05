"""Thermal sizes: solar spectrum, geometry, NEATM and the reflected/thermal fit."""

from __future__ import annotations

import math

import numpy as np
import pytest

from spherex_px.science import geometry as G
from spherex_px.science import solar_spectrum as SS
from spherex_px.science import thermal as T
from spherex_px.thermal import albedo_plain, parse_horizons_geometry, parse_sbdb

# ----------------------------------------------------------------------------- solar spectrum


def test_solar_spectrum_matches_the_sun_in_v():
    # The Sun's AB magnitude at 0.55 um is about -26.8 (V_sun = -26.76).
    fnu_jy = SS.solar_fnu_ujy(0.55) * 1e-6
    assert -2.5 * math.log10(fnu_jy / 3631) == pytest.approx(-26.78, abs=0.06)


def test_solar_spectrum_inverse_square_and_band_average():
    f1 = SS.solar_fnu_ujy(np.array([1.0, 4.5]), 0.03)
    f2 = SS.solar_fnu_ujy(np.array([1.0, 4.5]), 0.03, r_au=2.0)
    assert np.allclose(f2, f1 / 4)
    # F_nu falls with wavelength past the peak: about lambda^-2 at 2-5 um (Rayleigh-Jeans-like).
    ratio = SS.solar_fnu_ujy(2.0) / SS.solar_fnu_ujy(4.0)
    assert 3.0 < ratio < 5.0
    with pytest.raises(ValueError):
        SS.solar_fnu_ujy(6.0)


# ----------------------------------------------------------------------------- geometry


def test_geometry_from_vectors():
    obj = np.array([2.0, 0.0, 0.0])
    obs = np.array([1.0, 1.0, 0.0])  # Earth-like observer 90 deg from the object's direction
    r, d, a = G.from_vectors(obj, obs)
    assert r == pytest.approx(2.0)
    assert d == pytest.approx(math.sqrt(2))
    assert a == pytest.approx(45.0)


def test_geometry_from_elements_is_on_the_orbit():
    # Circular orbit at 2.5 AU: r stays 2.5 AU whatever the time.
    g = G.from_elements([2.5, 0.0, 0.0, 0.0, 0.0, 10.0], 60800.0, [60800.0, 60801.0], None, "x")
    assert np.allclose(g.r_au, 2.5, atol=1e-6)
    assert np.all((g.delta_au > 1.4) & (g.delta_au < 3.6))
    assert np.all(g.alpha_deg < 25)


# ----------------------------------------------------------------------------- NEATM


@pytest.mark.parametrize("x0,alpha", [(2.0, 0.0), (10.0, 20.0), (30.0, 60.0), (5.0, 100.0)])
def test_neatm_table_matches_direct_integration(x0, alpha):
    exact = T._neatm_integral_exact(x0, math.radians(alpha))
    assert float(T.neatm_integral(x0, alpha)) == pytest.approx(exact, rel=3e-3)


def test_neatm_conserves_energy_at_zero_phase():
    # Integrated over frequency, the day side seen face-on emits (2/3) eps sigma T^4 R^2 / delta^2.
    t_ss, d_km, delta = 300.0, 10.0, 1.0
    lam = np.geomspace(0.5, 500, 4000)
    f = T.neatm_fnu_ujy(lam, d_km, t_ss, delta, 0.0) * T.UJY
    nu = T.C_M_S / (lam * 1e-6)
    bol = -np.trapezoid(f, nu)
    radius = d_km * 500
    expected = (2 / 3) * T.EMISSIVITY * T.SIGMA_SB * t_ss**4 * radius**2 / (delta * T.AU_M) ** 2
    assert bol == pytest.approx(expected, rel=5e-3)


def test_subsolar_temperature_and_size_albedo_relation():
    # A black body at 1 AU with eta = 1: T_ss = ((1-A) S / (eta eps sigma))^(1/4) ~ 404 K.
    t = T.subsolar_temperature(1.0, 0.0, 1.0)
    assert 400 < t < 408
    assert T.subsolar_temperature(4.0, 0.0, 1.0) == pytest.approx(t / 2)
    # D = 1329 / sqrt(pv) 10^(-H/5): H = 15, pv = 0.1 -> 4.2 km; and the inverse.
    assert float(T.d_from_albedo(0.1, 15.0)) == pytest.approx(4.20, abs=0.01)
    assert float(T.albedo_from_d(4.2026, 15.0)) == pytest.approx(0.1, rel=1e-3)
    # H from the reflected-light product p_V (R / AU)^2 is the same relation.
    d, pv = 10.0, 0.08
    rho = pv * (d / 2 / T.AU_KM) ** 2
    h = float(T.h_from_reflectance(rho))
    assert float(T.d_from_albedo(pv, h)) == pytest.approx(d, rel=1e-6)


def test_hg_phase_function():
    assert float(T.phase_hg(0.0, 0.15)) == pytest.approx(1.0)
    assert float(T.phase_hg(20.0, 0.15)) < float(T.phase_hg(10.0, 0.15)) < 1
    assert float(T.phase_integral(0.15)) == pytest.approx(0.3926)


# ----------------------------------------------------------------------------- the fit


def _synthetic(d_km, pv, h_true, r=2.5, delta=2.3, alpha=23.0, eta=1.0, err_frac=0.03, seed=1):
    """A simulated asteroid seen in SPHEREx-like channels (for this test only)."""
    rng = np.random.default_rng(seed)
    lam = np.concatenate([np.linspace(0.8, 2.4, 16), np.linspace(3.5, 4.9, 12)])
    bw = lam / 41
    # Reflectance 1.15 x the V-band value at 0.8 um, slightly red beyond (a typical colour).
    rho = pv * (d_km / 2 / T.AU_KM) ** 2 * (1.15 + 0.05 * (lam - 0.8))
    refl = rho * SS.solar_fnu_ujy(lam, bw) * T.phase_hg(alpha, 0.15) / (r**2 * delta**2)
    tss = T.subsolar_temperature(r, T.phase_integral(0.15) * pv, eta)
    heat = T.neatm_fnu_ujy(lam, d_km, tss, delta, alpha)
    truth = refl + heat
    err = err_frac * truth + 5.0
    flux = truth + rng.standard_normal(len(lam)) * err
    pts = [
        T.Point(float(w), float(b), float(f), float(e), i, 0)
        for i, (w, b, f, e) in enumerate(zip(lam, bw, flux, err, strict=True))
    ]
    return pts, G.fixed([r], [delta], [alpha], "jpl_horizons"), heat, refl


def test_fit_recovers_size_and_albedo_with_known_h():
    d_true, pv_true = 20.0, 0.06
    h_true = 5 * math.log10(T.D_CONST_KM / (d_true * math.sqrt(pv_true)))
    pts, geo, heat, refl = _synthetic(d_true, pv_true, h_true)
    assert heat[-1] > 2 * refl[-1]  # dark main-belt asteroid: heat dominates at 4.9 um
    res = T.fit(pts, geo, T.HPrior(h=h_true, source="jpl_sbdb"), n_mc=200, seed=3)
    assert res.status == "sized"
    assert res.n_significant_bands >= 2
    assert res.diameter_lo_km < d_true < res.diameter_hi_km
    assert res.diameter_km == pytest.approx(d_true, rel=0.25)
    assert res.albedo_lo < pv_true < res.albedo_hi
    assert res.h_source == "jpl_sbdb"
    assert (
        len(res.model_wavelength_um) == len(res.model_thermal_ujy) == len(res.model_reflected_ujy)
    )


def test_fit_estimates_h_from_reflected_light_when_jpl_has_none():
    d_true, pv_true = 20.0, 0.06
    h_true = 5 * math.log10(T.D_CONST_KM / (d_true * math.sqrt(pv_true)))
    pts, geo, *_ = _synthetic(d_true, pv_true, h_true)
    res = T.fit(pts, geo, T.HPrior(h=None), n_mc=200, seed=4)
    assert res.h_source == "spherex_reflectance"
    assert res.h == pytest.approx(h_true, abs=0.3)
    assert res.status == "sized"
    assert res.diameter_lo_km < d_true < res.diameter_hi_km


def test_fitted_eta_is_recovered_on_clean_data():
    d_true, pv_true, eta_true = 15.0, 0.05, 1.3
    h_true = 5 * math.log10(T.D_CONST_KM / (d_true * math.sqrt(pv_true)))
    pts, geo, *_ = _synthetic(d_true, pv_true, h_true, eta=eta_true, err_frac=0.01)
    res = T.fit(pts, geo, T.HPrior(h=h_true, source="jpl_sbdb"), n_mc=60, seed=5, fit_eta=True)
    assert res.eta_mode == "fitted"
    assert res.eta == pytest.approx(eta_true, abs=0.35)


def test_cold_object_gets_an_upper_limit_not_a_size():
    # A bright, distant body: at 5 AU its heat at 3.5-4.9 um is far below the reflected light.
    d_true, pv_true = 30.0, 0.25
    h_true = 5 * math.log10(T.D_CONST_KM / (d_true * math.sqrt(pv_true)))
    pts, geo, heat, refl = _synthetic(d_true, pv_true, h_true, r=5.2, delta=5.0, alpha=10.0)
    assert heat.max() < 0.2 * refl[-1]
    res = T.fit(pts, geo, T.HPrior(h=h_true, source="jpl_sbdb"), n_mc=100, seed=6)
    assert res.status == "upper_limit"
    assert res.diameter_km is None
    assert res.diameter_upper_limit_km > d_true


def test_no_short_wavelengths_means_not_sizable():
    pts, geo, *_ = _synthetic(20.0, 0.06, 12.0)
    long_only = [p for p in pts if p.wavelength_um > 3]
    res = T.fit(long_only, geo, T.HPrior(h=12.0), n_mc=10)
    assert res.status == "not_sizable"
    assert "reflected" in res.reason


def test_fit_is_deterministic_for_a_seed():
    pts, geo, *_ = _synthetic(20.0, 0.06, 11.8)
    a = T.fit(pts, geo, T.HPrior(h=None), n_mc=50, seed=9)
    b = T.fit(pts, geo, T.HPrior(h=None), n_mc=50, seed=9)
    assert a.diameter_km == b.diameter_km


# ----------------------------------------------------------------------------- JPL parsing


def test_parse_sbdb_reads_physical_parameters_and_orbit():
    body = {
        "object": {"fullname": "1 Ceres (A801 AA)"},
        "phys_par": [
            {"name": "H", "value": "3.34"},
            {"name": "G", "value": "0.12"},
            {"name": "diameter", "value": "939.4", "sigma": "0.2", "ref": "Park et al. 2019"},
            {"name": "albedo", "value": "0.090", "sigma": "0.0033"},
        ],
        "orbit": {
            "epoch": "2461000.5",
            "elements": [
                {"name": n, "value": v}
                for n, v in [
                    ("a", "2.77"),
                    ("e", "0.079"),
                    ("i", "10.6"),
                    ("om", "80.3"),
                    ("w", "73.4"),
                    ("ma", "200"),
                ]
            ],
        },
    }
    s = parse_sbdb(body)
    assert s["h"] == 3.34 and s["g"] == 0.12
    assert s["diameter_km"] == 939.4 and s["diameter_sigma_km"] == 0.2
    assert s["albedo"] == 0.09 and s["diameter_ref"] == "Park et al. 2019"
    assert s["elements"]["a"] == 2.77 and s["epoch_jd"] == 2461000.5
    assert parse_sbdb({})["diameter_km"] is None


def test_parse_horizons_geometry_reads_columns_by_name():
    text = (
        "header\n"
        " Date_________JDUT, , , r, rdot, delta, deldot, S-T-O,\n"
        "*****\n$$SOE\n"
        " 2460829.833, , , 2.5123, 1.2, 2.2011, -3.1, 23.456,\n"
        " 2460830.833, , , 2.5130, 1.2, 2.1990, -3.0, 23.401,\n"
        "$$EOE\n"
    )
    rows = parse_horizons_geometry({"result": text})
    assert rows == [(2460829.833, 2.5123, 2.2011, 23.456), (2460830.833, 2.513, 2.199, 23.401)]
    assert parse_horizons_geometry({"result": "no ephemeris"}) == []


def test_albedo_in_words():
    assert albedo_plain(0.05).startswith("Dark")
    assert albedo_plain(0.12).startswith("Medium")
    assert albedo_plain(0.3).startswith("Bright")
    assert albedo_plain(None) is None


# ----------------------------------------------------------------------------- published objects


def _showcase():
    from pathlib import Path

    from spherex_px import schemas as S
    from spherex_px.orbits import OrbitRecord, orbit_path

    out = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data"
    o = S.ObjectDetail.model_validate_json(
        (out / "objects" / "obj-aquarius-b-c01.json").read_text()
    )
    p = orbit_path(out, o.candidate_ids[0])
    return o, OrbitRecord.model_validate_json(p.read_text())


def test_thermal_block_for_a_published_object():
    from spherex_px.schemas_thermal import ThermalFit
    from spherex_px.thermal import thermal_for

    o, orbit = _showcase()
    t = thermal_for(o, orbit, None, n_mc=60)
    ThermalFit.model_validate(t.model_dump())
    assert t.status in ("sized", "upper_limit")
    assert t.geometry_source == "orbit_clones"
    assert t.h_source == "spherex_reflectance"
    assert t.points and all(p.wavelength_um >= T.THERMAL_MIN_UM for p in t.points)
    assert t.model and len(t.model.wavelength_um) == len(t.model.thermal_ujy)
    assert any("orbit" in c for c in t.caveats)
    # Deterministic: the same object gives the same answer on every publish.
    assert thermal_for(o, orbit, None, n_mc=60).diameter_km == t.diameter_km


def test_validation_compares_with_jpl_diameters():
    from spherex_px.thermal import JplInput, JplInputs, thermal_for, validation_doc

    o, orbit = _showcase()
    elements = list(orbit.elements)
    jpl = JplInput(
        designation="(test object)",
        fetched_utc="2026-11-05T00:00:00Z",
        sbdb={
            "h": 11.7,
            "g": 0.15,
            "diameter_km": 20.0,
            "diameter_sigma_km": 1.0,
            "albedo": 0.07,
            "albedo_sigma": 0.01,
            "diameter_ref": "test",
            "elements": dict(zip(["a", "e", "i", "om", "w", "ma"], elements, strict=True)),
            "epoch_jd": orbit.epoch_tdb + 2400000.5,
        },
    )
    o.thermal = thermal_for(o, orbit, jpl, n_mc=60)
    assert o.thermal.geometry_source == "jpl_elements"
    assert o.thermal.h_source == "jpl_sbdb" and o.thermal.h == 11.7
    assert o.thermal.jpl and o.thermal.jpl.diameter_km == 20.0
    doc = validation_doc(
        [o], JplInputs(generated_utc="x", source="x", objects={o.object_id: jpl}), "v", "now"
    )
    assert doc.n_identified == 1 and doc.n_with_jpl_diameter == 1
    if o.thermal.status == "sized":
        assert doc.n_compared == 1
        assert doc.median_ratio == pytest.approx(o.thermal.diameter_km / 20.0, rel=1e-2)
    empty = validation_doc([o], None, "v", "now")
    assert (
        empty.n_compared == 0 and empty.median_ratio is None and "No comparison yet" in empty.note
    )
