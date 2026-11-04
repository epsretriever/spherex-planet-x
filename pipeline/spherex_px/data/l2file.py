"""SPHEREx Level 2 spectral image files, read with byte ranges.

A file is a multi-extension FITS with PRIMARY, IMAGE, FLAGS, VARIANCE, ZODI, PSF, WCS-WAVE.
The image extensions are uncompressed 2040 x 2040 arrays, so a cutout only needs the rows it
spans: one contiguous byte range per extension.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass, field
from functools import cached_property

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS, FITSFixedWarning

from .flags import bits_from_header
from .s3 import Level2Key, S3Archive
from .spectral import WaveTable

log = logging.getLogger(__name__)

BLOCK = 2880
_DTYPES = {8: ">u1", 16: ">i2", 32: ">i4", 64: ">i8", -32: ">f4", -64: ">f8"}
IMAGE_EXTS = ("IMAGE", "FLAGS", "VARIANCE", "ZODI")


@dataclass(frozen=True)
class HDUInfo:
    name: str
    header_offset: int
    data_offset: int
    data_size: int  # padded to a whole number of FITS blocks
    header: str  # raw header cards


def _data_nbytes(header: fits.Header) -> int:
    naxis = header.get("NAXIS", 0)
    if naxis == 0:
        return 0
    n = abs(header["BITPIX"]) // 8
    for i in range(1, naxis + 1):
        n *= header[f"NAXIS{i}"]
    n = (n + header.get("PCOUNT", 0)) * header.get("GCOUNT", 1)
    return int(math.ceil(n / BLOCK) * BLOCK)


def _find_end(buf: bytes) -> int | None:
    for i in range(0, len(buf) - 79, 80):
        if buf[i : i + 8] == b"END     ":
            return i
    return None


def _quiet_wcs(header: fits.Header, key: str = " ") -> WCS:
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FITSFixedWarning)
        return WCS(header, key=key, relax=True)


def read_image_header(archive: S3Archive, key: str, chunk: int = 8 * BLOCK) -> fits.Header:
    """Header of the first extension (IMAGE) without walking the whole file."""
    buf = archive.read_range(key, 0, chunk)
    end = _find_end(buf)
    if end is None:
        raise ValueError(f"{key}: no END card in primary header")
    start = int(math.ceil((end + 80) / BLOCK) * BLOCK)
    while True:
        end = _find_end(buf[start:])
        if end is not None:
            stop = start + int(math.ceil((end + 80) / BLOCK) * BLOCK)
            return fits.Header.fromstring(buf[start:stop].decode("ascii"))
        more = archive.read_range(key, len(buf), len(buf) + chunk)
        if not more:
            raise ValueError(f"{key}: no END card in IMAGE header")
        buf += more


@dataclass
class Cutout:
    """Pixels of one exposure around a sky position (native detector pixels)."""

    key: Level2Key
    x0: int
    x1: int
    y0: int
    y1: int
    image: np.ndarray  # MJy/sr, zodi NOT subtracted
    flags: np.ndarray
    variance: np.ndarray  # (MJy/sr)^2
    zodi: np.ndarray  # MJy/sr
    wcs: WCS  # celestial WCS for the cutout array (0-based pixel = cutout index)
    header: fits.Header  # IMAGE header of the full file
    flag_bits: dict[str, int]
    wavelength_um: np.ndarray
    bandwidth_um: np.ndarray
    psf: np.ndarray | None = None  # oversampled PSF for the zone nearest the cutout center
    psf_oversample: int = 10
    meta: dict = field(default_factory=dict)

    @property
    def shape(self) -> tuple[int, int]:
        return self.image.shape

    def native_xy(self, x_cut: np.ndarray, y_cut: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return np.asarray(x_cut) + self.x0, np.asarray(y_cut) + self.y0


class L2File:
    def __init__(self, key: Level2Key, archive: S3Archive | None = None):
        self.key = key
        self.archive = archive or S3Archive()

    @property
    def url(self) -> str:
        return self.archive.url(self.key.key)

    # -- structure -----------------------------------------------------------

    @cached_property
    def layout(self) -> dict[str, HDUInfo]:
        cache = self.archive.cache_dir / "layout" / f"{self.key.file}.json"
        if cache.exists():
            return {d["name"]: HDUInfo(**d) for d in json.loads(cache.read_text())}
        hdus: list[HDUInfo] = []
        offset = 0
        total = self.key.size
        while total is None or offset < total:
            buf = b""
            end = None
            while end is None:
                chunk = self.archive.read_range(
                    self.key.key, offset + len(buf), offset + len(buf) + 8 * BLOCK
                )
                if not chunk:
                    break
                buf += chunk
                end = _find_end(buf)
            if end is None:
                break
            hlen = int(math.ceil((end + 80) / BLOCK) * BLOCK)
            text = buf[:hlen].decode("ascii")
            header = fits.Header.fromstring(text)
            name = (
                "PRIMARY" if offset == 0 else str(header.get("EXTNAME", f"HDU{len(hdus)}")).strip()
            )
            size = _data_nbytes(header)
            hdus.append(HDUInfo(name, offset, offset + hlen, size, text))
            offset += hlen + size
            if name == "WCS-WAVE":
                break
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps([h.__dict__ for h in hdus]))
        return {h.name: h for h in hdus}

    def header(self, ext: str = "IMAGE") -> fits.Header:
        return fits.Header.fromstring(self.layout[ext].header)

    @cached_property
    def image_header(self) -> fits.Header:
        """IMAGE header. Reads only the first header blocks unless the layout is already known."""
        if "layout" in self.__dict__:
            return self.header("IMAGE")
        return read_image_header(self.archive, self.key.key)

    @cached_property
    def wcs(self) -> WCS:
        return _quiet_wcs(self.image_header)

    @cached_property
    def flag_bits(self) -> dict[str, int]:
        return bits_from_header(self.header("FLAGS"))

    @cached_property
    def wave_table(self) -> WaveTable:
        info = self.layout["WCS-WAVE"]
        hdr = fits.Header.fromstring(info.header)
        nbytes = hdr["NAXIS1"] * hdr["NAXIS2"]
        data = self.archive.read_range(self.key.key, info.data_offset, info.data_offset + nbytes)
        return WaveTable.from_bintable_bytes(hdr, data)

    @property
    def shape(self) -> tuple[int, int]:
        h = self.image_header
        return int(h["NAXIS2"]), int(h["NAXIS1"])

    # -- pixels --------------------------------------------------------------

    def read_rows(self, ext: str, y0: int, y1: int) -> np.ndarray:
        """Full-width rows [y0, y1) of an image extension, in native byte order."""
        info = self.layout[ext]
        hdr = fits.Header.fromstring(info.header)
        nx = int(hdr["NAXIS1"])
        dtype = np.dtype(_DTYPES[int(hdr["BITPIX"])])
        row = nx * dtype.itemsize
        raw = self.archive.read_range(
            self.key.key, info.data_offset + y0 * row, info.data_offset + y1 * row
        )
        arr = np.frombuffer(raw, dtype=dtype).reshape(y1 - y0, nx).astype(dtype.newbyteorder("="))
        bzero = hdr.get("BZERO")
        if bzero:
            arr = arr.astype(np.int64) + int(bzero)
        return arr

    def read_psf_plane(self, index: int) -> np.ndarray:
        info = self.layout["PSF"]
        hdr = fits.Header.fromstring(info.header)
        nx, ny = int(hdr["NAXIS1"]), int(hdr["NAXIS2"])
        plane = nx * ny * 4
        raw = self.archive.read_range(
            self.key.key, info.data_offset + index * plane, info.data_offset + (index + 1) * plane
        )
        return np.frombuffer(raw, dtype=">f4").reshape(ny, nx).astype(np.float32)

    def psf_zone(self, x_native: float, y_native: float) -> int:
        """0-based PSF plane index whose zone center is nearest (XCTR_i/YCTR_i are 1-based px)."""
        hdr = self.header("PSF")
        n = int(hdr["NAXIS3"])
        xc = np.array([hdr[f"XCTR_{i}"] for i in range(1, n + 1)])
        yc = np.array([hdr[f"YCTR_{i}"] for i in range(1, n + 1)])
        d = (xc - (x_native + 1)) ** 2 + (yc - (y_native + 1)) ** 2
        return int(np.argmin(d))

    def pixel_box(self, ra_deg: float, dec_deg: float, size_deg: float, margin_px: int = 4):
        """0-based [x0, x1) x [y0, y1) box covering a square of side size_deg, clipped."""
        ny, nx = self.shape
        half = size_deg / 2.0
        cosd = max(math.cos(math.radians(dec_deg)), 1e-6)
        corners_ra = ra_deg + np.array([-1, 1, 1, -1, 0, -1, 1, 0]) * half / cosd
        corners_dec = dec_deg + np.array([-1, -1, 1, 1, -1, 0, 0, 1]) * half
        x, y = self.wcs.all_world2pix(corners_ra, corners_dec, 0)
        if not (np.all(np.isfinite(x)) and np.all(np.isfinite(y))):
            return None
        x0 = max(int(math.floor(x.min())) - margin_px, 0)
        x1 = min(int(math.ceil(x.max())) + margin_px + 1, nx)
        y0 = max(int(math.floor(y.min())) - margin_px, 0)
        y1 = min(int(math.ceil(y.max())) + margin_px + 1, ny)
        if x1 <= x0 or y1 <= y0:
            return None
        return x0, x1, y0, y1

    def contains(self, ra_deg: float, dec_deg: float, edge_px: float = 0) -> bool:
        x, y = self.wcs.all_world2pix([ra_deg], [dec_deg], 0)
        ny, nx = self.shape
        return bool(edge_px <= x[0] < nx - edge_px and edge_px <= y[0] < ny - edge_px)

    def cutout(
        self,
        ra_deg: float,
        dec_deg: float,
        size_deg: float,
        with_psf: bool = True,
        with_zodi: bool = True,
    ) -> Cutout | None:
        """Pixels around a position. ``with_zodi=False`` skips the ZODI plane (a quarter of
        the bytes) and leaves zodi at 0: the survey's search pass relies on the 24 px
        Background2D, which absorbs the smooth zodiacal light anyway."""
        box = self.pixel_box(ra_deg, dec_deg, size_deg)
        if box is None:
            return None
        x0, x1, y0, y1 = box
        exts = IMAGE_EXTS if with_zodi else tuple(e for e in IMAGE_EXTS if e != "ZODI")
        arrays = {ext: self.read_rows(ext, y0, y1)[:, x0:x1] for ext in exts}
        if "ZODI" not in arrays:
            arrays["ZODI"] = np.zeros(arrays["IMAGE"].shape, np.float32)
        wcs = self.wcs.slice((slice(y0, y1), slice(x0, x1)))  # shifts CRPIX and SIP together
        lam, bw = self.wave_table.grid(x0, x1, y0, y1)
        psf = None
        if with_psf:
            psf = self.read_psf_plane(self.psf_zone((x0 + x1) / 2, (y0 + y1) / 2))
        return Cutout(
            key=self.key,
            x0=x0,
            x1=x1,
            y0=y0,
            y1=y1,
            image=arrays["IMAGE"].astype(np.float32),
            flags=arrays["FLAGS"].astype(np.int64),
            variance=arrays["VARIANCE"].astype(np.float32),
            zodi=arrays["ZODI"].astype(np.float32),
            wcs=wcs,
            header=self.image_header,
            flag_bits=self.flag_bits,
            wavelength_um=lam.astype(np.float32),
            bandwidth_um=bw.astype(np.float32),
            psf=psf,
            psf_oversample=int(self.header("PSF").get("OVERSAMP", 10)),
        )
