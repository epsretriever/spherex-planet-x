import numpy as np
from PIL import Image

from spherex_px.render import write_thumbnail, write_webp
from spherex_px.schemas import Stretch
from spherex_px.science.detect import row_background

STRETCH = Stretch(min=-0.05, max=1.0, softening=0.02)


def test_uncovered_pixels_are_transparent_and_neutral(tmp_path):
    data = np.full((8, 8), 0.5, dtype=np.float32)
    data[:, 6:] = np.nan  # outside the detector
    path = tmp_path / "x.webp"
    write_webp(data, STRETCH, path)
    img = np.array(Image.open(path).convert("RGBA"))
    alpha = img[..., 3]
    assert (alpha[:, 6:] == 0).all()
    assert (alpha[:, :6] == 255).all()
    # under the transparent pixels: the sky level (0 MJy/sr), not black or white
    sky = np.array(Image.open(path).convert("RGBA"))[0, 7, 0]
    assert 0 < sky < 128


def test_fully_covered_images_stay_grayscale(tmp_path):
    path = tmp_path / "y.webp"
    write_webp(np.zeros((4, 4), np.float32), STRETCH, path)
    assert Image.open(path).mode in ("L", "RGB")


def test_thumbnail_keeps_transparency(tmp_path):
    data = np.zeros((16, 16), np.float32)
    data[:4] = np.nan
    path = tmp_path / "t.webp"
    write_thumbnail(data, STRETCH, path, size=32)
    alpha = np.array(Image.open(path).convert("RGBA"))[..., 3]
    assert alpha.min() == 0 and alpha.max() == 255


def test_row_background_removes_edge_ramp_and_keeps_stars():
    rng = np.random.default_rng(0)
    ny, nx = 120, 200
    sci = rng.normal(0, 0.02, (ny, nx)).astype(np.float32)
    ramp = np.clip((np.arange(ny) - 90) / 30, 0, None) * 0.4  # +0.4 at the top edge
    sci += ramp[:, None].astype(np.float32)
    sci[60, 100] += 2.0  # a star
    bad = np.zeros_like(sci, dtype=bool)
    out = sci - row_background(sci, bad)
    assert abs(np.median(out[-1])) < 0.01
    assert abs(np.median(out[-15])) < 0.01
    assert out[60, 100] > 1.9  # the star survives


def test_edge_glow_rows_flags_only_noisy_rows_at_the_detector_edge():
    from types import SimpleNamespace

    from spherex_px.science.detect import edge_glow_rows

    ny, nx = 200, 50
    var = np.full((ny, nx), 6e-4, np.float32)
    var[-30:] = 3e-3  # raised noise in the last 30 detector rows
    var[100:110] = 3e-3  # raised noise in the middle: not an edge, must not be masked
    cut = SimpleNamespace(header={"NAXIS2": 2040}, y0=1840, y1=2040, variance=var)
    rows = edge_glow_rows(cut, np.zeros((ny, nx), bool))
    assert rows[-30:].all()
    assert not rows[:-30].any()
