"""WebP rendering with a fixed asinh stretch (shared by every epoch of a field)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from .schemas import Stretch

NAN_GRAY = 24  # masked or uncovered pixels: dark neutral gray


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
    out = (y * 255).round().astype(np.uint8)
    out[~np.isfinite(data)] = NAN_GRAY
    return out


def write_webp(
    data: np.ndarray, stretch: Stretch, path: Path, flip_y: bool = True, quality: int = 90
) -> None:
    """Write a grayscale WebP. FITS row 0 is the bottom, so flip to put north up."""
    img = to_uint8(data, stretch)
    if flip_y:
        img = img[::-1]
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img, mode="L").save(path, format="WEBP", quality=quality, method=6)


def write_thumbnail(data: np.ndarray, stretch: Stretch, path: Path, size: int = 256) -> None:
    img = to_uint8(data, stretch)[::-1]
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img, mode="L").resize((size, size), Image.Resampling.LANCZOS).save(
        path, format="WEBP", quality=85, method=6
    )
