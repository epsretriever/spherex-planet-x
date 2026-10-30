from spherex_px import schemas as S
from spherex_px.objects import distance_class


def test_distance_class_ranges():
    est = lambda best: S.DistanceEstimate(best=best, lo=best * 0.8, hi=best * 1.2)  # noqa: E731
    assert distance_class(None) is S.DistanceClass.unknown
    assert distance_class(est(1.0)) is S.DistanceClass.neo
    assert distance_class(est(2.45)) is S.DistanceClass.main_belt
    assert distance_class(est(5.2)) is S.DistanceClass.jupiter_trojan
    assert distance_class(est(15)) is S.DistanceClass.centaur
    assert distance_class(est(45)) is S.DistanceClass.tno
    # between the belt and the trojans: not classified
    assert distance_class(est(4.5)) is S.DistanceClass.unknown


def test_publish_keeps_the_data_version(tmp_path):
    """Lists must carry the version of the files they list (the Worker keys JPL results by it)."""
    import json

    import pytest

    from spherex_px.build import publish
    from spherex_px.contract import FIXTURE_DIR

    field = json.loads((FIXTURE_DIR / "field_detail.json").read_text())
    cand = json.loads((FIXTURE_DIR / "candidate_detail.json").read_text())
    (tmp_path / "fields").mkdir()
    (tmp_path / "candidates").mkdir()
    (tmp_path / "fields" / f"{field['field_id']}.json").write_text(json.dumps(field))
    (tmp_path / "candidates" / f"{cand['candidate_id']}.json").write_text(json.dumps(cand))
    publish(tmp_path)
    for name in ("fields.json", "candidates.json", "objects.json", "survey.json"):
        assert (
            json.loads((tmp_path / name).read_text())["pipeline_version"]
            == field["pipeline_version"]
        )
    obj = json.loads((tmp_path / "objects" / f"obj-{cand['candidate_id']}.json").read_text())
    assert obj["pipeline_version"] == cand["pipeline_version"]

    cand["pipeline_version"] = "0.0.0+git.other"
    (tmp_path / "candidates" / f"{cand['candidate_id']}.json").write_text(json.dumps(cand))
    with pytest.raises(ValueError, match="mixes pipeline versions"):
        publish(tmp_path)
