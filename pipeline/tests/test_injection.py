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


def _published_field(out, fid, origin="run"):
    import json

    url = (
        "https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/qr2/level2/2025W17_4B/"
        "l2b-v20-2025-240/2/level2_2025W17_4B_0023_1D2_spx_l2b-v20-2025-240.fits"
    )
    (out / "fields").mkdir(parents=True, exist_ok=True)
    (out / "fields" / f"{fid}.json").write_text(
        json.dumps(
            {
                "name": f"tile {fid}",
                "blurb": "b",
                "center": {"ra_deg": 10.0, "dec_deg": -2.0},
                "size_deg": {"width": 0.3, "height": 0.3},
                "origin": origin,
                "epochs": [{"source": {"archive_url": url}}],
            }
        )
    )
    return {"field_id": fid, "origin": origin}


def test_survey_fields_come_from_the_published_tiles(tmp_path):
    import json

    from spherex_px.injection import published_keys, resolve_fields

    rows = [_published_field(tmp_path, f"sv-{i}") for i in range(6)]
    rows.append(_published_field(tmp_path, "aquarius-a", origin="showcase"))
    (tmp_path / "fields.json").write_text(json.dumps({"fields": rows}))
    specs = resolve_fields(tmp_path, survey=True)
    assert [s.field_id for s in specs] == [f"sv-{i}" for i in range(6)]
    assert specs[0].ra_deg == 10.0 and specs[0].size_deg == 0.3 and specs[0].origin == "run"
    assert [s.field_id for s in resolve_fields(tmp_path, survey=True, max_fields=3)] == [
        "sv-0",
        "sv-2",
        "sv-4",
    ]
    (k,) = published_keys(tmp_path, "sv-1")
    assert k.release == "qr2" and k.segment == "2025W17_4B" and k.detector == 2
    assert k.obs_id == "2025W17_4B_0023_1"


def test_shards_split_the_jobs_by_field():
    from spherex_px.build import FieldSpec
    from spherex_px.injection import plan_jobs

    specs = [FieldSpec(f"f{i}", "", "", 0.0, 0.0) for i in range(5)]
    jobs = plan_jobs(specs, 2, 1)
    assert jobs == plan_jobs(specs, 2, 1)  # fixed by the seed
    shards = [{j[1] for j in jobs if j[0] in {s.field_id for s in specs[k::2]}} for k in range(2)]
    assert shards[0].isdisjoint(shards[1]) and len(shards[0] | shards[1]) == len(jobs)


def test_index_lists_every_published_study_newest_first(tmp_path):
    import json

    from spherex_px.injection import write_index

    assert write_index(tmp_path) is None
    inj = tmp_path / "injection"
    inj.mkdir()
    for sid, t in (("old", "2026-01-01T00:00:00Z"), ("new", "2026-11-01T00:00:00Z")):
        (inj / f"{sid}.json").write_text(
            json.dumps(
                {
                    "study_id": sid,
                    "generated_utc": t,
                    "field_ids": ["f"],
                    "n_injected": 5,
                    "pipeline_version": f"v-{sid}",
                }
            )
        )
    index = write_index(tmp_path)
    assert [s.study_id for s in index.studies] == ["new", "old"]
    back = json.loads((inj / "index.json").read_text())
    assert [s["study_id"] for s in back["studies"]] == ["new", "old"]
