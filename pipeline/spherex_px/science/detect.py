"""Per-exposure source detection and photometry on SPHEREx cutouts.

SPHEREx pixels (6.15") are larger than the PSF FWHM (about 5-6"), so sources are undersampled:
detection runs on a lightly smoothed S/N map, centroids are flux-weighted in a 3x3 box, and
photometry uses a small circular aperture with an aperture correction measured from the
exposure's own PSF extension.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from astropy.convolution import Gaussian2DKernel, convolve
from astropy.stats import sigma_clipped_stats
from photutils.aperture import CircularAnnulus, CircularAperture, aperture_photometry
from photutils.background import Background2D, MedianBackground
from photutils.detection import find_peaks
from scipy import ndimage

from ..data.flags import HARD_BAD, SOFT_BAD, mask_for
from ..data.l2file import Cutout

ARCSEC_PER_RAD = 206264.80624709636


@dataclass(frozen=True)
class DetectParams:
    threshold_snr: float = 5.0
    aperture_radius_px: float = 1.5
    annulus_px: tuple[float, float] = (4.0, 7.0)
    background_box_px: int = 24
    smooth_sigma_px: float = 0.6
    min_separation_px: int = 2
    edge_px: int = 3
    astrometric_floor_arcsec: float = 0.8
    row_background: bool = True


@dataclass
class Detections:
    """Column arrays for all detections in one cutout (cutout pixel coordinates)."""

    x: np.ndarray
    y: np.ndarray
    ra: np.ndarray
    dec: np.ndarray
    flux_ujy: np.ndarray
    flux_err_ujy: np.ndarray
    snr: np.ndarray
    peak_frac: np.ndarray  # brightest pixel / total aperture flux (sharpness)
    flag_bits: np.ndarray
    n_flagged: np.ndarray
    n_hard: np.ndarray
    n_soft: np.ndarray
    wavelength_um: np.ndarray
    bandwidth_um: np.ndarray
    edge_dist_px: np.ndarray
    pos_err_arcsec: np.ndarray

    def __len__(self) -> int:
        return len(self.x)

    def take(self, idx) -> Detections:
        return Detections(**{k: v[idx] for k, v in self.__dict__.items()})

    @classmethod
    def empty(cls) -> Detections:
        z = np.zeros(0)
        return cls(*([z] * 16))


@dataclass
class Prepared:
    """Calibrated cutout ready for detection, injection and rendering."""

    cutout: Cutout
    sci: np.ndarray  # image - zodi - residual background, MJy/sr; NaN where unusable
    sigma: np.ndarray  # per-pixel noise, MJy/sr
    bad: np.ndarray  # hard-bad pixel mask
    soft: np.ndarray
    ujy_per_mjysr: float  # flux of one pixel at 1 MJy/sr, in uJy
    aperture_correction: float
    pixel_scale_arcsec: float
    psf_fwhm_arcsec: float


def pixel_solid_angle_sr(header) -> float:
    omega_arcsec2 = float(header.get("OMEGA_MEDIAN", 37.86))
    return omega_arcsec2 / ARCSEC_PER_RAD**2


def psf_encircled_fraction(psf: np.ndarray | None, oversample: int, radius_px: float) -> float:
    """Fraction of PSF light within radius_px native pixels, from the oversampled PSF plane."""
    if psf is None or not np.isfinite(psf).any() or psf.sum() <= 0:
        return 1.0
    ny, nx = psf.shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    cy, cx = (ny - 1) / 2, (nx - 1) / 2
    r = np.hypot(xx - cx, yy - cy) / oversample
    p = np.clip(psf, 0, None)
    return float(p[r <= radius_px].sum() / p.sum())


def row_background(sci: np.ndarray, bad: np.ndarray, smooth_rows: int = 5) -> np.ndarray:
    """Per-row residual background (2-D array broadcast along rows).

    Detector rows run along the linear variable filter, so each row is a single wavelength.
    Some detectors also have smooth excess light near an edge that the ZODI model and a 24 px
    Background2D box do not follow: QR2 detector 2 is about +0.4 MJy/sr brighter in its last
    ~30 rows (y > 2010). A sigma-clipped median per row (stars clipped), smoothed over a few
    rows, removes it without touching sources.
    """
    ny, nx = sci.shape
    prof = np.full(ny, np.nan)
    for y in range(ny):
        vals = sci[y][~bad[y] & np.isfinite(sci[y])]
        if vals.size >= 20:
            _, med, _ = sigma_clipped_stats(vals, sigma=3.0, maxiters=3)
            prof[y] = med
    if not np.isfinite(prof).any():
        return np.zeros_like(sci)
    prof = np.where(np.isfinite(prof), prof, np.nanmedian(prof))
    k = max(1, smooth_rows)
    pad = np.pad(prof, k // 2, mode="edge")
    smooth = np.array([np.median(pad[i : i + k]) for i in range(ny)])
    return np.repeat(smooth[:, None], nx, axis=1).astype(sci.dtype)


def prepare(cutout: Cutout, params: DetectParams = DetectParams()) -> Prepared:
    hard = (cutout.flags & mask_for(cutout.flag_bits, HARD_BAD)) != 0
    soft = (cutout.flags & mask_for(cutout.flag_bits, SOFT_BAD)) != 0
    img = cutout.image - cutout.zodi
    bad = hard | ~np.isfinite(img) | ~np.isfinite(cutout.variance) | (cutout.variance <= 0)
    img = np.where(bad, np.nan, img)
    sigma = np.sqrt(np.where(bad, np.nan, cutout.variance))
    box = min(params.background_box_px, max(8, min(img.shape) // 3))
    try:
        bkg = Background2D(
            img,
            box,
            filter_size=3,
            mask=bad,
            bkg_estimator=MedianBackground(),
            exclude_percentile=50,
        ).background
    except ValueError:
        _, med, _ = sigma_clipped_stats(img[~bad])
        bkg = np.full_like(img, med)
    sci = img - bkg
    if params.row_background:
        sci = sci - row_background(sci, bad)
    omega = pixel_solid_angle_sr(cutout.header)
    apcorr = psf_encircled_fraction(cutout.psf, cutout.psf_oversample, params.aperture_radius_px)
    scale = math.sqrt(omega) * ARCSEC_PER_RAD
    return Prepared(
        cutout=cutout,
        sci=sci.astype(np.float32),
        sigma=sigma.astype(np.float32),
        bad=bad,
        soft=soft,
        ujy_per_mjysr=omega * 1e12,
        aperture_correction=max(apcorr, 0.05),
        pixel_scale_arcsec=scale,
        psf_fwhm_arcsec=float(cutout.header.get("PSF_FWHM", 5.5)),
    )


def measure(
    prep: Prepared, x: np.ndarray, y: np.ndarray, params: DetectParams = DetectParams()
) -> Detections:
    """Aperture photometry and diagnostics at given cutout positions."""
    if len(x) == 0:
        return Detections.empty()
    c = prep.cutout
    sci0 = np.nan_to_num(prep.sci, nan=0.0)
    var0 = np.nan_to_num(prep.sigma**2, nan=0.0)
    pos = np.column_stack([x, y])
    ap = CircularAperture(pos, r=params.aperture_radius_px)
    ann = CircularAnnulus(pos, *params.annulus_px)
    phot = aperture_photometry(sci0, [ap], error=np.sqrt(var0))
    # local residual background from the annulus (median, masked)
    ann_masks = ann.to_mask(method="center")
    local = np.zeros(len(x))
    for i, m in enumerate(ann_masks):
        vals = m.get_values(np.where(prep.bad, np.nan, prep.sci))
        vals = vals[np.isfinite(vals)]
        local[i] = np.median(vals) if vals.size > 5 else 0.0
    area = ap.area
    raw = np.asarray(phot["aperture_sum_0"]) - local * area
    err = np.asarray(phot["aperture_sum_err_0"])
    k = prep.ujy_per_mjysr / prep.aperture_correction
    flux = raw * k
    flux_err = err * k
    snr = np.where(err > 0, raw / np.where(err > 0, err, 1), 0.0)

    # flags, sharpness, wavelength within the aperture
    n = len(x)
    flag_bits = np.zeros(n, dtype=np.int64)
    n_flag = np.zeros(n, dtype=int)
    n_hard = np.zeros(n, dtype=int)
    n_soft = np.zeros(n, dtype=int)
    peak = np.zeros(n)
    hard_m = mask_for(c.flag_bits, HARD_BAD)
    soft_m = mask_for(c.flag_bits, SOFT_BAD)
    for i, m in enumerate(ap.to_mask(method="center")):
        f = m.get_values(c.flags).astype(np.int64)
        s = m.get_values(sci0)
        flag_bits[i] = np.bitwise_or.reduce(f) if f.size else 0
        n_hard[i] = int(((f & hard_m) != 0).sum())
        n_soft[i] = int(((f & soft_m) != 0).sum())
        n_flag[i] = int(n_hard[i] + n_soft[i])
        peak[i] = s.max() if s.size else 0.0
    peak_frac = np.where(raw > 0, peak / np.where(raw > 0, raw, 1), 1.0)

    xi = np.clip(np.round(x).astype(int), 0, c.shape[1] - 1)
    yi = np.clip(np.round(y).astype(int), 0, c.shape[0] - 1)
    lam = c.wavelength_um[yi, xi].astype(float)
    bw = c.bandwidth_um[yi, xi].astype(float)
    ra, dec = c.wcs.all_pix2world(x, y, 0)
    edge = np.minimum.reduce([x, y, c.shape[1] - 1 - x, c.shape[0] - 1 - y])
    pos_err = np.hypot(
        prep.psf_fwhm_arcsec / (2.355 * np.maximum(snr, 1.0)) * 1.5, params.astrometric_floor_arcsec
    )
    return Detections(
        x=np.asarray(x, float),
        y=np.asarray(y, float),
        ra=np.asarray(ra, float),
        dec=np.asarray(dec, float),
        flux_ujy=flux,
        flux_err_ujy=flux_err,
        snr=snr,
        peak_frac=peak_frac,
        flag_bits=flag_bits,
        n_flagged=n_flag,
        n_hard=n_hard,
        n_soft=n_soft,
        wavelength_um=lam,
        bandwidth_um=bw,
        edge_dist_px=np.asarray(edge, float),
        pos_err_arcsec=pos_err,
    )


def centroid(
    sci: np.ndarray, x0: np.ndarray, y0: np.ndarray, half: int = 1
) -> tuple[np.ndarray, np.ndarray]:
    """Flux-weighted centroid in a (2*half+1)^2 box (positive pixels only)."""
    xs, ys = [], []
    ny, nx = sci.shape
    for xi, yi in zip(x0.astype(int), y0.astype(int), strict=True):
        ya, yb = max(yi - half, 0), min(yi + half + 1, ny)
        xa, xb = max(xi - half, 0), min(xi + half + 1, nx)
        box = np.clip(np.nan_to_num(sci[ya:yb, xa:xb]), 0, None)
        if box.sum() <= 0:
            xs.append(float(xi))
            ys.append(float(yi))
            continue
        cy, cx = ndimage.center_of_mass(box)
        xs.append(xa + cx)
        ys.append(ya + cy)
    return np.array(xs), np.array(ys)


def detect(prep: Prepared, params: DetectParams = DetectParams()) -> Detections:
    snr_map = prep.sci / prep.sigma
    snr_map = np.where(prep.bad, 0.0, np.nan_to_num(snr_map))
    kernel = Gaussian2DKernel(params.smooth_sigma_px)
    smooth = convolve(snr_map, kernel, normalize_kernel=True, boundary="extend")
    # smoothing a unit-variance map reduces its variance; renormalize to unit noise
    _, _, std = sigma_clipped_stats(smooth[~prep.bad], sigma=3)
    if not std or not np.isfinite(std):
        return Detections.empty()
    smooth = smooth / std
    peaks = find_peaks(
        smooth,
        threshold=params.threshold_snr,
        box_size=2 * params.min_separation_px + 1,
        border_width=params.edge_px,
        mask=prep.bad,
    )
    if peaks is None or len(peaks) == 0:
        return Detections.empty()
    x0 = np.asarray(peaks["x_peak"], float)
    y0 = np.asarray(peaks["y_peak"], float)
    x, y = centroid(prep.sci, x0, y0)
    det = measure(prep, x, y, params)
    keep = (det.snr >= params.threshold_snr) & (det.n_hard == 0)
    return det.take(keep)
