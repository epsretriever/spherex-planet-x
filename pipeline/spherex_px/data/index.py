"""Coverage index of SPHEREx exposures, built from Level 2 headers in the public S3 bucket.

IRSA TAP answers "which exposures cover this position?" directly. The offline pipeline
cannot always reach IRSA, so it builds its own index from the IMAGE headers (about 23 KB
per file, read with one byte range):

- a coarse table: every Nth exposure of one detector per week segment, recording the planned
  boresight ecliptic longitude (SPS_ELON). SPHEREx sweeps strips of constant ecliptic
  longitude, so this tells which segments can contain a target;
- a full table for the segments that matter: every exposure of detectors 1-3 (detectors 4-6
  see the same sky through the dichroic and are matched by obs_id).
"""

from __future__ import annotations

import json
import logging
import math
import sqlite3
import threading
from collections.abc import Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..settings import get_settings
from .l2file import L2File, _quiet_wcs
from .s3 import Level2Key, S3Archive

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS exposure (
    key TEXT PRIMARY KEY,
    release TEXT, segment TEXT, version TEXT, detector INTEGER, obs_id TEXT, size INTEGER,
    mjd_beg REAL, mjd_avg REAL, mjd_end REAL, date_avg TEXT, xposure REAL,
    ra_center REAL, dec_center REAL, sps_elon REAL, sps_elat REAL, sps_flags TEXT,
    l2dqa TEXT, header TEXT
);
CREATE INDEX IF NOT EXISTS exposure_seg ON exposure(segment, detector);
CREATE INDEX IF NOT EXISTS exposure_obs ON exposure(obs_id);
CREATE TABLE IF NOT EXISTS segment_done (release TEXT, segment TEXT, detector INTEGER, kind TEXT,
    PRIMARY KEY (release, segment, detector, kind));
