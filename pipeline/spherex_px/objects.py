"""Objects and the survey summary, derived from the published fields and candidates.

An *object* is one solar-system body: every detection linked to it, across visits and (once
cross-field linking runs) across fields. Until then each candidate is one object.

The survey summary lists every tile: processed tiles are the built fields.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import astropy.units as u
from astropy.coordinates import BarycentricMeanEcliptic, SkyCoord

from . import schemas as S
from .orbits import clones_doc, distance_class_of, orbit_for, orbital_elements, prediction_doc
from .ranking import rank_anomalies

# Distance classes from a heliocentric-ish distance estimate (AU). Parallax distances are from
# the observer, so only well-separated ranges are classified; everything else is "unknown".
_CLASS_BOUNDS = [
    (S.DistanceClass.neo, 0.0, 1.3),
    (S.DistanceClass.main_belt, 1.8, 4.2),
    (S.DistanceClass.jupiter_trojan, 4.8, 5.6),
    (S.DistanceClass.centaur, 6.0, 30.0),
    (S.DistanceClass.tno, 30.0, math.inf),
]


def distance_class(d: S.DistanceEstimate | None) -> S.DistanceClass:
    """Class whose range contains the best estimate; unknown without an estimate."""
    if d is None:
        return S.DistanceClass.unknown
    for cls, lo, hi in _CLASS_BOUNDS:
        if lo <= d.best < hi:
            return cls
    return S.DistanceClass.unknown


def _visits(dets: list[S.Detection], gap_hours: float = 0.5) -> int:
    t = sorted(d.mjd for d in dets)
    return (
        1 + sum(1 for a, b in zip(t, t[1:], strict=False) if (b - a) * 24 > gap_hours) if t else 0
    )


def object_id_for(candidate_id: str) -> str:
    return f"obj-{candidate_id}"


def object_from_candidate(
    c: S.CandidateDetail, build_run_id: str | None, orbit=None
) -> S.ObjectDetail:
    dets = [
        S.ObjectDetection(**d.model_dump(), field_id=c.field_id, candidate_id=c.candidate_id)
        for d in c.detections
    ]
    first, last = dets[0].time_utc, dets[-1].time_utc
    return S.ObjectDetail(
        pipeline_version=c.pipeline_version,
        build_run_id=build_run_id,
        object_id=object_id_for(c.candidate_id),
        classification=c.classification,
        label_plain=c.label_plain,
        summary_plain=c.summary_plain,
        thumbnail_url=c.thumbnail_url,
        field_ids=[c.field_id],
        candidate_ids=[c.candidate_id],
        detections=dets,
        motion=c.motion,
        distance_class=(
            distance_class_of(orbit) if orbit else distance_class(c.motion.distance_au_estimate)
        ),
        orbit_status=S.OrbitStatus(orbit.status) if orbit else S.OrbitStatus.none,
        orbit=orbital_elements(orbit, object_id_for(c.candidate_id)) if orbit else None,
        known_object=c.known_object,
        scores=c.scores,
        explanation=c.explanation,
        spectrum=c.spectrum,
        history=[
            S.ObjectHistoryEntry(
                utc=c.provenance.generated_utc,
                run_id=c.provenance.run_id,
                change=f"linked {len(dets)} detections over {_visits(c.detections)} visits "
                f"from {first[:10]} to {last[:10]}",
            )
        ],
        provenance=c.provenance,
    )


def summary_of_object(o: S.ObjectDetail) -> S.ObjectSummary:
    t = sorted(d.mjd for d in o.detections)
    return S.ObjectSummary(
        object_id=o.object_id,
        classification=o.classification,
        label_plain=o.label_plain,
        summary_plain=o.summary_plain,
        thumbnail_url=o.thumbnail_url,
        field_ids=o.field_ids,
        candidate_ids=o.candidate_ids,
        n_detections=len(o.detections),
        n_visits=_visits(o.detections),
        first_time_utc=min(o.detections, key=lambda d: d.mjd).time_utc,
        last_time_utc=max(o.detections, key=lambda d: d.mjd).time_utc,
        arc_hours=round((t[-1] - t[0]) * 24, 3),
        rate_arcsec_per_hr=o.motion.rate_arcsec_per_hr,
        distance_class=o.distance_class,
        distance_au_estimate=o.motion.distance_au_estimate,
        orbit_status=o.orbit_status,
        overall_score=o.scores.overall,
        quality_level=o.scores.quality_level,
        known_object_checked=o.known_object.checked,
        known_object_matched=o.known_object.matched,
        known_object_designation=o.known_object.designation,
        anomaly_score=o.anomaly.score if o.anomaly else None,
        anomaly_rank=o.anomaly.rank if o.anomaly else None,
        anomaly_reason=o.anomaly.reason_plain if o.anomaly else None,
    )


def tile_from_field(f: S.FieldDetail, n_candidates: int) -> S.SurveyTile:
    c = SkyCoord(f.center.ra_deg * u.deg, f.center.dec_deg * u.deg).transform_to(
        BarycentricMeanEcliptic()
    )
    mjds = sorted(e.mjd for e in f.epochs)
    visits = 1 + sum(1 for a, b in zip(mjds, mjds[1:], strict=False) if (b - a) * 24 > 0.5)
    return S.SurveyTile(
        tile_id=f.field_id,
        center=f.center,
        ecliptic_lon_deg=round(float(c.lon.deg), 4),
        ecliptic_lat_deg=round(float(c.lat.deg), 4),
        size_deg=f.size_deg.width,
        status=S.TileStatus.processed,
        n_epochs=len(f.epochs),
        n_visits=visits,
        first_time_utc=min(f.epochs, key=lambda e: e.mjd).time_utc,
        last_time_utc=max(f.epochs, key=lambda e: e.mjd).time_utc,
        last_processed_utc=f.generated_utc,
        field_id=f.field_id,
        n_candidates=n_candidates,
        m50_ab=None,
    )


def tile_from_footprint(t) -> S.SurveyTile:
    """A searched tile without a published field page: nothing found, or the search failed."""
    return S.SurveyTile(
        tile_id=t.tile_id,
        center=S.SkyPosition(ra_deg=t.ra_deg, dec_deg=t.dec_deg),
        ecliptic_lon_deg=t.elon_deg,
        ecliptic_lat_deg=t.elat_deg,
        size_deg=t.size_deg,
        status={"failed": S.TileStatus.failed, "empty": S.TileStatus.empty}.get(
            t.status, S.TileStatus.processed
        ),
        n_epochs=t.n_exposures,
        n_visits=t.n_visits,
        first_time_utc=t.first_utc,
        last_time_utc=t.last_utc,
        last_processed_utc=t.searched_utc,
        field_id=None,
        n_candidates=0,
        detail=t.detail if t.status == "failed" else None,
    )


def injection_m50(out_dir: Path) -> tuple[str | None, dict[str, float]]:
    """Per-field m50 (linear tracks, 3-100 arcsec/hr) from the newest published injection study."""
    idx = out_dir / "injection" / "index.json"
    if not idx.exists():
        return None, {}
    studies = json.loads(idx.read_text()).get("studies", [])
    if not studies:
        return None, {}
    newest = max(studies, key=lambda r: r["generated_utc"])
    p = out_dir / "injection" / f"{newest['study_id']}.json"
    if not p.exists():
        return None, {}
    study = json.loads(p.read_text())
    per_field = {
        f["field_id"]: f["m50_ab"]
        for f in study.get("per_field", [])
        if f.get("m50_ab") is not None
    }
    return study["study_id"], per_field


def build_survey(
    fields: list[S.FieldDetail],
    cands_by_field: dict[str, list[S.CandidateDetail]],
    n_objects: int,
    version: str,
    run_id: str | None,
    now: str,
    footprint=None,
    runs: list[S.SurveyRun] | None = None,
    m50: tuple[str | None, dict[str, float]] = (None, {}),
) -> S.Survey:
    study_id, m50_by_field = m50
    tiles = [tile_from_field(f, len(cands_by_field.get(f.field_id, []))) for f in fields]
    for t in tiles:
        if t.tile_id in m50_by_field:
            t.m50_ab = m50_by_field[t.tile_id]
            t.m50_study_id = study_id
    published = {t.tile_id for t in tiles}
    if footprint is not None:
        tiles += [tile_from_footprint(t) for t in footprint.tiles if t.tile_id not in published]
    processed = [t for t in tiles if t.status == S.TileStatus.processed]
    searched = [t for t in tiles if t.status in (S.TileStatus.processed, S.TileStatus.empty)]
    releases = sorted({f.data_release for f in fields})
    runs = sorted(runs or [], key=lambda r: r.finished_utc, reverse=True)
    return S.Survey(
        pipeline_version=version,
        build_run_id=run_id,
        generated_utc=now,
        name="SPHEREx ecliptic survey",
        description=(
            "Tiles of sky along the ecliptic, where most asteroids are, that SPHEREx observed "
            "several times within a few days. Each processed tile is searched for moving objects."
        ),
        tile_size_deg=0.3,
        data_releases=releases,
        tiles=tiles,
        totals=S.SurveyTotals(
            n_tiles=len(tiles),
            n_processed=len(processed),
            area_deg2_processed=round(sum(t.size_deg**2 for t in processed), 4),
            n_epochs=sum(t.n_epochs for t in tiles),
            n_candidates=sum(t.n_candidates for t in tiles),
            n_objects=n_objects,
            n_searched=len(searched),
            n_empty=sum(t.status == S.TileStatus.empty for t in tiles),
            n_failed=sum(t.status == S.TileStatus.failed for t in tiles),
            area_deg2_searched=round(sum(t.size_deg**2 for t in searched), 4),
        ),
        last_run=runs[0] if runs else None,
        runs=runs[:20],
    )


def fit_orbits(out_dir: Path, cands: list[S.CandidateDetail], workers: int | None = None) -> dict:
    """Cached orbits for every candidate, fitting the missing ones in parallel."""
    import multiprocessing as mp
    import os

    from .orbits import orbit_path

    missing = [c for c in cands if not orbit_path(out_dir, c.candidate_id).exists()]
    if len(missing) > 1:
        n = min(workers or os.cpu_count() or 1, len(missing))
        with mp.get_context("fork").Pool(n) as pool:
            pool.starmap(orbit_for, [(out_dir, c) for c in missing])
    return {c.candidate_id: r for c in cands if (r := orbit_for(out_dir, c)) is not None}


def write_objects_and_survey(
    out_dir: Path,
    fields: list[S.FieldDetail],
    cands: list[S.CandidateDetail],
    version: str,
    run_id: str | None,
    now: str,
) -> tuple[int, int]:
    import shutil
    from datetime import UTC, datetime

    from .build import write_json

    obj_dir = out_dir / "objects"
    if obj_dir.exists():
        for p in obj_dir.glob("*.json"):
            p.unlink()
        for p in obj_dir.iterdir():
            if p.is_dir():
                shutil.rmtree(p)
    real = [c for c in cands if c.classification != "injected"]
    orbits = fit_orbits(out_dir, real)
    stamp = datetime.fromisoformat(now.replace("Z", "+00:00")) if now else datetime.now(UTC)
    objects = []
    for c in real:
        orbit = orbits.get(c.candidate_id)
        o = object_from_candidate(c, run_id, orbit)
        objects.append(o)
        if orbit:
            write_json(
                obj_dir / o.object_id / "clones.json", clones_doc(orbit, o.object_id, version)
            )
            write_json(
                obj_dir / o.object_id / "prediction.json",
                prediction_doc(orbit, o.object_id, version, stamp),
            )
    anomalies = rank_anomalies(objects)
    for o in objects:
        o.anomaly = anomalies.get(o.object_id)
        write_json(obj_dir / f"{o.object_id}.json", o)
    summaries = sorted(
        (summary_of_object(o) for o in objects), key=lambda s: (-s.overall_score, s.object_id)
    )
    write_json(
        out_dir / "objects.json",
        S.ObjectList(
            pipeline_version=version,
            build_run_id=run_id,
            generated_utc=now,
            total=len(summaries),
            objects=summaries,
        ),
    )
    by_field: dict[str, list[S.CandidateDetail]] = {}
    for c in cands:
        by_field.setdefault(c.field_id, []).append(c)
    from .ledger import load_footprint, load_ledger

    survey = build_survey(
        fields,
        by_field,
        len(objects),
        version,
        run_id,
        now,
        footprint=load_footprint(out_dir),
        runs=load_ledger(out_dir).runs,
        m50=injection_m50(out_dir),
    )
    write_json(out_dir / "survey.json", survey)
    return len(objects), len(fields)
