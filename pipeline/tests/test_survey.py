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
