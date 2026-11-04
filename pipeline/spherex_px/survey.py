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


def _spread_order(n: int) -> list[int]:
    """0..n-1 in an order that spreads early picks over the whole range (bit-reversal), so the
    first runs cover the year (and so the whole ecliptic) before filling in neighbouring weeks."""
    bits = max(1, (n - 1).bit_length())
    order = sorted(range(1 << bits), key=lambda i: int(f"{i:0{bits}b}"[::-1], 2))
    return [i for i in order if i < n]


def all_segments(archive=None) -> list[str]:
    """Every week segment of the releases the survey reads, oldest first."""
    if archive is None:
        from .data.s3 import S3Archive

        archive = S3Archive()
    _, releases = archive.list("")
    return [
        f"{rel}/{seg}"
        for rel in sorted(p.rstrip("/") for p in releases if p.rstrip("/") in AUTO_RELEASES)
        for seg in sorted(archive.level2_segments(rel))
    ]


def resolve_segments(
    specs: list[str], archive=None, state: dict[str, dict] | None = None
) -> list[str]:
    """Expand "auto:N" and "next:N" into week segments.

    - ``auto:N``: N segments spread evenly over every public release (always the same ones).
    - ``next:N``: the N segments the survey should search next, from the segment ledger
      (``state``, survey/segments.json): segments never planned first, in an order spread
      over the year, then segments planned but not finished (fewest tiles searched first).
      Finished segments are skipped, so repeated runs keep moving to new sky.

    Other entries ("qr2/2025W23_1C") pass through. Segments are listed from the public
    nasa-irsa-spherex bucket, so new weeks are picked up as IRSA releases them.
    """
    out: list[str] = []
    for spec in specs:
        if spec.startswith("next:"):
            n = int(spec.split(":", 1)[1])
            everything = all_segments(archive)
            state = state or {}
            fresh = [everything[i] for i in _spread_order(len(everything))]
            fresh = [s for s in fresh if s not in state]
            partial = sorted(
                (s for s in everything if s in state and not state[s].get("complete")),
                key=lambda s: (state[s].get("searched", 0), s),
            )
            picked = (partial[:1] + fresh + partial[1:])[:n]
            log.info("next:%d -> %s (%d fresh, %d partial)", n, picked, len(fresh), len(partial))
            out.extend(picked)
            continue
        if not spec.startswith("auto:"):
            out.append(spec)
            continue
        n = int(spec.split(":", 1)[1])
        everything = all_segments(archive)
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


def select_blocks(tiles: list[PlannedTile], max_tiles: int | None) -> list[PlannedTile]:
    """Whole search blocks (see BLOCK), best-covered first, round-robin across segments, until
    max_tiles: a block is searched in one read, so it is never split between runs."""
    by_seg: dict[str, list[list[PlannedTile]]] = {}
    for b in group_blocks(tiles):
        by_seg.setdefault(b[0].segment, []).append(b)
    for blocks in by_seg.values():
        blocks.sort(key=lambda b: (-len(b), min(abs(t.elat_deg) for t in b), b[0].field_id))
    queues = [by_seg[k] for k in sorted(by_seg)]
    out: list[PlannedTile] = []
    i = 0
    while any(queues) and (max_tiles is None or len(out) < max_tiles):
        q = queues[i % len(queues)]
        if q:
            out.extend(q.pop(0))
        i += 1
    return out


def plan(
    segments: list[str],
    out: Path,
    *,
    max_tiles: int | None = None,
    beta_max_deg: float = 4.0,
    step_deg: float = 0.3,
    data_dir: Path | None = None,
) -> list[PlannedTile]:
    """Plan tiles not searched before (incremental): tiles in the footprint ledger with a result
    (kept or empty) are skipped; failed ones are retried. Writes the plan and, next to it,
    ``<plan>-meta.json`` with every segment's planned tile count for the segment ledger."""
    from .data.index import CoverageIndex
    from .ledger import load_footprint, load_segments

    data_dir = data_dir or DEFAULT_OUT
    done = {t.tile_id for t in load_footprint(data_dir).tiles if t.status != "failed"}
    index = CoverageIndex()
    tiles: list[PlannedTile] = []
    meta: dict[str, dict] = {}
    for seg in resolve_segments(segments, state=load_segments(data_dir)):
        seg_tiles = plan_segment(index, seg, beta_max_deg=beta_max_deg, step_deg=step_deg)
        todo = [t for t in seg_tiles if t.field_id not in done]
        meta[seg] = {"planned": len(seg_tiles), "already_searched": len(seg_tiles) - len(todo)}
        tiles.extend(todo)
    tiles = select_blocks(tiles, max_tiles)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps([asdict(t) for t in tiles], indent=1) + "\n")
    plan_meta_path(out).write_text(json.dumps(meta, indent=1) + "\n")
    return tiles


