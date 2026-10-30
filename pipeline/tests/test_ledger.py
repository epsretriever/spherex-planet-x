import json
import shutil
from pathlib import Path

import pytest

from spherex_px import schemas as S
from spherex_px.build import publish
from spherex_px.ledger import FOOTPRINT, LEDGER, load_footprint, load_ledger, record_run

DATA = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data"


def tile(fid, elon, status_kw=None):
    return {
        "field_id": fid,
        "ra_deg": 347.0,
        "dec_deg": -5.5,
        "elon_deg": elon,
        "elat_deg": -0.3,
        "segment": "qr2/2025W23_1C",
        "n_exposures": 24,
        "n_visits": 3,
        "hours_spanned": 30.5,
        "constellation": "Aquarius",
        "first_mjd": 60829.5,
        "last_mjd": 60830.77,
    }


@pytest.fixture
def out(tmp_path):
    if not (DATA / "fields.json").exists():
        pytest.skip("published data not present")
    for name in ("fields", "candidates"):
        shutil.copytree(
            DATA / name, tmp_path / name, ignore=shutil.ignore_patterns("*.webp", "*-sim*")
        )
    shutil.copy(DATA / "objects.json", tmp_path / "objects.json")
    return tmp_path


def report(path, rows):
    path.write_text(json.dumps(rows))
    return path


def test_records_footprint_and_ledger_then_publishes_them(out, tmp_path):
    fields = sorted(p.stem for p in (out / "fields").glob("*.json"))
    r = report(
        tmp_path / "survey-shard-0.json",
        [
            {
                "field_id": fields[0],
                "status": "kept",
                "candidates": 1,
                "detail": "",
                "tile": tile(fields[0], 346.5),
            },
            {
                "field_id": "sv-x-l3468-s003",
                "status": "empty",
                "candidates": 0,
                "detail": "",
                "tile": tile("sv-x-l3468-s003", 346.8),
            },
            {
                "field_id": "sv-x-l3471-s003",
                "status": "failed",
                "candidates": 0,
                "detail": "OSError: S3 read timed out",
                "tile": tile("sv-x-l3471-s003", 347.1),
            },
        ],
    )
    run = record_run(
        out,
        [r],
        run_id="gh-1-1",
        started_utc="2026-10-30T10:00:00Z",
        finished_utc="2026-10-30T11:00:00Z",
    )
    assert (
        run.n_tiles_processed,
        run.n_tiles_with_movers,
        run.n_tiles_empty,
        run.n_tiles_failed,
    ) == (3, 1, 1, 1)
    assert run.n_new_files == 72  # three tiles never searched before, 24 exposures each
    assert run.n_new_objects == 0  # the same candidates as the published objects.json
    assert run.segments == ["qr2/2025W23_1C"]
    fp = load_footprint(out)
    assert [t.status for t in fp.tiles] == ["kept", "empty", "failed"]
    assert fp.tiles[0].first_utc == "2025-06-03T12:00:00Z"

    publish(out)
    survey = S.Survey.model_validate_json((out / "survey.json").read_text())
    by_id = {t.tile_id: t for t in survey.tiles}
    assert by_id["sv-x-l3468-s003"].status == S.TileStatus.empty
    assert by_id["sv-x-l3468-s003"].field_id is None
    assert by_id["sv-x-l3471-s003"].status == S.TileStatus.failed
    assert by_id["sv-x-l3471-s003"].detail == "OSError: S3 read timed out"
    assert by_id[fields[0]].status == S.TileStatus.processed
    t = survey.totals
    assert (t.n_tiles, t.n_processed, t.n_empty, t.n_failed) == (len(fields) + 2, len(fields), 1, 1)
    assert t.n_searched == len(fields) + 1
    assert t.area_deg2_searched == pytest.approx(t.area_deg2_processed + 0.09)
    assert survey.last_run is not None and survey.last_run.run_id == "gh-1-1"

    # A second run: the empty tile is searched again and now fails; nothing is new.
    r2 = report(
        tmp_path / "survey-shard-1.json",
        [
            {
                "field_id": "sv-x-l3468-s003",
                "status": "failed",
                "candidates": 0,
                "detail": "timeout",
                "tile": tile("sv-x-l3468-s003", 346.8),
            }
        ],
    )
    run2 = record_run(
        out,
        [r2],
        run_id="gh-2-1",
        started_utc="2026-10-31T10:00:00Z",
        finished_utc="2026-10-31T11:00:00Z",
    )
    assert run2.n_new_files == 0
    assert [x.run_id for x in load_ledger(out).runs] == ["gh-1-1", "gh-2-1"]
    assert {t.tile_id: t.status for t in load_footprint(out).tiles}["sv-x-l3468-s003"] == "failed"
    publish(out)
    survey = S.Survey.model_validate_json((out / "survey.json").read_text())
    assert [x.run_id for x in survey.runs] == ["gh-2-1", "gh-1-1"]
    assert survey.last_run.run_id == "gh-2-1"
    assert (out / FOOTPRINT).exists() and (out / LEDGER).exists()


def test_reports_without_tiles_still_count(out, tmp_path):
    r = report(
        tmp_path / "s.json",
        [{"field_id": "sv-old", "status": "empty", "candidates": 0, "detail": ""}],
    )
    run = record_run(out, [r], run_id="gh-3-1", started_utc="a", finished_utc="b")
    assert run.n_tiles_processed == 1 and run.n_tiles_empty == 1
    assert load_footprint(out).tiles == []


def test_m50_from_the_newest_injection_study(out):
    inj = out / "injection"
    inj.mkdir()
    fid = sorted(p.stem for p in (out / "fields").glob("*.json"))[0]
    (inj / "index.json").write_text(
        json.dumps(
            {
                "studies": [
                    {"study_id": "old", "generated_utc": "2026-01-01"},
                    {"study_id": "new", "generated_utc": "2026-10-30"},
                ]
            }
        )
    )
    (inj / "new.json").write_text(
        json.dumps({"study_id": "new", "per_field": [{"field_id": fid, "m50_ab": 17.4}]})
    )
    publish(out)
    survey = S.Survey.model_validate_json((out / "survey.json").read_text())
    t = {t.tile_id: t for t in survey.tiles}[fid]
    assert (t.m50_ab, t.m50_study_id) == (17.4, "new")
