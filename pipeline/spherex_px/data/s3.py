"""Read access to IRSA's public SPHEREx bucket on AWS (nasa-irsa-spherex).

Only listings and byte ranges are fetched; whole files are never downloaded. Responses are
cached on disk because released Level 2 files do not change.
"""

from __future__ import annotations

import hashlib
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

from ..settings import get_settings
from .http import UpstreamError, request

#: Byte spans of each object already in the disk range cache (this process only).
_SPANS: dict[str, list[tuple[int, int, Path]]] = {}

_NS = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
LEVEL2_RE = re.compile(
    r"^(?P<release>qr\d+)/level2/(?P<segment>\d{4}W\d{2}_\d[A-Z])/(?P<version>[^/]+)/"
    r"(?P<detector>[1-6])/level2_(?P<obs_id>\d{4}W\d{2}_\d[A-Z]_\d{4}_\d+)D(?P=detector)_spx_"
    r"(?P=version)\.fits$"
)


@dataclass(frozen=True)
class Level2Key:
    key: str
    release: str
    segment: str
    version: str
    detector: int
    obs_id: str
    size: int | None = None

    @property
    def file(self) -> str:
        return self.key.rsplit("/", 1)[-1]

    @property
    def data_release(self) -> str:
        return self.release.upper()

    @classmethod
    def parse(cls, key: str, size: int | None = None) -> Level2Key | None:
        m = LEVEL2_RE.match(key)
        if not m:
            return None
        return cls(
            key=key,
            release=m["release"],
            segment=m["segment"],
            version=m["version"],
            detector=int(m["detector"]),
            obs_id=m["obs_id"],
            size=size,
        )


class S3Archive:
    def __init__(self, base_url: str | None = None, cache_dir: Path | None = None):
        settings = get_settings()
        self.base_url = (base_url or settings.s3_base_url).rstrip("/")
        self.cache_dir = (cache_dir or settings.cache_dir) / "s3"

    def url(self, key: str) -> str:
        return f"{self.base_url}/{key}"

    # -- listing ------------------------------------------------------------

    def list(
        self, prefix: str, delimiter: str | None = "/"
    ) -> tuple[list[tuple[str, int]], list[str]]:
        """Return ([(key, size)], [common prefixes]) under `prefix`, following pagination."""
        cache = self._cache_path("list", prefix, delimiter or "")
        if cache.exists():
            data = json.loads(cache.read_text())
            return [tuple(k) for k in data["keys"]], data["prefixes"]
        keys: list[tuple[str, int]] = []
        prefixes: list[str] = []
        token = None
        while True:
            params = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
            if delimiter:
                params["delimiter"] = delimiter
            if token:
                params["continuation-token"] = token
            resp = request("GET", self.base_url + "/", params=params)
            if resp.status_code != 200:
                raise UpstreamError(f"S3 list {prefix!r}: HTTP {resp.status_code}")
            root = ET.fromstring(resp.content)
            for c in root.findall("s3:Contents", _NS):
                keys.append((c.findtext("s3:Key", "", _NS), int(c.findtext("s3:Size", "0", _NS))))
            for p in root.findall("s3:CommonPrefixes", _NS):
                prefixes.append(p.findtext("s3:Prefix", "", _NS))
            if root.findtext("s3:IsTruncated", "false", _NS) != "true":
                break
            token = root.findtext("s3:NextContinuationToken", None, _NS)
        self._write(cache, json.dumps({"keys": keys, "prefixes": prefixes}).encode())
        return keys, prefixes

    def level2_segments(self, release: str) -> list[str]:
        """Week segments (e.g. '2025W23_1C') available for a release ('qr2', 'qr3')."""
        _, prefixes = self.list(f"{release}/level2/")
        return [p.rstrip("/").rsplit("/", 1)[-1] for p in prefixes]

    def level2_keys(self, release: str, segment: str, detector: int) -> list[Level2Key]:
        _, versions = self.list(f"{release}/level2/{segment}/")
        out: list[Level2Key] = []
        for v in versions:
            keys, _ = self.list(f"{v}{detector}/", delimiter=None)
            out.extend(k for k in (Level2Key.parse(key, size) for key, size in keys) if k)
        return out

    # -- byte ranges ---------------------------------------------------------

    def read_range(self, key: str, start: int, stop: int) -> bytes:
        """Bytes [start, stop) of an object.

        Served from the disk cache when an earlier read of this object (in this process)
        already covered the range: a survey block reads wide row bands once, and the tiles
        built inside it afterwards slice them instead of downloading again.
        """
        if stop <= start:
            return b""
        cache = self._cache_path("range", key, f"{start}-{stop}")
        if cache.exists():
            return cache.read_bytes()
        for a, b, path in _SPANS.get(key, ()):
            if a <= start and stop <= b and path.exists():
                with path.open("rb") as fh:
                    fh.seek(start - a)
                    return fh.read(stop - start)
        resp = request("GET", self.url(key), headers={"Range": f"bytes={start}-{stop - 1}"})
        if resp.status_code not in (200, 206):
            raise UpstreamError(f"S3 range {key} [{start},{stop}): HTTP {resp.status_code}")
        data = resp.content
        if resp.status_code == 200:  # server ignored the range
            data = data[start:stop]
        if len(data) != stop - start:
            # A short read is fine only when the range ran past the end of the object.
            total = resp.headers.get("Content-Range", "").rpartition("/")[2]
            at_eof = total.isdigit() and start + len(data) == int(total)
            if not at_eof:
                raise UpstreamError(
                    f"S3 range {key}: expected {stop - start} bytes, got {len(data)}"
                )
        self._write(cache, data)
        if len(data) == stop - start:
            _SPANS.setdefault(key, []).append((start, stop, cache))
        return data

    # -- cache ---------------------------------------------------------------

    def _cache_path(self, kind: str, *parts: str) -> Path:
        digest = hashlib.sha256("\x00".join(parts).encode()).hexdigest()
        return self.cache_dir / kind / digest[:2] / digest

    @staticmethod
    def _write(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)


def forget_cached_ranges() -> None:
    """Call after deleting the range cache directory."""
    _SPANS.clear()
