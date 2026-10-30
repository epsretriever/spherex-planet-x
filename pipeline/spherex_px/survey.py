"""Survey: search many SPHEREx tiles for moving objects, not just the curated showcase fields.

A survey run has two steps, so it can be spread over many machines (see
.github/workflows/survey.yml):

1. ``plan``: for each week segment, lay a grid of tiles along the ecliptic (where asteroids
   are concentrated) over the part of the sky that segment observed, and keep the tiles that
   SPHEREx imaged often enough to link a moving object: at least ``min_exposures`` exposures
   spread over at least ``min_visits`` visits more than an hour apart. Writes a plan file.
2. ``build``: build a share of the planned tiles with the normal field builder (the same
   detection, linking, vetting and rendering as the showcase fields) and keep only tiles
   where the pipeline found a moving object that passed vetting.

Survey tiles are published with ``origin = "run"``; their name and blurb are generated from
measured values only (position, constellation, dates, what was found).
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from . import schemas as S
from .build import DEFAULT_OUT, FieldSpec, NoReadableImages, build_field

log = logging.getLogger(__name__)

#: Releases auto:N picks weeks from. qr3 is left out: none of its Level 2 images could be read
#: by the pipeline in the 2026-10-30 survey run (every qr3 tile came back with no readable images).
AUTO_RELEASES = ("qr2",)

#: Exposures closer together than this belong to the same visit.
VISIT_GAP_HOURS = 1.0


@dataclass
class PlannedTile:
    field_id: str
    ra_deg: float
    dec_deg: float
    elon_deg: float
    elat_deg: float
    segment: str  # "<release>/<segment>"
    n_exposures: int
    n_visits: int
    hours_spanned: float
    constellation: str
    first_mjd: float | None = None
    last_mjd: float | None = None


def tile_id(segment: str, elon: float, elat: float) -> str:
    """Stable, URL-safe id, e.g. sv-2025w231c-l3465-s012 (lambda 346.5, beta -1.2)."""
    seg = "".join(ch for ch in segment.lower() if ch.isalnum())
    hemi = "n" if elat >= 0 else "s"
    return f"sv-{seg}-l{round(elon * 10) % 3600:04d}-{hemi}{round(abs(elat) * 10):03d}"


def _visits(mjds: list[float]) -> int:
    if not mjds:
        return 0
    s = sorted(mjds)
    return 1 + sum(1 for a, b in zip(s, s[1:], strict=False) if (b - a) * 24 > VISIT_GAP_HOURS)


def _ecl_to_icrs(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    import astropy.units as u
    from astropy.coordinates import BarycentricMeanEcliptic, SkyCoord

    c = SkyCoord(lon=lon * u.deg, lat=lat * u.deg, frame=BarycentricMeanEcliptic()).icrs
    return c.ra.deg, c.dec.deg


def _icrs_to_ecl(ra: np.ndarray, dec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    import astropy.units as u
    from astropy.coordinates import BarycentricMeanEcliptic, SkyCoord

    c = SkyCoord(ra=ra * u.deg, dec=dec * u.deg).transform_to(BarycentricMeanEcliptic())
    return c.lon.deg, c.lat.deg


def _constellation(ra: float, dec: float) -> str:
    import astropy.units as u
    from astropy.coordinates import SkyCoord, get_constellation

    return str(get_constellation(SkyCoord(ra=ra * u.deg, dec=dec * u.deg)))


def plan_segment(
    index,
    segment: str,
    *,
    beta_max_deg: float = 4.0,
    step_deg: float = 0.3,
    min_exposures: int = 8,
    min_visits: int = 3,
) -> list[PlannedTile]:
    """Tiles of one week segment worth searching. ``index`` is a CoverageIndex."""
    from .data.index import DETECTOR_RADIUS_DEG, _angsep_deg

    release, seg = segment.split("/")
    index.index_segment(release, seg)
    exposures = [
        e
        for e in index._rows("WHERE segment = ? AND detector IN (1,2,3)", (seg,))
        if not (e.l2dqa and e.l2dqa.strip() != "Pass")
    ]
    if not exposures:
        log.warning("%s: no indexed exposures", segment)
        return []
    ra = np.array([e.ra_center for e in exposures], float)
    dec = np.array([e.dec_center for e in exposures], float)
    mjd = np.array([e.mjd_avg for e in exposures], float)
    wcs_cache: dict[int, object] = {}

    def covering(r0: float, d0: float) -> list[float]:
        """MJDs of exposures whose pixels (30 px from the edge) contain the position."""
        near_idx = np.nonzero(_angsep_deg(r0, d0, ra, dec) <= DETECTOR_RADIUS_DEG)[0]
        out = []
        for i in near_idx:
            w = wcs_cache.get(i)
            if w is None:
                w = wcs_cache[i] = exposures[i].wcs()
            x, y = w.all_world2pix([r0], [d0], 0)
            if 30 <= x[0] < 2010 and 30 <= y[0] < 2010:
                out.append(float(mjd[i]))
        return out

    lon, lat = _icrs_to_ecl(ra, dec)
    near = np.abs(lat) < beta_max_deg + DETECTOR_RADIUS_DEG
    if not near.any():
        return []
    lon, lat = lon[near], lat[near]
    # A week can cross the ecliptic in several places, so build the grid on the whole circle
    # and keep only grid longitudes within reach of an exposure.
    n_lon = round(360 / step_deg)
    grid_all = np.arange(n_lon) * step_deg
    reach = np.zeros(n_lon, bool)
    for x in lon:
        d = np.abs((grid_all - x + 180) % 360 - 180)
        reach |= d < DETECTOR_RADIUS_DEG + 0.2
    grid_lon = grid_all[reach]
    grid_lat = np.arange(-beta_max_deg, beta_max_deg + 1e-9, step_deg)
    tiles: list[PlannedTile] = []
    for gl in grid_lon:
        dlon = np.abs((lon - gl + 180) % 360 - 180)
        for gb in grid_lat:
            # Skip grid points far from any exposure center before the exact (WCS) check.
            if not np.any(
                (dlon < DETECTOR_RADIUS_DEG + 0.2) & (np.abs(lat - gb) < DETECTOR_RADIUS_DEG)
            ):
                continue
            elon = float(gl)
            r, d = _ecl_to_icrs(np.array([elon]), np.array([gb]))
            r0, d0 = float(r[0]), float(d[0])
            mjds = covering(r0, d0)
            visits = _visits(mjds)
            if len(mjds) < min_exposures or visits < min_visits:
                continue
            fid = tile_id(seg, float(elon), float(gb))
            tiles.append(
                PlannedTile(
                    field_id=fid,
                    ra_deg=round(r0, 4),
                    dec_deg=round(d0, 4),
                    elon_deg=round(float(elon), 3),
                    elat_deg=round(float(gb), 3),
                    segment=segment,
                    n_exposures=len(mjds),
                    n_visits=visits,
                    hours_spanned=round((max(mjds) - min(mjds)) * 24, 2),
                    constellation=_constellation(r0, d0),
                    first_mjd=round(min(mjds), 6),
                    last_mjd=round(max(mjds), 6),
                )
            )
    log.info("%s: %d tiles planned", segment, len(tiles))
    return tiles


def resolve_segments(specs: list[str], archive=None) -> list[str]:
    """Expand "auto:N" into N week segments spread evenly over every public release.

    Other entries ("qr2/2025W23_1C") pass through. Segments are listed from the public
    nasa-irsa-spherex bucket, so new weeks are picked up as IRSA releases them.
    """
    out: list[str] = []
    for spec in specs:
        if not spec.startswith("auto:"):
            out.append(spec)
            continue
        n = int(spec.split(":", 1)[1])
        if archive is None:
            from .data.s3 import S3Archive

            archive = S3Archive()
        _, releases = archive.list("")
        everything = [
            f"{rel}/{seg}"
            for rel in sorted(p.rstrip("/") for p in releases if p.rstrip("/") in AUTO_RELEASES)
            for seg in sorted(archive.level2_segments(rel))
        ]
        if len(everything) <= n:
            picked = everything
        else:
            picked = (
                [everything[round(i * (len(everything) - 1) / (n - 1))] for i in range(n)]
                if n > 1
                else everything[-1:]
            )
        log.info("auto:%d -> %s (of %d segments)", n, picked, len(everything))
        out.extend(picked)
    return list(dict.fromkeys(out))


def select_tiles(tiles: list[PlannedTile], max_tiles: int | None) -> list[PlannedTile]:
    """Best-covered tiles first (most visits, then nearest the ecliptic), taken round-robin
    across week segments so a cap never spends the whole budget on one week."""
    by_seg: dict[str, list[PlannedTile]] = {}
    for t in sorted(tiles, key=lambda t: (-t.n_visits, abs(t.elat_deg), -t.n_exposures)):
        by_seg.setdefault(t.segment, []).append(t)
    queues = [by_seg[k] for k in sorted(by_seg)]
    out: list[PlannedTile] = []
    i = 0
    while any(queues) and (max_tiles is None or len(out) < max_tiles):
        q = queues[i % len(queues)]
        if q:
            out.append(q.pop(0))
        i += 1
    return out


def plan(
    segments: list[str],
    out: Path,
    *,
    max_tiles: int | None = None,
    beta_max_deg: float = 4.0,
    step_deg: float = 0.3,
) -> list[PlannedTile]:
    from .data.index import CoverageIndex

    index = CoverageIndex()
    tiles: list[PlannedTile] = []
    for seg in resolve_segments(segments):
        tiles.extend(plan_segment(index, seg, beta_max_deg=beta_max_deg, step_deg=step_deg))
    tiles = select_tiles(tiles, max_tiles)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps([asdict(t) for t in tiles], indent=1) + "\n")
    return tiles


def _spec(t: PlannedTile) -> FieldSpec:
    hemisphere = "north" if t.elat_deg >= 0 else "south"
    return FieldSpec(
        field_id=t.field_id,
        name=f"Survey tile in {t.constellation}",
        blurb=(
            f"A 0.3 degree patch {abs(t.elat_deg):.1f} degrees {hemisphere} of the ecliptic in "
            f"{t.constellation}, imaged by SPHEREx {t.n_exposures} times in {t.n_visits} visits over "
            f"{t.hours_spanned:.0f} hours. Picked automatically by the survey because it was imaged "
            "often enough to follow a moving object."
        ),
        ra_deg=t.ra_deg,
        dec_deg=t.dec_deg,
        size_deg=0.3,
        segments=[t.segment],
        origin="run",
    )


@dataclass
class TileResult:
    field_id: str
    status: str  # kept | empty | failed
    candidates: int
    detail: str = ""
    #: The planned tile, so empty and failed tiles stay on the survey footprint.
    tile: PlannedTile | None = None


def _remove_outputs(out: Path, field_id: str) -> None:
    (out / "fields" / f"{field_id}.json").unlink(missing_ok=True)
    shutil.rmtree(out / "fields" / field_id, ignore_errors=True)
    for p in (out / "candidates").glob(f"{field_id}-c*"):
        shutil.rmtree(p) if p.is_dir() else p.unlink()


def _where(err: BaseException) -> str:
    """Innermost pipeline frame of a traceback, e.g. 'build.py:212 build'."""
    import traceback

    frames = [f for f in traceback.extract_tb(err.__traceback__) if "spherex_px" in f.filename]
    f = frames[-1] if frames else None
    return f"{Path(f.filename).name}:{f.lineno} {f.name}" if f else "?"


def build_share(plan_file: Path, shard: int, of: int, out: Path = DEFAULT_OUT) -> list[TileResult]:
    """Build tiles shard, shard+of, shard+2*of, ... of the plan; keep tiles with real movers."""
    tiles = [PlannedTile(**t) for t in json.loads(plan_file.read_text())]
    mine = tiles[shard::of]
    results: list[TileResult] = []
    for t in mine:
        try:
            _detail, cands = build_field(_spec(t), out)
        except NoReadableImages as err:
            _remove_outputs(out, t.field_id)
            results.append(TileResult(t.field_id, "empty", 0, str(err), t))
            continue
        except Exception as err:  # one bad tile must not sink the shard
            log.exception("%s failed", t.field_id)
            _remove_outputs(out, t.field_id)
            detail = f"{type(err).__name__}: {err} (at {_where(err)})"
            if os.environ.get("GITHUB_ACTIONS") == "true":
                # Annotations are readable from the public API without downloading logs.
                print(f"::warning title=tile {t.field_id} failed::{detail[:900]}", flush=True)
            results.append(TileResult(t.field_id, "failed", 0, detail, t))
            continue
        # A tile is kept for linked tracks only: two lone sightings (unconfirmed pairs) are too
        # weak to justify a field page on their own.
        weak = (S.Classification.likely_artifact, S.Classification.unconfirmed_pair)
        real = [c for c in cands if c.classification not in weak]
        if not real:
            _remove_outputs(out, t.field_id)
            results.append(TileResult(t.field_id, "empty", 0, tile=t))
            continue
        results.append(TileResult(t.field_id, "kept", len(real), tile=t))
        log.info("%s: kept, %d candidates", t.field_id, len(real))
    return results
