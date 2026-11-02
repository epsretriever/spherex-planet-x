import json

from spherex_px import schemas as S
from spherex_px.carry import carry_jpl_checks
from spherex_px.contract import FIXTURE_DIR


def _write(d, name, cand):
    d.mkdir(exist_ok=True)
    (d / f"{name}.json").write_text(json.dumps(cand))


def test_checks_carry_over_only_for_identical_detections(tmp_path):
    base = json.loads((FIXTURE_DIR / "candidate_detail.json").read_text())
    base["classification"] = "unmatched"
    checked = json.loads(json.dumps(base))
    checked["known_object"].update(
        checked=True,
        matched=True,
        not_checked_reason=None,
        catalogs_checked=["JPL SBIdent", "JPL Horizons"],
        designation="101 Helena (A868 PA)",
        query_utc="2026-11-01T20:00:00Z",
        enrichment="static",
    )
    prev, new = tmp_path / "prev", tmp_path / "new"
    _write(prev, "same", checked)
    _write(new, "same", base)
    moved = json.loads(json.dumps(base))
    moved["detections"][0]["ra_deg"] += 1e-4  # a different measurement: ask JPL again
    _write(prev, "moved", checked)
    _write(new, "moved", moved)
    _write(new, "fresh", base)
    counts = carry_jpl_checks(prev, new)
    assert counts == {"carried": 1, "changed": 1, "new": 1, "unchecked_before": 0}
    same = S.CandidateDetail.model_validate_json((new / "same.json").read_text())
    assert same.known_object.checked and same.known_object.designation == "101 Helena (A868 PA)"
    assert not S.CandidateDetail.model_validate_json(
        (new / "moved.json").read_text()
    ).known_object.checked
