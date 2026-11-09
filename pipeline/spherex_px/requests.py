"""Build a field for a visitor's sky request (build plan section 2.6, row 9).

The Sky requests Action (.github/workflows/requests.yml) takes a queued request from the Worker
and runs `spherex-px request-build`. It looks for the SPHEREx week segment that saw the position
most often, in the same way the survey plans tiles, and builds a 0.3° field there with the same
pipeline. The field is published even when no moving object is found: the images are real and
show what SPHEREx saw. A position SPHEREx never imaged repeatedly in one week is reported as
no_coverage, with the reason.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from pathlib import Path

from . import schemas as S
from .build import DEFAULT_OUT, FieldSpec, NoReadableImages, build_field
from .survey import AUTO_RELEASES, VISIT_GAP_HOURS, _constellation

log = logging.getLogger(__name__)

#: Segments whose sampled pointings come this close are indexed in full and compared.
NEAR_DEG = 8.0
#: At most this many nearby segments are indexed in full (about 3 minutes each).
MAX_SEGMENTS = 4
MIN_EXPOSURES = 8
MIN_VISITS = 3


@dataclass
class RequestResult:
    status: str  # done | no_coverage
    field_id: str | None
    message: str
    segment: str | None = None
    n_exposures: int = 0
    n_visits: int = 0
    n_candidates: int = 0


def _visits(mjds: list[float]) -> int:
    t = sorted(mjds)
    return (
        1 + sum(1 for a, b in zip(t, t[1:], strict=False) if (b - a) * 24 > VISIT_GAP_HOURS)
        if t
        else 0
    )


def field_id_for(request_id: str) -> str:
    return f"rq-{request_id.removeprefix('req-')[:12]}"


def best_segment(index, ra: float, dec: float) -> tuple[str | None, int, int, list[str]]:
    """(release/segment, exposures, visits, segments compared) with the most visits of the position."""
    from .data.index import _angsep_deg

    near: dict[tuple[str, str], float] = {}
    for release in AUTO_RELEASES:
        index.index_coarse(release)
    for e in index._rows():
        if e.key.release not in AUTO_RELEASES:
            continue
        d = float(_angsep_deg(ra, dec, e.ra_center, e.dec_center))
        k = (e.key.release, e.key.segment)
        if d <= NEAR_DEG and d < near.get(k, 1e9):
            near[k] = d
    compared = sorted(near, key=near.get)[:MAX_SEGMENTS]
    best: tuple[str | None, int, int] = (None, 0, 0)
    for release, seg in compared:
        index.index_segment(release, seg)
        exps = [
            e
            for e in index.covering(ra, dec, edge_px=30, segments=[seg])
            if not (e.l2dqa and e.l2dqa.strip() != "Pass")
        ]
        n, v = len(exps), _visits([e.mjd_avg for e in exps])
        log.info("%s/%s: %d exposures in %d visits", release, seg, n, v)
        if (v, n) > (best[2], best[1]):
            best = (f"{release}/{seg}", n, v)
    return best[0], best[1], best[2], [f"{r}/{s}" for r, s in compared]


def build_request(
    request_id: str, ra: float, dec: float, out: Path = DEFAULT_OUT, index=None
) -> RequestResult:
    from .data.index import CoverageIndex

    index = index or CoverageIndex()
    seg, n, v, compared = best_segment(index, ra, dec)
    if seg is None or n < MIN_EXPOSURES or v < MIN_VISITS:
        where = (
            f"the {len(compared)} nearest week segments ({', '.join(compared)})"
            if compared
            else "any public week segment"
        )
        return RequestResult(
            "no_coverage",
            None,
            f"SPHEREx did not image this position at least {MIN_EXPOSURES} times in {MIN_VISITS} "
            f"visits within one week in {where}"
            + (f"; the best was {n} exposures in {v} visits ({seg})." if seg else "."),
            seg,
            n,
            v,
        )
    fid = field_id_for(request_id)
    constellation = _constellation(ra, dec)
    spec = FieldSpec(
        field_id=fid,
        name=f"Requested patch in {constellation}",
        blurb=(
            f"A 0.3 degree patch in {constellation} that a visitor asked us to search, imaged by "
            f"SPHEREx {n} times in {v} visits during week {seg.split('/')[1]}."
        ),
        ra_deg=round(ra, 4),
        dec_deg=round(dec, 4),
        size_deg=0.3,
        segments=[seg],
        origin="run",
    )
    try:
        _detail, cands = build_field(spec, out)
    except NoReadableImages as err:
        return RequestResult(
            "no_coverage", None, f"No readable SPHEREx images here: {err}", seg, n, v
        )
    weak = (S.Classification.likely_artifact, S.Classification.unconfirmed_pair)
    real = [c for c in cands if c.classification not in weak]
    msg = f"Searched {n} SPHEREx exposures from {v} visits in week {seg.split('/')[1]}: " + (
        f"{len(real)} moving {'object' if len(real) == 1 else 'objects'} passed vetting."
        if real
        else "no moving object passed vetting."
    )
    return RequestResult("done", fid, msg, seg, n, v, len(real))


def write_result(r: RequestResult, path: Path) -> None:
    path.write_text(json.dumps(asdict(r), indent=1) + "\n")
