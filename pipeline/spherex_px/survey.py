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
import math
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from . import schemas as S
from .build import DEFAULT_OUT, FieldSpec, build_field

log = logging.getLogger(__name__)

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
    # Exposures near the ecliptic only; unwrap longitude around their circular mean.
    near = np.abs(lat) < beta_max_deg + DETECTOR_RADIUS_DEG
    if not near.any():
        return []
    lon, lat = lon[near], lat[near]
    mean = math.degrees(math.atan2(np.sin(np.radians(lon)).mean(), np.cos(np.radians(lon)).mean()))
    rel = (lon - mean + 180) % 360 - 180
    lo, hi = rel.min() - 1.5, rel.max() + 1.5
    grid_lon = np.arange(math.floor(lo / step_deg) * step_deg, hi + 1e-9, step_deg)
    grid_lat = np.arange(-beta_max_deg, beta_max_deg + 1e-9, step_deg)
    tiles: list[PlannedTile] = []
    for gl in grid_lon:
        for gb in grid_lat:
            # Skip grid points far from any exposure center before the exact (WCS) check.
            if not np.any((np.abs(rel - gl) < 2.8) & (np.abs(lat - gb) < DETECTOR_RADIUS_DEG)):
                continue
            elon = (mean + gl) % 360
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
    for seg in segments:
        tiles.extend(plan_segment(index, seg, beta_max_deg=beta_max_deg, step_deg=step_deg))
    # Prefer the best-covered tiles near the ecliptic (most visits, then closest to beta = 0).
    tiles.sort(key=lambda t: (-t.n_visits, abs(t.elat_deg), -t.n_exposures))
    if max_tiles is not None:
        tiles = tiles[:max_tiles]
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


def build_share(plan_file: Path, shard: int, of: int, out: Path = DEFAULT_OUT) -> list[TileResult]:
    """Build tiles shard, shard+of, shard+2*of, ... of the plan; keep tiles with real movers."""
    tiles = [PlannedTile(**t) for t in json.loads(plan_file.read_text())]
    mine = tiles[shard::of]
    results: list[TileResult] = []
    for t in mine:
        try:
            _detail, cands = build_field(_spec(t), out)
        except Exception as err:  # one bad tile must not sink the shard
            log.exception("%s failed", t.field_id)
            _remove_outputs(out, t.field_id)
            results.append(TileResult(t.field_id, "failed", 0, f"{type(err).__name__}: {err}", t))
            continue
        real = [c for c in cands if c.classification != S.Classification.likely_artifact]
        if not real:
            _remove_outputs(out, t.field_id)
            results.append(TileResult(t.field_id, "empty", 0, tile=t))
            continue
        results.append(TileResult(t.field_id, "kept", len(real), tile=t))
        log.info("%s: kept, %d candidates", t.field_id, len(real))
    return results
