"""Objects and the survey summary, derived from the published fields and candidates.

An *object* is one solar-system body: every detection linked to it, across visits and (once
cross-field linking runs) across fields. Until then each candidate is one object.

The survey summary lists every tile: processed tiles are the built fields.
"""

from __future__ import annotations

import math
from pathlib import Path

import astropy.units as u
from astropy.coordinates import BarycentricMeanEcliptic, SkyCoord

from . import schemas as S

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


def object_from_candidate(c: S.CandidateDetail, build_run_id: str | None) -> S.ObjectDetail:
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
        distance_class=distance_class(c.motion.distance_au_estimate),
        orbit_status=S.OrbitStatus.none,
        orbit=None,
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


def build_survey(
    fields: list[S.FieldDetail],
    cands_by_field: dict[str, list[S.CandidateDetail]],
    n_objects: int,
    version: str,
    run_id: str | None,
    now: str,
) -> S.Survey:
    tiles = [tile_from_field(f, len(cands_by_field.get(f.field_id, []))) for f in fields]
    area = sum(t.size_deg**2 for t in tiles if t.status == S.TileStatus.processed)
    releases = sorted({f.data_release for f in fields})
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
            n_processed=sum(t.status == S.TileStatus.processed for t in tiles),
            area_deg2_processed=round(area, 4),
            n_epochs=sum(t.n_epochs for t in tiles),
            n_candidates=sum(t.n_candidates for t in tiles),
            n_objects=n_objects,
        ),
        last_run=None,
    )


def write_objects_and_survey(
    out_dir: Path,
    fields: list[S.FieldDetail],
    cands: list[S.CandidateDetail],
    version: str,
    run_id: str | None,
    now: str,
) -> tuple[int, int]:
    from .build import write_json

    obj_dir = out_dir / "objects"
    if obj_dir.exists():
        for p in obj_dir.glob("*.json"):
            p.unlink()
    objects = [object_from_candidate(c, run_id) for c in cands if c.classification != "injected"]
    for o in objects:
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
    write_json(
        out_dir / "survey.json", build_survey(fields, by_field, len(objects), version, run_id, now)
    )
    return len(objects), len(fields)
