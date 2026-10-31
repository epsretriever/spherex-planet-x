import numpy as np
import pytest

from spherex_px.injection import m50, poisson_ci, wilson
from spherex_px.science.inject import (
    ab_to_ujy,
    native_kernel,
    observer_au,
    parallax_track,
    track_rate,
)


def gaussian_psf(n=101, oversample=10, fwhm_native=0.85):
    s = fwhm_native * oversample / 2.355
    yy, xx = np.mgrid[0:n, 0:n] - n // 2
    return np.exp(-(xx**2 + yy**2) / (2 * s * s))


@pytest.mark.parametrize("fx,fy", [(0.0, 0.0), (0.3, -0.2), (-0.45, 0.45)])
def test_native_kernel_conserves_flux_and_centers_the_source(fx, fy):
    k = native_kernel(gaussian_psf(), 10, fx, fy)
    assert k.sum() == pytest.approx(1.0, abs=0.01)
    yy, xx = np.mgrid[0 : k.shape[0], 0 : k.shape[1]]
    cx, cy = (k * xx).sum() / k.sum(), (k * yy).sum() / k.sum()
    assert cx == pytest.approx(5 + fx, abs=0.05)
    assert cy == pytest.approx(5 + fy, abs=0.05)


def test_ab_zero_point():
    assert ab_to_ujy(23.9) == pytest.approx(1.0)
    assert ab_to_ujy(16.4) == pytest.approx(1000.0, rel=1e-3)


def test_wilson_and_poisson_intervals():
    lo, hi = wilson(50, 100)
    assert lo == pytest.approx(0.404, abs=0.002) and hi == pytest.approx(0.596, abs=0.002)
    assert wilson(0, 0) == (0.0, 1.0)
    lo, hi = poisson_ci(0)
    assert lo == 0.0 and hi == pytest.approx(3.689, abs=0.01)


def test_m50_interpolates_and_reports_unbracketed_as_none():
    assert m50([16, 17, 18], [1.0, 0.6, 0.2]) == pytest.approx(17.25)
    assert m50([16, 17], [0.9, 0.8]) is None
    assert m50([16, 17], [0.3, 0.1]) is None


def test_parallax_tracks_slow_down_with_distance():
    # A two-day SPHEREx visit in June 2025 toward Aquarius (spacecraft offsets from real headers).
    mjds = [60828.93, 60829.81, 60830.29, 60831.04]
    sc = np.array([-5841.8, 1612.7, 3573.3])
    obs = [(t, observer_au(t, sc)) for t in mjds]
    rates = []
    for d in (5.0, 30.0, 300.0):
        pos = parallax_track(346.53, -6.38, mjds[1], d, obs[1][1], obs)
        rates.append(track_rate(mjds, pos))
    assert rates[0] > rates[1] > rates[2] > 0
    # near quadrature Earth moves mostly along the line of sight, so motion is slow but nonzero
    assert 5 < rates[0] < 40
    assert rates[2] < 0.2


def test_planet_mag_matches_neptune_at_its_distance():
    from spherex_px.injection import SOLAR_V_MINUS_J_AB, planet_mag_ab

    # Neptune at opposition (30.1 AU from the Sun) is V ~ 7.7-7.8.
    v = planet_mag_ab(30.1) + SOLAR_V_MINUS_J_AB
    assert 7.5 < v < 8.0
    assert planet_mag_ab(1000.0) > planet_mag_ab(500.0) > planet_mag_ab(100.0)


def test_fraction_at_only_extrapolates_when_implied():
    from spherex_px.injection import fraction_at

    assert fraction_at([15, 16, 17], [0.9, 0.6, 0.2], 16.5) == pytest.approx(0.4)
    assert fraction_at([15, 16], [0.9, 0.6], 14) == 0.9  # brighter than a bin already found
    assert fraction_at([15, 16], [0.4, 0.2], 21) == 0.2  # fainter than a bin already missed
    assert fraction_at([15, 16], [0.9, 0.6], 21) is None  # fainter than tested, unknown
    assert fraction_at([], [], 18) is None


def test_checkpoint_round_trip_skips_truncated_lines(tmp_path):
    import json
    from dataclasses import asdict

    from spherex_px.injection import RunResult, Trial, load_checkpoint

    r = RunResult(
        trials=[Trial("f", 3, "f-r3-i0", 17.0, "linear", 3.0, 90.0, None, 3, True, 3, 3.1, 0.4)],
        false_positive_tracks=1,
        seconds=6.5,
    )
    p = tmp_path / "c.jsonl"
    p.write_text(json.dumps(asdict(r)) + "\n" + '{"trials": [')
    back = load_checkpoint(p)
    assert len(back) == 1 and back[0].trials[0].run == 3 and back[0].false_positive_tracks == 1
