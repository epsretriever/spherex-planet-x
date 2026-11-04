from dataclasses import dataclass

import numpy as np
from astropy.wcs import WCS

from spherex_px.survey import _visits, plan_segment, tile_id


@dataclass
class FakeExposure:
    ra_center: float
    dec_center: float
    mjd_avg: float
    l2dqa: str = "Pass"

    def wcs(self):
        w = WCS(naxis=2)
        w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        w.wcs.crval = [self.ra_center, self.dec_center]
        w.wcs.crpix = [1020.5, 1020.5]
        w.wcs.cdelt = [-6.2 / 3600, 6.2 / 3600]
        return w


class FakeIndex:
    def __init__(self, exposures):
        self.exposures = exposures

    def index_segment(self, release, segment):
        pass

    def _rows(self, where, params):
        return iter(self.exposures)


def test_tile_ids_are_stable_and_url_safe():
    assert tile_id("2025W23_1C", 346.53, -1.2) == "sv-2025w231c-l3465-s012"
    assert tile_id("2025W23_1C", 359.97, 0.0) == "sv-2025w231c-l0000-n000"


def test_visits_split_on_hour_gaps():
    h = 1 / 24
    assert _visits([]) == 0
    assert _visits([0, 0.1 * h, 0.2 * h]) == 1
    assert _visits([0, 5 * h, 5.1 * h, 20 * h]) == 3


def test_plans_only_tiles_seen_in_several_visits():
    h = 1 / 24
    # One pointing on the ecliptic near lambda 346.5 (RA 347.6, Dec -5.1), imaged 4 times in each
    # of 3 visits; a bad-quality exposure is ignored.
    exps = [
        FakeExposure(347.6, -5.1, 60829 + v * 10 * h + k * 2 / 1440)
        for v in range(3)
        for k in range(4)
    ] + [FakeExposure(347.6, -5.1, 60830, l2dqa="Fail")]
    tiles = plan_segment(FakeIndex(exps), "qr2/2025W23_1C", beta_max_deg=1.0, step_deg=0.5)
    assert tiles
    assert all(t.n_exposures == 12 and t.n_visits == 3 for t in tiles)
    assert all(abs(t.elat_deg) <= 1.0 for t in tiles)
    assert len({t.field_id for t in tiles}) == len(tiles)
    assert {t.constellation for t in tiles} == {"Aquarius"}
    # Too few visits: nothing planned.
    assert plan_segment(FakeIndex(exps[:4]), "qr2/2025W23_1C", beta_max_deg=1.0, step_deg=0.5) == []
    lons = np.array([t.elon_deg for t in tiles])
    assert np.all((lons > 343) & (lons < 350))


class FakeArchive:
    def list(self, prefix):
        return [], ["qr2/", "qr3/", "docs/"]

    def level2_segments(self, release):
        return {"qr2": ["2025W20_1A", "2025W21_1A", "2025W22_1A"], "qr3": ["2025W40_1A"]}[release]


def test_auto_segments_spread_over_readable_releases():
    from spherex_px.survey import resolve_segments

    got = resolve_segments(["auto:3", "qr2/2025W23_1C"], FakeArchive())
    assert got == ["qr2/2025W20_1A", "qr2/2025W21_1A", "qr2/2025W22_1A", "qr2/2025W23_1C"]
    assert resolve_segments(["auto:2"], FakeArchive()) == ["qr2/2025W20_1A", "qr2/2025W22_1A"]


def test_selection_round_robins_across_weeks():
    from spherex_px.survey import PlannedTile, select_tiles

    def t(seg, i):
        return PlannedTile(f"{seg}-{i}", 0, 0, 0, 0.1 * i, seg, 10, 3, 20, "Aquarius")

    tiles = [t("a", i) for i in range(5)] + [t("b", i) for i in range(2)]
    picked = select_tiles(tiles, 4)
    assert [p.segment for p in picked] == ["a", "b", "a", "b"]


