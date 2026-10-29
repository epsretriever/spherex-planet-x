"""WebP rendering with a fixed asinh stretch (shared by every epoch of a field)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from .schemas import Stretch


def choose_stretch(images: list[np.ndarray], softening: float = 0.02) -> Stretch:
    """Field-wide stretch: 1st percentile of sky to 99.7th percentile over all epochs."""
    vals = np.concatenate([im[np.isfinite(im)].ravel() for im in images if np.isfinite(im).any()])
    lo, hi = np.percentile(vals, [1.0, 99.7])
    if hi <= lo:
        hi = lo + 1e-3
    return Stretch(min=float(round(lo, 5)), max=float(round(hi, 5)), softening=softening)


def to_uint8(data: np.ndarray, stretch: Stretch) -> np.ndarray:
    x = (data - stretch.min) / (stretch.max - stretch.min)
    x = np.clip(x, 0, 1)
    a = stretch.softening
    y = np.arcsinh(x / a) / np.arcsinh(1 / a)
    return np.round(np.nan_to_num(y, nan=0.0) * 255).astype(np.uint8)


def _rgba(data: np.ndarray, stretch: Stretch, flip_y: bool) -> Image.Image:
    """Grayscale image with alpha: pixels with no SPHEREx data (NaN) are fully transparent.

    Underneath the transparent pixels the gray value is the field's sky level (0 MJy/sr after
    background subtraction), so a viewer that ignores alpha shows flat neutral sky, never a
    bright or black wedge.
    """
    covered = np.isfinite(data)
    gray = to_uint8(np.where(covered, data, 0.0), stretch)
    alpha = np.where(covered, 255, 0).astype(np.uint8)
    if flip_y:
        gray, alpha = gray[::-1], alpha[::-1]
    rgba = np.dstack([gray, gray, gray, alpha])
    return Image.fromarray(rgba, mode="RGBA")


def write_webp(
    data: np.ndarray, stretch: Stretch, path: Path, flip_y: bool = True, quality: int = 90
) -> None:
    """Write a WebP (north up: FITS row 0 is the bottom). NaN pixels become transparent."""
    path.parent.mkdir(parents=True, exist_ok=True)
    img = _rgba(data, stretch, flip_y)
    if img.getchannel("A").getextrema() == (255, 255):
        img = img.convert("L")  # fully covered: plain grayscale is smaller
    img.save(path, format="WEBP", quality=quality, method=6, exact=True)


def write_thumbnail(data: np.ndarray, stretch: Stretch, path: Path, size: int = 256) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = _rgba(data, stretch, flip_y=True)
    img = img.resize((size, size), Image.Resampling.LANCZOS)
    if img.getchannel("A").getextrema() == (255, 255):
        img = img.convert("L")
    img.save(path, format="WEBP", quality=85, method=6, exact=True)
