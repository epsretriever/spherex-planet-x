"""Survey footprint and run ledger.

The survey publishes a field page only for tiles where it found a moving object, but the
sky map must also show where it looked and found nothing, and when. After every survey run
(.github/workflows/survey.yml, merge job) ``record_run`` folds the shards' tile reports into
two files next to the published data:

- ``survey/footprint.json``: every tile ever searched, with its latest result
  (kept, empty or failed), position, coverage and the run that searched it;
- ``survey/ledger.json``: one row per run (tiles searched, kept, empty, failed, new objects).

``publish`` reads both into ``survey.json`` (see objects.build_survey).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal

from astropy.time import Time

from . import schemas as S
from .schemas import Model

FOOTPRINT = Path("survey") / "footprint.json"
LEDGER = Path("survey") / "ledger.json"
#: Per week segment: tiles the plan found worth searching, how many are searched, and whether
#: the segment is finished (survey.resolve_segments "next:N" moves on to new segments).
SEGMENTS = Path("survey") / "segments.json"
TILE_SIZE_DEG = 0.3


class FootprintTile(Model):
    tile_id: str
    ra_deg: float
    dec_deg: float
    elon_deg: float
    elat_deg: float
    size_deg: float
    segment: str
    n_exposures: int
    n_visits: int
    first_utc: str | None
    last_utc: str | None
    status: Literal["kept", "empty", "failed"]
    n_candidates: int
    detail: str | None
    searched_utc: str
    run_id: str


class Footprint(Model):
    tiles: list[FootprintTile]


class Ledger(Model):
    runs: list[S.SurveyRun]


def _utc(mjd: float | None) -> str | None:
    if mjd is None:
        return None
    return Time(mjd, format="mjd", scale="utc").isot[:19] + "Z"


def load_footprint(out_dir: Path) -> Footprint:
    p = out_dir / FOOTPRINT
    return Footprint.model_validate_json(p.read_text()) if p.exists() else Footprint(tiles=[])


def load_ledger(out_dir: Path) -> Ledger:
    p = out_dir / LEDGER
    return Ledger.model_validate_json(p.read_text()) if p.exists() else Ledger(runs=[])


def load_segments(out_dir: Path) -> dict[str, dict]:
    p = out_dir / SEGMENTS
    return json.loads(p.read_text()) if p.exists() else {}


def update_segments(out_dir: Path, footprint: Footprint, plan_meta: dict[str, dict]) -> dict:
    state = load_segments(out_dir)
    searched: dict[str, int] = {}
    for t in footprint.tiles:
        state.setdefault(t.segment, {})
        if t.status != "failed":
            searched[t.segment] = searched.get(t.segment, 0) + 1
    for seg, m in plan_meta.items():
        state.setdefault(seg, {})["planned"] = int(m["planned"])
    for seg, st in state.items():
        st["searched"] = searched.get(seg, 0)
        st["complete"] = st.get("planned") is not None and st["searched"] >= st["planned"]
    path = out_dir / SEGMENTS
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(dict(sorted(state.items())), indent=1) + "\n")
    return state


def _published_object_ids(out_dir: Path) -> set[str]:
    p = out_dir / "objects.json"
    if not p.exists():
        return set()
    return {o["object_id"] for o in json.loads(p.read_text()).get("objects", [])}


def _candidate_objects(out_dir: Path) -> set[str]:
    """Object ids the next publish will write (objects.object_from_candidate: obj-<candidate>)."""
    ids = set()
    for p in (out_dir / "candidates").glob("*.json"):
        if json.loads(p.read_text()).get("classification") != "injected":
            ids.add(f"obj-{p.stem}")
    return ids


def _data_version(out_dir: Path) -> str:
    for p in sorted((out_dir / "fields").glob("*.json")):
        return json.loads(p.read_text())["pipeline_version"]
    from .version import pipeline_version

    return pipeline_version(require_clean=False)


def record_run(
    out_dir: Path,
    reports: list[Path],
    *,
    run_id: str,
    started_utc: str,
    finished_utc: str,
    workflow_url: str | None = None,
    plan_meta: dict[str, dict] | None = None,
) -> S.SurveyRun:
    """Fold shard reports (survey-shard-N.json) into the footprint and append to the ledger.

    Call after the shards' fields and candidates are in ``out_dir`` and before ``publish``
    (which rewrites objects.json; the previous one tells which objects are new)."""
    from .build import write_json

    rows = [r for p in reports for r in json.loads(Path(p).read_text())]
    footprint = load_footprint(out_dir)
    by_id = {t.tile_id: t for t in footprint.tiles}
    seen_before = set(by_id)
    new_files = 0
    segments: set[str] = set()
    for r in rows:
        t = r.get("tile")
        if not t:
            continue  # reports from before the footprint existed carry no tile
        segments.add(t["segment"])
        if t["field_id"] not in seen_before:
            new_files += int(t["n_exposures"])
        by_id[t["field_id"]] = FootprintTile(
            tile_id=t["field_id"],
            ra_deg=t["ra_deg"],
            dec_deg=t["dec_deg"],
            elon_deg=t["elon_deg"],
            elat_deg=t["elat_deg"],
            size_deg=TILE_SIZE_DEG,
            segment=t["segment"],
            n_exposures=t["n_exposures"],
            n_visits=t["n_visits"],
            first_utc=_utc(t.get("first_mjd")),
            last_utc=_utc(t.get("last_mjd")),
            status=r["status"],
            n_candidates=int(r["candidates"]),
            detail=r.get("detail") or None,
            searched_utc=finished_utc,
            run_id=run_id,
        )
    footprint = Footprint(tiles=sorted(by_id.values(), key=lambda t: (t.elon_deg, t.elat_deg)))
    # One line per tile: the footprint grows by thousands of tiles per run.
    path = out_dir / FOOTPRINT
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        '{"tiles": [\n' + ",\n".join(t.model_dump_json() for t in footprint.tiles) + "\n]}\n"
    )
    update_segments(out_dir, footprint, plan_meta or {})

    new_objects = _candidate_objects(out_dir) - _published_object_ids(out_dir)
    run = S.SurveyRun(
        run_id=run_id,
        started_utc=started_utc,
        finished_utc=finished_utc,
        pipeline_version=_data_version(out_dir),
        n_new_files=new_files,
        n_tiles_processed=len(rows),
        n_new_objects=len(new_objects),
        segments=sorted(segments),
        n_tiles_with_movers=sum(r["status"] == "kept" for r in rows),
        n_tiles_empty=sum(r["status"] == "empty" for r in rows),
        n_tiles_failed=sum(r["status"] == "failed" for r in rows),
        n_candidates=sum(int(r["candidates"]) for r in rows if r["status"] == "kept"),
        workflow_url=workflow_url,
    )
    ledger = load_ledger(out_dir)
    ledger.runs = [x for x in ledger.runs if x.run_id != run_id] + [run]
    write_json(out_dir / LEDGER, ledger)
    return run


def workflow_url_from_env() -> str | None:
    server, repo, run = (
        os.environ.get(k) for k in ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID")
    )
    return f"{server}/{repo}/actions/runs/{run}" if server and repo and run else None