"""

# Half-diagonal of a 2040 x 6.15" detector is about 2.47 deg.
DETECTOR_RADIUS_DEG = 2.6


@dataclass(frozen=True)
class Exposure:
    key: Level2Key
    mjd_beg: float
    mjd_avg: float
    mjd_end: float
    date_avg: str
    xposure: float
    ra_center: float
    dec_center: float
    sps_flags: str
    l2dqa: str
    header: str

    def wcs(self):
        from astropy.io import fits

        return _quiet_wcs(fits.Header.fromstring(self.header))


def _angsep_deg(ra1, dec1, ra2, dec2):
    ra1, dec1, ra2, dec2 = map(np.radians, (ra1, dec1, ra2, dec2))
    s = np.sin((dec2 - dec1) / 2) ** 2 + np.cos(dec1) * np.cos(dec2) * np.sin((ra2 - ra1) / 2) ** 2
    return np.degrees(2 * np.arcsin(np.sqrt(np.clip(s, 0, 1))))


class CoverageIndex:
    def __init__(self, path: Path | None = None, archive: S3Archive | None = None):
        self.path = path or get_settings().data_dir / "index.sqlite"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.archive = archive or S3Archive()
        self._lock = threading.Lock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.executescript(SCHEMA)

    # -- building --------------------------------------------------------------

    def _record(self, key: Level2Key) -> tuple:
        f = L2File(key, self.archive)
        h = f.image_header
        ra, dec = f.wcs.all_pix2world([1019.5], [1019.5], 0)
        return (
            key.key,
            key.release,
            key.segment,
            key.version,
            key.detector,
            key.obs_id,
            key.size,
            float(h["MJD-BEG"]),
            float(h["MJD-AVG"]),
            float(h["MJD-END"]),
            str(h["DATE-AVG"]),
            float(h.get("XPOSURE", 0.0)),
            float(ra[0]),
            float(dec[0]),
            float(h.get("SPS_ELON", math.nan)),
            float(h.get("SPS_ELAT", math.nan)),
            str(h.get("SPS_FLAGS", "")),
            str(h.get("L2DQAFLG", "")),
            h.tostring(),
        )

    def _insert(self, rows: Iterable[tuple]) -> None:
        with self._lock:
            self.db.executemany(
                "INSERT OR REPLACE INTO exposure VALUES (" + ",".join("?" * 19) + ")", rows
            )
            self.db.commit()

    def _done(self, release: str, segment: str, detector: int, kind: str) -> bool:
        cur = self.db.execute(
            "SELECT 1 FROM segment_done WHERE release=? AND segment=? AND detector=? AND kind=?",
            (release, segment, detector, kind),
        )
        return cur.fetchone() is not None

    def _mark(self, release: str, segment: str, detector: int, kind: str) -> None:
        with self._lock:
            self.db.execute(
                "INSERT OR REPLACE INTO segment_done VALUES (?,?,?,?)",
                (release, segment, detector, kind),
            )
            self.db.commit()

    def index_keys(self, keys: list[Level2Key], workers: int | None = None) -> int:
        workers = workers or get_settings().max_parallel_requests
        have = (
            {
                r[0]
                for r in self.db.execute(
                    "SELECT key FROM exposure WHERE key IN (%s)" % ",".join("?" * len(keys)),
                    [k.key for k in keys],
                )
            }
            if keys
            else set()
        )
        todo = [k for k in keys if k.key not in have]
        rows = []
        with ThreadPoolExecutor(workers) as ex:
            for i, row in enumerate(ex.map(self._safe_record, todo)):
                if row:
                    rows.append(row)
                if len(rows) >= 200:
                    self._insert(rows)
                    rows = []
                if i and i % 500 == 0:
                    log.info("indexed %d/%d headers", i, len(todo))
        self._insert(rows)
        return len(todo)

    def _safe_record(self, key: Level2Key) -> tuple | None:
        try:
            return self._record(key)
        except Exception as exc:  # one unreadable header must not stop an index build
            log.warning("skipping %s: %s", key.key, exc)
            return None

    def index_segment(
        self, release: str, segment: str, detectors: Iterable[int] = (1, 2, 3)
    ) -> None:
        for det in detectors:
            if self._done(release, segment, det, "full"):
                continue
            keys = self.archive.level2_keys(release, segment, det)
            log.info("indexing %s/%s D%d: %d files", release, segment, det, len(keys))
            self.index_keys(keys)
            self._mark(release, segment, det, "full")

    def index_coarse(self, release: str, every: int = 40, detector: int = 2) -> None:
        """Index every `every`-th exposure of one detector in every segment of a release."""
        for segment in self.archive.level2_segments(release):
            if self._done(release, segment, detector, f"coarse{every}") or self._done(
                release, segment, detector, "full"
            ):
                continue
            keys = self.archive.level2_keys(release, segment, detector)[::every]
            self.index_keys(keys)
            self._mark(release, segment, detector, f"coarse{every}")

    # -- queries ---------------------------------------------------------------

    def segments_near_elon(self, elon_deg: float, tol_deg: float = 4.0) -> list[tuple[str, str]]:
        """(release, segment) pairs whose sampled pointings came within tol of an ecliptic lon."""
        rows = self.db.execute(
            "SELECT DISTINCT release, segment, sps_elon FROM exposure"
        ).fetchall()
        hits = set()
        for release, segment, elon in rows:
            if elon is None or math.isnan(elon):
                continue
            d = abs((elon - elon_deg + 180) % 360 - 180)
            if d <= tol_deg:
                hits.add((release, segment))
        return sorted(hits)

    def _rows(self, where: str = "", params: tuple = ()) -> Iterator[Exposure]:
        cur = self.db.execute(
            "SELECT key, release, segment, version, detector, obs_id, size, mjd_beg, mjd_avg, mjd_end,"
            " date_avg, xposure, ra_center, dec_center, sps_flags, l2dqa, header FROM exposure "
            + where,
            params,
        )
        for r in cur:
            key = Level2Key(r[0], r[1], r[2], r[3], r[4], r[5], r[6])
            yield Exposure(key, r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15], r[16])

    def covering(
        self,
        ra_deg: float,
        dec_deg: float,
        edge_px: float = 0.0,
        segments: Iterable[str] | None = None,
    ) -> list[Exposure]:
        """Indexed exposures (detectors 1-3) whose pixels contain the position."""
        where, params = "", ()
        if segments is not None:
            segs = list(segments)
            where = "WHERE segment IN (%s)" % ",".join("?" * len(segs))
            params = tuple(segs)
        out = []
        for e in self._rows(where, params):
            if _angsep_deg(ra_deg, dec_deg, e.ra_center, e.dec_center) > DETECTOR_RADIUS_DEG:
                continue
            x, y = e.wcs().all_world2pix([ra_deg], [dec_deg], 0)
            if edge_px <= x[0] < 2040 - edge_px and edge_px <= y[0] < 2040 - edge_px:
                out.append(e)
        out.sort(key=lambda e: e.mjd_avg)
        return out

    def stats(self) -> dict:
        n = self.db.execute("SELECT count(*), count(DISTINCT segment) FROM exposure").fetchone()
        return {"exposures": n[0], "segments": n[1]}


def dichroic_partner(key: Level2Key) -> Level2Key:
    """The detector 4-6 file that sees the same sky as a detector 1-3 file (same exposure)."""
    other = key.detector + 3 if key.detector <= 3 else key.detector - 3
    new_key = key.key.replace(f"/{key.detector}/level2_", f"/{other}/level2_").replace(
        f"_{key.obs_id}D{key.detector}_", f"_{key.obs_id}D{other}_"
    )
    # The partner's size is unknown (it is not the same as this file's), so leave it unset:
    # reading the layout then walks the file's headers to the end instead of stopping early.
    return Level2Key(new_key, key.release, key.segment, key.version, other, key.obs_id, None)


def to_json(exposures: list[Exposure]) -> str:
    return json.dumps(
        [
            {"key": e.key.key, "obs_id": e.key.obs_id, "detector": e.key.detector, "mjd": e.mjd_avg}
            for e in exposures
        ]
    )
