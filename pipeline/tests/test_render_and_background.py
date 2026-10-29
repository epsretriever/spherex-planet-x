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
