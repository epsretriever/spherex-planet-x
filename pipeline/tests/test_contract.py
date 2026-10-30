import json

import pytest
from pydantic import ValidationError

from spherex_px import schemas
from spherex_px.contract import FIXTURE_DIR, SCHEMA_DIR, export_json_schema, validate_fixtures


def test_json_schema_export_is_current(tmp_path):
    """shared/schema must match the Pydantic models (run `spherex-px export-schema`)."""
    for path in export_json_schema(tmp_path):
        committed = SCHEMA_DIR / path.name
        assert committed.exists(), f"{committed} missing; run spherex-px export-schema"
        assert json.loads(committed.read_text()) == json.loads(path.read_text()), (
            f"{committed.name} is stale; run spherex-px export-schema"
        )


def test_fixtures_validate():
    status = validate_fixtures(FIXTURE_DIR)
    assert all(v in ("ok", "missing") for v in status.values())


def test_classification_enum_is_frozen():
    assert [c.value for c in schemas.Classification] == [
        "known_object",
        "unmatched",
        "likely_artifact",
        "unconfirmed_pair",
        "injected",
    ]


def test_envelope_carries_versions():
    fl = schemas.FieldList(
        pipeline_version="0.1.0+git.test", generated_utc="2026-01-01T00:00:00Z", fields=[]
    )
    dumped = fl.model_dump()
    assert dumped["schema_version"] == "1.1"
    assert dumped["pipeline_version"] == "0.1.0+git.test"


def test_unknown_fields_rejected():
    with pytest.raises(ValidationError):
        schemas.SkyPosition(ra_deg=1.0, dec_deg=2.0, bogus=3)


def test_catalogs_checked_only_real_services():
    with pytest.raises(ValidationError):
        schemas.KnownObject(
            checked=True, matched=False, catalogs_checked=["MPC"], search_radius_arcsec=30.0
        )


def test_score_definition_is_not_a_probability():
    s = schemas.Scores(
        motion_consistency=1, snr=1, artifact_likelihood=0, overall=1, quality_level="high"
    )
    assert "not a probability" in s.definition