def plan_meta_path(plan_file: Path) -> Path:
    return plan_file.with_name(plan_file.stem + "-meta.json")


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


#: Survey tiles are searched in blocks of up to BLOCK x BLOCK neighbouring tiles of one week segment.
#: SPHEREx files store full-width detector rows, so one wide row band per exposure costs a
#: fraction of the bytes of separate tile reads; only tiles where the block search finds a
#: real mover are then built in full (rendered images, stamps, orbits).
BLOCK = 4
TILE_STEP_DEG = 0.3


def group_blocks(tiles: list[PlannedTile], block: int = BLOCK) -> list[list[PlannedTile]]:
    groups: dict[tuple, list[PlannedTile]] = {}
    for t in tiles:
        i = round(t.elon_deg / TILE_STEP_DEG)
        j = round(t.elat_deg / TILE_STEP_DEG)
        groups.setdefault((t.segment, i // block, j // block), []).append(t)
    return [sorted(groups[k], key=lambda t: t.field_id) for k in sorted(groups)]


def _block_spec(tiles: list[PlannedTile]) -> FieldSpec:
    if len(tiles) == 1:
        return _spec(tiles[0])
    ra = np.radians([t.ra_deg for t in tiles])
    dec = np.radians([t.dec_deg for t in tiles])
    v = np.array([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)]).sum(axis=1)
    rc = float(np.degrees(np.arctan2(v[1], v[0])) % 360)
    dc = float(np.degrees(np.arctan2(v[2], np.hypot(v[0], v[1]))))
    cosd = max(np.cos(np.radians(dc)), 1e-6)
    off = [max(abs(((t.ra_deg - rc + 180) % 360 - 180) * cosd), abs(t.dec_deg - dc)) for t in tiles]
    # Half a (possibly rotated) tile around the outermost tile center.
    size = 2 * (max(off) + TILE_STEP_DEG / 2 * 1.42)
    return FieldSpec(
        field_id=f"block-{tiles[0].field_id}",
        name="survey block",
        blurb="",
        ra_deg=round(rc, 5),
        dec_deg=round(dc, 5),
        size_deg=round(size, 4),
        segments=[tiles[0].segment],
        origin="run",
    )


def _clear_range_cache() -> None:
    from .data.s3 import forget_cached_ranges
    from .settings import get_settings

    shutil.rmtree(get_settings().cache_dir / "s3" / "range", ignore_errors=True)
    forget_cached_ranges()


WEAK = (S.Classification.likely_artifact, S.Classification.unconfirmed_pair)


def _build_tile(
    t: PlannedTile, out: Path, center: tuple[float, float] | None = None, track_filter=None
) -> TileResult:
    """Full build of one tile (images, stamps, orbits); kept only with a real mover."""
    spec = _spec(t)
    if center is not None:
        spec.ra_deg, spec.dec_deg = round(center[0], 5), round(center[1], 5)
    try:
        _detail, cands = build_field(spec, out, track_filter=track_filter)
    except NoReadableImages as err:
        _remove_outputs(out, t.field_id)
        return TileResult(t.field_id, "empty", 0, str(err), t)
    except Exception as err:  # one bad tile must not sink the shard
        log.exception("%s failed", t.field_id)
        _remove_outputs(out, t.field_id)
        detail = f"{type(err).__name__}: {err} (at {_where(err)})"
        if os.environ.get("GITHUB_ACTIONS") == "true":
            # Annotations are readable from the public API without downloading logs.
            print(f"::warning title=tile {t.field_id} failed::{detail[:900]}", flush=True)
        return TileResult(t.field_id, "failed", 0, detail, t)
    # A tile is kept for linked tracks only: two lone sightings (unconfirmed pairs) are too
    # weak to justify a field page on their own.
    real = [c for c in cands if c.classification not in WEAK]
    if not real:
        _remove_outputs(out, t.field_id)
        return TileResult(t.field_id, "empty", 0, tile=t)
    log.info("%s: kept, %d candidates", t.field_id, len(real))
    return TileResult(t.field_id, "kept", len(real), tile=t)


def _published_positions(out: Path, field_id: str) -> list[tuple[float, float]]:
    pos = []
    for p in (out / "candidates").glob(f"{field_id}-c*.json"):
        d = json.loads(p.read_text())["detections"]
        pos.append(
            (
                float(np.median([x["ra_deg"] for x in d])),
                float(np.median([x["dec_deg"] for x in d])),
            )
        )
    return pos


def search_block(tiles: list[PlannedTile], out: Path) -> list[TileResult]:
    """Search a block of tiles in one light pass; build only the tiles holding a real mover."""
    from .build import FieldBuilder
    from .science.grid import angular_sep_arcsec

    spec = _block_spec(tiles)
    try:
        fb = FieldBuilder(
            spec, out, light=True, cover_points=[(t.ra_deg, t.dec_deg) for t in tiles]
        )
        epochs, tracks = fb.search()
        hits: dict[str, list[tuple[float, float]]] = {}
        for tr in tracks:
            if fb.classify(tr, epochs) in WEAK:
                continue
            ra = float(np.median([s.ra for s in tr.sightings]))
            dec = float(np.median([s.dec for s in tr.sightings]))
            sep = angular_sep_arcsec(ra, dec, [t.ra_deg for t in tiles], [t.dec_deg for t in tiles])
            hits.setdefault(tiles[int(np.argmin(sep))].field_id, []).append((ra, dec))
    except NoReadableImages as err:
        return [TileResult(t.field_id, "empty", 0, str(err), t) for t in tiles]
    except Exception as err:
        log.exception("%s failed", spec.field_id)
        detail = f"{type(err).__name__}: {err} (at {_where(err)})"
        if os.environ.get("GITHUB_ACTIONS") == "true":
            print(f"::warning title=block {spec.field_id} failed::{detail[:900]}", flush=True)
        return [TileResult(t.field_id, "failed", 0, detail, t) for t in tiles]
    finally:
        epochs = tracks = None  # free the block's pixels before the full builds
    ras = [t.ra_deg for t in tiles]
    decs = [t.dec_deg for t in tiles]

    def owner(ra: float, dec: float) -> str:
        return tiles[int(np.argmin(angular_sep_arcsec(ra, dec, ras, decs)))].field_id

    def belongs_to(fid: str):
        # A track goes to the tile nearest it; a tile also keeps tracks whose nearest tile
        # is not being built (the block search missed them there).
        def keep(ra: float, dec: float) -> bool:
            if (
                claimed
                and np.min(
                    angular_sep_arcsec(ra, dec, [c[0] for c in claimed], [c[1] for c in claimed])
                )
                < 30
            ):
                return False  # already published from another tile of this block
            o = owner(ra, dec)
            return o == fid or o not in hits

        return keep

    claimed: list[tuple[float, float]] = []
    results = []
    for t in tiles:
        pts = hits.get(t.field_id)
        if not pts:
            results.append(TileResult(t.field_id, "empty", 0, tile=t))
            continue
        # Center the field on its movers (by vector mean), so a track near a tile edge stays inside.
        ra = np.radians([p[0] for p in pts])
        dec = np.radians([p[1] for p in pts])
        v = np.array([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)]).sum(axis=1)
        center = (
            float(np.degrees(np.arctan2(v[1], v[0])) % 360),
            float(np.degrees(np.arctan2(v[2], np.hypot(v[0], v[1])))),
        )
        r = _build_tile(t, out, center, belongs_to(t.field_id))
        claimed.extend(_published_positions(out, t.field_id))
        results.append(r)
    return results


def build_share(
    plan_file: Path,
    shard: int,
    of: int,
    out: Path = DEFAULT_OUT,
    *,
    block: int = BLOCK,
    deadline_s: float | None = None,
) -> list[TileResult]:
    """Search blocks shard, shard+of, ... of the plan; keep tiles with real movers.

    With ``deadline_s`` no new block starts after that many seconds: tiles not reached are left
    out of the report, so they stay unsearched in the ledger and the next run picks them up.
    """
    import time

    t0 = time.monotonic()
    tiles = [PlannedTile(**t) for t in json.loads(plan_file.read_text())]
    blocks = group_blocks(tiles, block)[shard::of]
    results: list[TileResult] = []
    for i, b in enumerate(blocks):
        if deadline_s is not None and time.monotonic() - t0 > deadline_s:
            log.warning("deadline reached: %d of %d blocks searched", i, len(blocks))
            break
        # Image bytes read for one block are not reused by the next; dropping them keeps a
        # shard inside a CI runner's disk.
        _clear_range_cache()
        results.extend(search_block(b, out))
    _clear_range_cache()
    return results
