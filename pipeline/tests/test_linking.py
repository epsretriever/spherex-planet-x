from pathlib import Path

import numpy as np
import pytest

from spherex_px import schemas as S
from spherex_px.linking import (
    _shifted,
    _split,
    joint_ok,
    link,
    merged_detections,
    n_visits,
    plausible_pair,
    shares_detections,
)
from spherex_px.science import orbit as O

DATA = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data" / "candidates"


@pytest.fixture
def cand():
    p = DATA / "aquarius-b-c01.json"
    if not p.exists():
        pytest.skip("published data not present")
    return S.CandidateDetail.model_validate_json(p.read_text())


def test_shared_detections_are_merged_once(cand):
    a, b = cand.detections[:12], cand.detections[8:]
    assert shares_detections(a, b)
    merged = merged_detections([a, b])
    assert len(merged) == len(cand.detections)
    assert [d.mjd for d in merged] == sorted(d.mjd for d in cand.detections)
    assert not shares_detections(a[:4], _shifted(b, 30.0, 45.0))


def test_visits_and_pair_pruning(cand):
    assert n_visits(cand.detections) >= 3
    a, b = _split(cand.detections)
    assert len(a) >= 3 and len(b) >= 3 and a[-1].mjd < b[0].mjd
    assert n_visits(a) >= 2 and n_visits(b) >= 2  # the split keeps visits on both sides
    assert plausible_pair(a, b)
    far = _shifted(b, 5 * 3600.0, 90.0)  # 5 degrees away within a day: not the same body
    assert not plausible_pair(a, far)


def test_links_a_split_track_and_rejects_a_parallel_decoy(cand):
    a, b = _split(cand.detections)
    ca = cand.model_copy(update={"candidate_id": "tile-a-c01", "detections": a})
    cb = cand.model_copy(update={"candidate_id": "tile-b-c01", "detections": b})
    cd = cand.model_copy(
        update={"candidate_id": "tile-c-c01", "detections": _shifted(b, 600.0, 30.0)}
    )
    fits = {
        c.candidate_id: O.fit_orbit(
            O.Observations.from_detections(c.detections),
            rng=np.random.default_rng(0),
            n_samples=20_000,
        )
        for c in (ca, cb, cd)
    }
    groups, links = link([ca, cb, cd], fits)
    assert sorted(map(sorted, groups)) == [["tile-a-c01", "tile-b-c01"], ["tile-c-c01"]]
    assert [lk.method for lk in links] == ["orbit"]
    assert links[0].joint_rms_arcsec < 1.5


def test_single_visit_tracklets_link_only_by_shared_detections(cand):
    one = [d for d in cand.detections if d.mjd - cand.detections[0].mjd < 0.02]
    assert n_visits(one) == 1
    later = cand.detections[-6:]
    ca = cand.model_copy(update={"candidate_id": "x-c01", "detections": one})
    cb = cand.model_copy(update={"candidate_id": "y-c01", "detections": later})
    groups, links = link([ca, cb], {})
    assert len(groups) == 2 and links == []


def test_joint_fit_rejects_inconsistent_tracklets(cand):
    a, b = _split(cand.detections)
    fit = O.fit_orbit(
        O.Observations.from_detections(merged_detections([a, _shifted(b, 3600.0, 0.0)])),
        rng=np.random.default_rng(0),
        n_samples=20_000,
    )
    assert not joint_ok(fit)  # returns an orbit or None, never raises