def test_dichroic_partner_does_not_inherit_file_size():
    from spherex_px.data.index import dichroic_partner
    from spherex_px.data.s3 import Level2Key

    k = Level2Key(
        "qr2/level2/W/v/2/level2_W_0001_1D2_spx_l2b-v.fits", "qr2", "W", "v", 2, "0001_1", 123
    )
    p = dichroic_partner(k)
    assert p.detector == 5 and "/5/level2_" in p.key and "D5_" in p.key
    assert p.size is None


def test_next_segments_skip_finished_and_spread_over_the_year():
    from spherex_px.survey import _spread_order, resolve_segments

    class Archive(FakeArchive):
        def level2_segments(self, release):
            return {"qr2": [f"2025W{w:02d}_1A" for w in range(20, 28)], "qr3": []}[release]

    assert sorted(_spread_order(8)) == list(range(8))
    assert _spread_order(8)[:2] == [0, 4]  # the first picks are far apart
    state = {
        "qr2/2025W20_1A": {"planned": 10, "searched": 10, "complete": True},
        "qr2/2025W24_1A": {"planned": 10, "searched": 4, "complete": False},
    }
    got = resolve_segments(["next:3"], Archive(), state)
    # The unfinished segment first, then fresh ones spread out; the finished one never.
    assert got[0] == "qr2/2025W24_1A"
    assert "qr2/2025W20_1A" not in got and len(got) == 3


def test_blocks_group_neighbours_and_are_never_split():
    from spherex_px.survey import PlannedTile, group_blocks, select_blocks

    def t(seg, i, j):
        return PlannedTile(f"{seg}-{i}-{j}", 0, 0, 0.3 * i, 0.3 * j, seg, 10, 3, 20, "Aquarius")

    tiles = [t("a", i, j) for i in range(8) for j in range(4)] + [t("b", 0, 0)]
    blocks = group_blocks(tiles, 4)
    assert sorted(len(b) for b in blocks) == [1, 16, 16]
    picked = select_blocks(tiles, 17)
    assert len(picked) == 17  # one whole block of a, then b's block
    assert {p.segment for p in picked} == {"a", "b"}


def test_plan_skips_tiles_already_searched(tmp_path, monkeypatch):
    import json

    from spherex_px import survey
    from spherex_px.survey import PlannedTile

    tiles = [
        PlannedTile(f"sv-x-{i}", 0, 0, 0.3 * i, 0, "qr2/2025W23_1C", 10, 3, 20, "Aquarius")
        for i in range(5)
    ]
    monkeypatch.setattr(survey, "plan_segment", lambda *a, **k: list(tiles))
    monkeypatch.setattr("spherex_px.data.index.CoverageIndex", lambda *a, **k: None)
    data = tmp_path / "data"
    (data / "survey").mkdir(parents=True)
    fp = {
        "tiles": [
            {
                "tile_id": "sv-x-0",
                "ra_deg": 0,
                "dec_deg": 0,
                "elon_deg": 0,
                "elat_deg": 0,
                "size_deg": 0.3,
                "segment": "qr2/2025W23_1C",
                "n_exposures": 10,
                "n_visits": 3,
                "first_utc": None,
                "last_utc": None,
                "status": "empty",
                "n_candidates": 0,
                "detail": None,
                "searched_utc": "x",
                "run_id": "r",
            },
            {
                "tile_id": "sv-x-1",
                "ra_deg": 0,
                "dec_deg": 0,
                "elon_deg": 0.3,
                "elat_deg": 0,
                "size_deg": 0.3,
                "segment": "qr2/2025W23_1C",
                "n_exposures": 10,
                "n_visits": 3,
                "first_utc": None,
                "last_utc": None,
                "status": "failed",
                "n_candidates": 0,
                "detail": "x",
                "searched_utc": "x",
                "run_id": "r",
            },
        ]
    }
    (data / "survey" / "footprint.json").write_text(json.dumps(fp))
    out = tmp_path / "plan.json"
    got = survey.plan(["qr2/2025W23_1C"], out, data_dir=data)
    # The empty tile is done; the failed one is retried.
    assert [t.field_id for t in got] == [f"sv-x-{i}" for i in range(1, 5)]
    meta = json.loads(survey.plan_meta_path(out).read_text())
    assert meta == {"qr2/2025W23_1C": {"planned": 5, "already_searched": 1}}
