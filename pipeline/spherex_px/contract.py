"""Export the API contract as JSON Schema and validate fixture files against it."""

from __future__ import annotations

import json
from pathlib import Path

from .schemas import (
    ALL_RESPONSE_MODELS,
    CandidateDetail,
    CandidateList,
    FieldDetail,
    FieldList,
    InjectionStudy,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = REPO_ROOT / "shared" / "schema"
FIXTURE_DIR = REPO_ROOT / "shared" / "fixtures"

# fixture file -> model it must validate against
FIXTURE_MODELS = {
    "fields.json": FieldList,
    "field_detail.json": FieldDetail,
    "candidates.json": CandidateList,
    "candidate_detail.json": CandidateDetail,
    "injection_study.json": InjectionStudy,
}


def export_json_schema(out_dir: Path = SCHEMA_DIR) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name, model in ALL_RESPONSE_MODELS.items():
        path = out_dir / f"{name}.schema.json"
        path.write_text(json.dumps(model.model_json_schema(), indent=2) + "\n")
        written.append(path)
    return written


def validate_fixtures(fixture_dir: Path = FIXTURE_DIR) -> dict[str, str]:
    """Validate every fixture that exists. Returns {file: 'ok' | 'missing'}; raises on invalid."""
    result = {}
    for fname, model in FIXTURE_MODELS.items():
        path = fixture_dir / fname
        if not path.exists():
            result[fname] = "missing"
            continue
        model.model_validate_json(path.read_text())
        result[fname] = "ok"
    return result
