"""Carry JPL checks over from the previous published data to a rebuild.

Every survey run rebuilds every tile, which writes each candidate with an unchecked known_object
(the offline builder has no JPL access). Asking JPL again for every candidate takes about a
minute each (scripts/jpl-check.ts), so a check is carried over when the rebuilt candidate has
the same id and exactly the same detections: the same exposures, positions and errors, so the
same question to JPL. Anything else is left unchecked for the JPL check to ask afresh.
"""

from __future__ import annotations

import logging
from pathlib import Path

from . import schemas as S

log = logging.getLogger(__name__)


def detections_key(dets: list[S.Detection]) -> list[tuple]:
    return [
        (
            d.obs_id,
            d.band_index,
            round(d.mjd, 8),
            round(d.ra_deg, 7),
            round(d.dec_deg, 7),
            d.pos_err_arcsec,
            tuple(d.spacecraft_geocentric_km) if d.spacecraft_geocentric_km else None,
        )
        for d in sorted(dets, key=lambda d: (d.mjd, d.band_index or 0))
    ]


def carry_jpl_checks(prev_dir: Path, new_dir: Path) -> dict[str, int]:
    """Copy known_object from prev_dir/<id>.json into new_dir/<id>.json where it applies."""
    from .build import write_json

    counts = {"carried": 0, "changed": 0, "new": 0, "unchecked_before": 0}
    for p in sorted(new_dir.glob("*.json")):
        new = S.CandidateDetail.model_validate_json(p.read_text())
        if new.classification == S.Classification.injected or new.known_object.checked:
            continue
        old_path = prev_dir / p.name
        if not old_path.exists():
            counts["new"] += 1
            continue
        old = S.CandidateDetail.model_validate_json(old_path.read_text())
        if not old.known_object.checked:
            counts["unchecked_before"] += 1
            continue
        if detections_key(old.detections) != detections_key(new.detections):
            counts["changed"] += 1
            continue
        # Classification and text follow from the check when the JPL check next runs
        # (scripts/jpl-check.ts) and whenever the Worker serves the report.
        new.known_object = old.known_object
        write_json(p, new)
        counts["carried"] += 1
    log.info("JPL checks: %s", counts)
    return counts
