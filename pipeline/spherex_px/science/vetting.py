"""Rule-based vetting, scores, error sources and classification for linked tracks.

Every check is a measured value compared with a threshold, so the evidence report can show
exactly why a candidate got its label. Known-object checks are left for the Worker, which
queries JPL at request time.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from ..schemas import (
    Classification,
    ErrorSource,
    ErrorSourceStatus,
    QualityLevel,
    Scores,
    VettingCheck,
)

# thresholds (documented in docs/backend-plan.md section 6)
MIN_CLUSTERS = 3
MIN_SNR = 4.5
MAX_RMS_ARCSEC = 3.0
RMS_ZERO_SCORE_ARCSEC = 6.0  # motion_consistency reaches 0 at one pixel of scatter
MAX_SOFT_FLAG_FRACTION = 0.25
MAX_PEAK_FRACTION = (
    0.85  # brightest pixel / aperture flux; a cosmic ray puts ~all flux in one pixel
)
MIN_EDGE_PX = 3.0
MAX_FLUX_RATIO = 4.0  # p90/p10 of detection fluxes across wavelengths


@dataclass
class TrackMeasurements:
    n_clusters: int
    n_detections: int
    min_snr: float
    rms_arcsec: float | None
    pvalue: float | None
    soft_flag_fraction: float
    median_peak_fraction: float
    min_edge_px: float
    flux_ratio: float
    wavelength_range_um: tuple[float, float]
    max_forced_snr_elsewhere: float
    kind: str  # "track" | "pair"


def _logistic(x: float, x0: float, width: float) -> float:
    return 1.0 / (1.0 + math.exp(-(x - x0) / width))


def vet(
    m: TrackMeasurements,
) -> tuple[list[VettingCheck], Scores, Classification, list[ErrorSource]]:
    checks = [
        VettingCheck(
            check="min_detections",
            description="Number of separate visits (clusters of exposures hours apart) the object was seen in",
            value=m.n_clusters,
            threshold=MIN_CLUSTERS,
            passed=m.n_clusters >= MIN_CLUSTERS,
        ),
        VettingCheck(
            check="per_detection_snr_min",
            description="Lowest signal-to-noise ratio among the detections",
            value=round(m.min_snr, 2),
            threshold=MIN_SNR,
            passed=m.min_snr >= MIN_SNR,
        ),
        VettingCheck(
            check="motion_fit_rms",
            description="Scatter of the detections about the fitted motion, arcsec",
            value=None if m.rms_arcsec is None else round(m.rms_arcsec, 2),
            threshold=MAX_RMS_ARCSEC,
            passed=None
            if (m.rms_arcsec is None or m.kind == "pair")
            else m.rms_arcsec <= MAX_RMS_ARCSEC,
        ),
        VettingCheck(
            check="motion_fit_pvalue",
            description="Chi-square probability of the motion fit given the position errors (informational)",
            value=None if m.pvalue is None else float(f"{m.pvalue:.3g}"),
            threshold=None,
            passed=None,
        ),
        VettingCheck(
            check="flagged_aperture_pixels",
            description="Fraction of detections whose aperture touches pixels SPHEREx flags as "
            "unreliable (phantom, dichroic, nonlinear, persistence)",
            value=round(m.soft_flag_fraction, 3),
            threshold=MAX_SOFT_FLAG_FRACTION,
            passed=m.soft_flag_fraction <= MAX_SOFT_FLAG_FRACTION,
        ),
        VettingCheck(
            check="psf_like_shape",
            description="Median fraction of the aperture flux in the brightest pixel (a cosmic ray "
            "or hot pixel puts nearly all of it in one pixel)",
            value=round(m.median_peak_fraction, 3),
            threshold=MAX_PEAK_FRACTION,
            passed=m.median_peak_fraction <= MAX_PEAK_FRACTION,
        ),
        VettingCheck(
            check="edge_distance",
            description="Smallest distance of a detection from the edge of the image data, pixels",
            value=round(m.min_edge_px, 1),
            threshold=MIN_EDGE_PX,
            passed=m.min_edge_px >= MIN_EDGE_PX,
        ),
        VettingCheck(
            check="not_static",
            description="Highest combined forced-photometry S/N at the object's first position in "
            "any other visit (a static star would be detected there)",
            value=round(m.max_forced_snr_elsewhere, 2),
            threshold=4.0,
            passed=m.max_forced_snr_elsewhere < 4.0,
        ),
        VettingCheck(
            check="flux_consistent_across_lambda",
            description="Ratio of the 90th to 10th percentile detection flux across the wavelengths "
            "sampled",
            value=round(m.flux_ratio, 2),
            threshold=MAX_FLUX_RATIO,
            passed=m.flux_ratio <= MAX_FLUX_RATIO,
        ),
        VettingCheck(
            check="known_object_match",
            description="Matched to a known asteroid or comet by JPL (filled in at request time)",
            value=None,
            threshold=False,
            passed=None,
        ),
    ]
    by = {c.check: c for c in checks}

    if m.kind == "pair" or m.rms_arcsec is None:
        motion = 0.0
    else:
        motion = max(0.0, min(1.0, 1.0 - m.rms_arcsec / RMS_ZERO_SCORE_ARCSEC))
    snr_score = _logistic(m.min_snr, 5.0, 1.0)
    artifact = 0.0
    artifact += 0.5 if not by["psf_like_shape"].passed else 0.0
    artifact += min(0.5, m.soft_flag_fraction)
    artifact += 0.3 if not by["edge_distance"].passed else 0.0
    artifact += 0.3 if not by["flux_consistent_across_lambda"].passed else 0.0
    artifact = min(1.0, artifact)
    overall = motion * snr_score * (1 - artifact)
    level = (
        QualityLevel.high
        if overall >= 0.6
        else QualityLevel.medium
        if overall >= 0.3
        else QualityLevel.low
    )
    scores = Scores(
        motion_consistency=round(motion, 3),
        snr=round(snr_score, 3),
        artifact_likelihood=round(artifact, 3),
        overall=round(overall, 3),
        quality_level=level,
    )

    hard_fail = (
        not by["psf_like_shape"].passed or m.soft_flag_fraction > 0.5 or not by["not_static"].passed
    )
    if hard_fail:
        cls = Classification.likely_artifact
    elif m.kind == "pair":
        cls = Classification.unconfirmed_pair
    elif by["motion_fit_rms"].passed is False:
        cls = Classification.likely_artifact
    else:
        cls = Classification.unmatched

    return checks, scores, cls, error_sources(m, by, cls)


def error_sources(
    m: TrackMeasurements, by: dict[str, VettingCheck], cls: Classification
) -> list[ErrorSource]:
    S = ErrorSourceStatus
    art_ok = bool(
        by["flagged_aperture_pixels"].passed
        and by["psf_like_shape"].passed
        and by["edge_distance"].passed
    )
    art_evidence = []
    if not by["flagged_aperture_pixels"].passed:
        art_evidence.append(f"{m.soft_flag_fraction:.0%} of detections touch flagged pixels")
    if not by["psf_like_shape"].passed:
        art_evidence.append(
            f"flux is concentrated in one pixel (peak fraction {m.median_peak_fraction:.2f})"
        )
    if not by["edge_distance"].passed:
        art_evidence.append(f"a detection is {m.min_edge_px:.1f} px from the image edge")
    lam_lo, lam_hi = m.wavelength_range_um
    out = [
        ErrorSource(
            id="cosmic_ray",
            label="Cosmic-ray hit or one-off glitch",
            explanation="A particle strike or electronic glitch can make a dot appear in a single image.",
            status=S.ruled_out,
            evidence=f"Seen in {m.n_detections} exposures during {m.n_clusters} separate visits.",
            from_checks=["min_detections"],
        ),
        ErrorSource(
            id="detector_artifact",
            label="Bad pixels, ghosts or detector defects",
            explanation="Hot pixels, optical ghosts or pixels flagged by the SPHEREx pipeline can mimic a source.",
            status=S.ruled_out if art_ok else S.not_ruled_out,
            evidence="No flagged pixels, PSF-like shape and away from edges."
            if art_ok
            else "; ".join(art_evidence).capitalize() + ".",
            from_checks=["flagged_aperture_pixels", "psf_like_shape", "edge_distance"],
        ),
        ErrorSource(
            id="misassociation",
            label="Unrelated dots linked together",
            explanation="Separate faint dots in different images can line up by chance.",
            status=(
                S.unknown
                if m.kind == "pair"
                else S.ruled_out
                if (
                    m.rms_arcsec is not None
                    and m.rms_arcsec <= MAX_RMS_ARCSEC
                    and m.n_clusters >= MIN_CLUSTERS
                )
                else S.not_ruled_out
            ),
            evidence=(
                "Only two sightings: any two dots define a straight line."
                if m.kind == "pair"
                else f"{m.n_clusters} visits fit one steady motion with {m.rms_arcsec:.1f} arcsec scatter."
            ),
            from_checks=["motion_fit_rms", "min_detections"],
        ),
        ErrorSource(
            id="static_source",
            label="A star or galaxy that didn't move",
            explanation="A fixed source near the detection limit can come and go between images.",
            status=S.ruled_out if by["not_static"].passed else S.not_ruled_out,
            evidence=f"Nothing at the first position in other visits (combined S/N at most {m.max_forced_snr_elsewhere:.1f}).",
            from_checks=["not_static"],
        ),
        ErrorSource(
            id="wavelength_change",
            label="Brightness change caused by the filter, not the object",
            explanation="SPHEREx sees each spot at a different infrared wavelength in each image, so brightness "
            "naturally changes from frame to frame.",
            status=S.ruled_out if by["flux_consistent_across_lambda"].passed else S.not_ruled_out,
            evidence=f"Detections span {lam_lo:.2f} to {lam_hi:.2f} µm; fluxes vary by a factor of {m.flux_ratio:.1f}.",
            from_checks=["flux_consistent_across_lambda"],
        ),
        ErrorSource(
            id="known_object",
            label="A catalogued asteroid or comet",
            explanation="Most moving dots in SPHEREx images are asteroids that are already known.",
            status=S.unknown,
            evidence="Checked against JPL when the report is opened.",
            from_checks=["known_object_match"],
        ),
        ErrorSource(
            id="catalog_gap",
            label="A real object missing from the catalogs we checked",
            explanation="Some real asteroids are faint or newly found and are not in JPL's database yet.",
            status=S.unknown,
            evidence="Cannot be ruled out from SPHEREx data alone.",
            from_checks=["known_object_match"],
        ),
    ]
    return out


def flux_ratio(fluxes: np.ndarray) -> float:
    f = np.asarray(fluxes, float)
    f = f[np.isfinite(f) & (f > 0)]
    if f.size < 2:
        return 1.0
    lo, hi = np.percentile(f, [10, 90])
    return float(hi / lo) if lo > 0 else float("inf")
