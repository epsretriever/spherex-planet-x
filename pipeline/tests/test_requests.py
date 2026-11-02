from types import SimpleNamespace

from spherex_px import requests as R


class FakeIndex:
    """CoverageIndex stand-in: two nearby segments, one seen in 3 visits, one in 1."""

    def __init__(self):
        self.indexed = []

    def index_coarse(self, release):
        pass

    def _rows(self, where="", params=()):
        def exp(seg, ra, dec, mjd):
            key = SimpleNamespace(release="qr2", segment=seg)
            return SimpleNamespace(key=key, ra_center=ra, dec_center=dec, mjd_avg=mjd, l2dqa="Pass")

        return iter(
            [
                exp("2025W17_4B", 20.0, 12.0, 0),
                exp("2026W29_2A", 21.0, 12.5, 0),
                exp("2025W01_1A", 200.0, -40.0, 0),
            ]
        )

    def index_segment(self, release, seg):
        self.indexed.append(seg)

    def covering(self, ra, dec, edge_px=0, segments=None):
        seg = segments[0]
        mk = lambda m: SimpleNamespace(mjd_avg=m, l2dqa="Pass")  # noqa: E731
        if seg == "2026W29_2A":  # 9 exposures in 3 visits a day apart
            return [mk(61238 + d + i * 0.001) for d in (0, 1, 2) for i in range(3)]
        return [mk(61000 + i * 0.001) for i in range(9)]  # 9 exposures, 1 visit


def test_picks_the_week_with_the_most_visits_and_ignores_far_segments():
    idx = FakeIndex()
    seg, n, v, compared = R.best_segment(idx, 21.0, 12.2)
    assert seg == "qr2/2026W29_2A" and (n, v) == (9, 3)
    assert set(idx.indexed) == {"2025W17_4B", "2026W29_2A"}  # the far segment is never indexed
    assert len(compared) == 2


def test_reports_no_coverage_with_the_reason(tmp_path):
    class OneVisit(FakeIndex):
        def covering(self, ra, dec, edge_px=0, segments=None):
            return [SimpleNamespace(mjd_avg=61000 + i * 0.001, l2dqa="Pass") for i in range(9)]

    r = R.build_request("req-0123456789abcdef", 21.0, 12.2, tmp_path, index=OneVisit())
    assert r.status == "no_coverage" and r.field_id is None
    assert "1 visits" in r.message and "at least 8 times in 3 visits" in r.message


def test_field_ids_follow_the_request():
    assert R.field_id_for("req-0123456789abcdef") == "rq-0123456789ab"
