import json

from spherex_px import schemas as S
from spherex_px.contract import FIXTURE_DIR
from spherex_px.reporting import LABELS, reporting_of


def _cand(**over) -> S.CandidateDetail:
    c = S.CandidateDetail.model_validate_json((FIXTURE_DIR / "candidate_detail.json").read_text())
    c = c.model_copy(update={"classification": S.Classification.unmatched, **over})
    c.scores = c.scores.model_copy(update={"artifact_likelihood": 0.0})
    vet = {
        "min_detections": (4, 3, True),
        "motion_fit_rms": (1.0, 3.0, True),
        "flagged_aperture_pixels": (0.0, 0.25, True),
        "psf_like_shape": (0.5, 0.85, True),
        "edge_distance": (50.0, 3.0, True),
        "not_static": (1.0, 4.0, True),
        "flux_consistent_across_lambda": (1.3, 4.0, True),
    }
    c.vetting = [
        S.VettingCheck(check=k, description=k, value=v, threshold=t, passed=p)
        for k, (v, t, p) in vet.items()
    ]
    return c


def test_measurements_pass_but_jpl_is_left_to_the_worker():
    r = reporting_of(_cand(), S.OrbitStatus.preliminary, 0.9)
    assert r is not None
    assert r.measurements_passed
    # The pipeline never judges the catalog check, so it cannot call anything "ready".
    assert r.status is S.ReportingStatus.incomplete
    assert r.label_plain == LABELS[S.ReportingStatus.incomplete]
    jpl = [x for x in r.criteria if x.source == "jpl"]
    assert len(jpl) == 3 and all(x.passed is None for x in jpl)


def test_each_failed_test_rules_it_out():
    c = _cand()
    assert reporting_of(c, S.OrbitStatus.none, None).status is S.ReportingStatus.not_ready
    assert reporting_of(c, S.OrbitStatus.preliminary, 2.0).status is S.ReportingStatus.not_ready
    c2 = _cand()
    c2.vetting[0] = c2.vetting[0].model_copy(update={"value": 2, "passed": False})
    r = reporting_of(c2, S.OrbitStatus.preliminary, 0.9)
    assert r.status is S.ReportingStatus.not_ready and not r.measurements_passed
    assert "at least 3 separate visits" in r.summary_plain
    c3 = _cand(classification=S.Classification.unconfirmed_pair)
    assert reporting_of(c3, S.OrbitStatus.preliminary, 0.9).status is S.ReportingStatus.not_ready
    c4 = _cand()
    c4.scores = c4.scores.model_copy(update={"artifact_likelihood": 0.3})
    assert reporting_of(c4, S.OrbitStatus.preliminary, 0.9).status is S.ReportingStatus.not_ready


def test_injected_candidates_are_never_reported():
    assert (
        reporting_of(_cand(classification=S.Classification.injected), S.OrbitStatus.none, None)
        is None
    )


def test_no_discovery_language():
    import re

    forbidden = re.compile(
        r"\b(discover\w*|new planet|first ever|never (been )?seen before|new object)\b", re.I
    )
    texts = list(LABELS.values()) + [S.REPORTING_DEFINITION]
    r = reporting_of(_cand(), S.OrbitStatus.preliminary, 0.9)
    texts += [r.summary_plain] + [x.label for x in r.criteria]
    for t in texts:
        # The definition may say what it is *not* ("does not make it a new object").
        if t is S.REPORTING_DEFINITION:
            t = t.replace("That does not make it a new object", "")
        assert not forbidden.search(t), t


def test_publish_writes_reporting(tmp_path):
    from spherex_px.build import publish

    field = json.loads((FIXTURE_DIR / "field_detail.json").read_text())
    cand = json.loads((FIXTURE_DIR / "candidate_detail.json").read_text())
    (tmp_path / "fields").mkdir()
    (tmp_path / "candidates").mkdir()
    (tmp_path / "fields" / f"{field['field_id']}.json").write_text(json.dumps(field))
    (tmp_path / "candidates" / f"{cand['candidate_id']}.json").write_text(json.dumps(cand))
    publish(tmp_path)
    detail = json.loads((tmp_path / "candidates" / f"{cand['candidate_id']}.json").read_text())
    listed = json.loads((tmp_path / "candidates.json").read_text())["candidates"][0]
    objs = json.loads((tmp_path / "objects.json").read_text())["objects"]
    if cand["classification"] == "injected":
        assert detail["reporting"] is None
    else:
        assert detail["reporting"]["status"] in ("incomplete", "not_ready")
        assert listed["reporting_status"] == detail["reporting"]["status"]
        assert objs[0]["reporting_status"] == detail["reporting"]["status"]


def test_jpl_rules_match_the_worker():
    """Same cases as worker/test/reporting.test.ts."""
    from spherex_px.reporting import jpl_criteria, status_of

    doc = json.loads((FIXTURE_DIR / "reporting_jpl_cases.json").read_text())
    for case in doc["cases"]:
        k = S.KnownObject.model_validate(case["known_object"])
        got = jpl_criteria(k)
        assert [x.passed for x in got] == case["passed"], case["name"]
        ok = S.ReportingCriterion(
            id="m", label="m", passed=True, value=None, threshold=None, source="pipeline"
        )
        assert status_of([ok, *got]).value == case["status"], case["name"]


def test_a_publish_time_check_can_make_it_ready():
    c = _cand()
    c.known_object = S.KnownObject.model_validate(
        json.loads((FIXTURE_DIR / "reporting_jpl_cases.json").read_text())["cases"][0][
            "known_object"
        ]
    )
    r = reporting_of(c, S.OrbitStatus.preliminary, 0.9)
    assert r.status is S.ReportingStatus.ready
    assert r.label_plain == "Not in any catalog we checked — candidate for reporting"
