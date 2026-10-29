"""API contract: Pydantic models for every response the frontend consumes.

docs/api-contract.md describes these models in prose. Example responses live in
shared/fixtures/ and JSON Schema exports in shared/schema/. Change all three together.

Conventions:
- snake_case with units in the name (flux_ujy, rate_arcsec_per_hr, time_span_hours).
- RA/Dec in degrees (ICRS). Times as ISO 8601 UTC strings *and* MJD (UTC).
- IDs: field_id, epoch_id, candidate_id. obs_id is always the SPHEREx/IRSA observation ID
  (the OBSID header keyword, e.g. "2025W23_1C_0001_1").
- Every top-level response carries schema_version and pipeline_version.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import SCHEMA_VERSION


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Envelope(Model):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    pipeline_version: str = Field(
        description="Pipeline package version plus the git commit of the code that built the data"
    )


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class Classification(StrEnum):
    """Backend-owned label. The frontend never upgrades it.

    Frontend display: unmatched -> "Unexplained", unconfirmed_pair -> "Unconfirmed pair",
    injected -> "SIMULATED".
    """

    known_object = "known_object"
    unmatched = "unmatched"
    likely_artifact = "likely_artifact"
    unconfirmed_pair = "unconfirmed_pair"
    injected = "injected"


class QualityLevel(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"


class ErrorSourceStatus(StrEnum):
    ruled_out = "ruled_out"
    not_ruled_out = "not_ruled_out"
    unknown = "unknown"


class MotionModel(StrEnum):
    linear = "linear"
    parallax = "parallax"
    none = "none"


# ---------------------------------------------------------------------------
# Shared blocks
# ---------------------------------------------------------------------------


class SkyPosition(Model):
    ra_deg: float
    dec_deg: float


class SizeDeg(Model):
    width: float
    height: float


class DateRange(Model):
    start_utc: str
    end_utc: str
    start_mjd: float
    end_mjd: float


class Source(Model):
    """Provenance for an image, epoch, detection or stamp. Required on every image."""

    file: str = Field(description="SPHEREx Level 2 file name")
    obs_id: str = Field(description="SPHEREx observation ID (OBSID header keyword)")
    planeid: str | None = Field(
        default=None, description="IRSA CAOM plane ID, when known from an IRSA TAP query"
    )
    detector: int = Field(ge=1, le=6)
    archive_url: str = Field(description="URL of the full Level 2 file in the archive")
    cutout_url: str | None = Field(
        default=None,
        description="IRSA cutout-service URL, when the pixels came from IRSA's cutout service",
    )
    cutout_method: Literal["irsa_cutout", "s3_byte_range"] = Field(
        description="How the pixels were fetched. s3_byte_range reads only the rows of the "
        "cutout from the public SPHEREx bucket on AWS; the full file is never downloaded."
    )
    cutout_region_pix: list[int] | None = Field(
        default=None,
        description="[x_min, x_max, y_min, y_max] (0-based, inclusive-exclusive) of the native "
        "detector pixels read",
        min_length=4,
        max_length=4,
    )
    data_release: str = Field(description="SPHEREx data release, e.g. 'QR2'")
    processing_note: str | None = None


class Stretch(Model):
    type: Literal["asinh"] = "asinh"
    min: float
    max: float
    softening: float = Field(description="asinh softening parameter, in units of (max - min)")
    units: Literal["MJy/sr"] = "MJy/sr"
    zodi_subtracted: bool = True


class GridWcs(Model):
    """Common tangent-plane grid that every field image (and x_grid/y_grid) refers to.

    Pixel convention: FITS-like, (1, 1) is the center of the first pixel; x to the right,
    y up in the FITS sense. Images are rendered so that row 0 is the TOP of the image
    (y = height_px), i.e. north up and east left when rotation_deg = 0.
    """

    projection: Literal["TAN"] = "TAN"
    crval: list[float] = Field(min_length=2, max_length=2, description="[ra_deg, dec_deg]")
    crpix: list[float] = Field(min_length=2, max_length=2, description="[x, y], 1-based")
    cdelt_arcsec: float
    width_px: int
    height_px: int
    rotation_deg: float = 0.0


class ImageRef(Model):
    url: str
    width_px: int
    height_px: int
    format: Literal["webp", "png"] = "webp"
    source: Source


# ---------------------------------------------------------------------------
# Fields
# ---------------------------------------------------------------------------


class Epoch(Model):
    epoch_id: str
    obs_id: str
    time_utc: str = Field(description="Exposure midpoint (DATE-AVG)")
    mjd: float = Field(description="Exposure midpoint (MJD-AVG, UTC)")
    time_start_utc: str
    time_end_utc: str
    exposure_s: float
    detector: int = Field(ge=1, le=6)
    bandpass: str = Field(description="IRSA band name, e.g. 'SPHEREx-D3'")
    wavelength_um_center: float = Field(description="Central wavelength at the field center")
    bandwidth_um: float = Field(description="Bandwidth at the field center")
    wavelength_um_range: list[float] = Field(
        min_length=2,
        max_length=2,
        description="[min, max] central wavelength over the field (the LVF varies across it)",
    )
    band_index: int | None = Field(
        default=None, ge=0, le=101, description="0-based index into SPHEREx's 102 channels"
    )
    image: ImageRef
    flagged_pixel_fraction: float
    n_detections: int
    spacecraft_geocentric_km: list[float] = Field(
        min_length=3,
        max_length=3,
        description="SPHEREx position relative to Earth's center at exposure midpoint, km, "
        "ICRF/J2000 equatorial axes (header X_SC, Y_SC, Z_SC)",
    )
    source: Source


class BlinkPair(Model):
    epoch_id_a: str
    epoch_id_b: str
    time_separation_hours: float
    lambda_matched: bool
    delta_lambda_frac: float = Field(description="|lambda_a - lambda_b| / mean at field center")
    label_plain: str
    displacement_arcsec: float | None = Field(
        default=None,
        description="How far a mover detected in both images shifts between them; null when none is",
    )
    default: bool = Field(
        default=False, description="The pair the Explorer opens with; exactly one per field"
    )


class TrackPoint(Model):
    epoch_id: str
    time_utc: str
    mjd: float
    ra_deg: float
    dec_deg: float
    x_grid: float
    y_grid: float


class Mover(Model):
    candidate_id: str
    classification: Classification
    label_plain: str
    quality_level: QualityLevel
    rate_arcsec_per_hr: float | None
    track: list[TrackPoint]


class FieldSummary(Model):
    field_id: str
    name: str
    blurb: str
    center: SkyPosition
    ecliptic_lat_deg: float
    size_deg: SizeDeg
    thumbnail_url: str
    epoch_count: int
    date_range: DateRange
    candidate_count: int
    candidate_counts: dict[Classification, int]
    data_release: str
    origin: Literal["showcase", "run"] = "showcase"


class FieldList(Envelope):
    generated_utc: str
    fields: list[FieldSummary]
    build_run_id: str | None = Field(
        default=None,
        description="Pipeline run that wrote this file: 'gh-<run>-<attempt>' in GitHub Actions, "
        "'local-<UTC time>-<commit>' otherwise",
    )


class FieldDetail(Envelope):
    build_run_id: str | None = Field(
        default=None,
        description="Pipeline run that wrote this file: 'gh-<run>-<attempt>' in GitHub Actions, "
        "'local-<UTC time>-<commit>' otherwise",
    )
    field_id: str
    name: str
    blurb: str
    summary_plain: str = Field(description="Generated from measured values only")
    center: SkyPosition
    ecliptic_lat_deg: float
    size_deg: SizeDeg
    thumbnail_url: str
    data_release: str
    origin: Literal["showcase", "run"] = "showcase"
    generated_utc: str
    wcs: GridWcs
    stretch: Stretch
    epochs: list[Epoch]
    blink_pairs: list[BlinkPair]
    movers: list[Mover]


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------


class Detection(Model):
    epoch_id: str
    obs_id: str
    time_utc: str
    mjd: float
    ra_deg: float
    dec_deg: float
    pos_err_arcsec: float
    x_pix: float = Field(description="Native detector x, 0-based (header WCS 'A')")
    y_pix: float = Field(description="Native detector y, 0-based")
    x_grid: float = Field(description="Position on the field's common grid (GridWcs)")
    y_grid: float
    flux_ujy: float
    flux_err_ujy: float
    snr: float
    wavelength_um_center: float
    bandwidth_um: float
    wavelength_um_range: list[float] = Field(min_length=2, max_length=2)
    band_index: int | None = Field(default=None, ge=0, le=101)
    flag_bits: int = Field(description="OR of FLAGS bits over the photometry aperture")
    flag_names: list[str]
    flagged_pixels_in_aperture: int
    psf_fit_reduced_chi2: float | None
    stamp: ImageRef = Field(description="64 x 64 px stamp centered on the detection")
    spacecraft_geocentric_km: list[float] = Field(
        min_length=3,
        max_length=3,
        description="SPHEREx position relative to Earth's center at exposure midpoint, km, "
        "ICRF/J2000 equatorial axes (header X_SC, Y_SC, Z_SC)",
    )
    source: Source


class DistanceEstimate(Model):
    best: float
    lo: float
    hi: float


class Motion(Model):
    model: MotionModel
    n_detections: int
    time_span_hours: float
    rate_arcsec_per_hr: float | None
    rate_err_arcsec_per_hr: float | None
    position_angle_deg: float | None = Field(description="East of north, degrees")
    ra_rate_arcsec_per_hr: float | None = Field(description="d(RA)cos(Dec)/dt")
    dec_rate_arcsec_per_hr: float | None
    fit_residual_rms_arcsec: float | None
    fit_chi2: float | None
    fit_dof: int | None
    distance_au_estimate: DistanceEstimate | None = None


class KnownObjectEpoch(Model):
    epoch_id: str
    predicted_ra_deg: float
    predicted_dec_deg: float
    separation_arcsec: float


class NearestKnown(Model):
    designation: str
    separation_arcsec: float


class KnownObject(Model):
    checked: bool
    not_checked_reason: str | None = None
    matched: bool
    catalogs_checked: list[Literal["JPL SBIdent", "JPL Horizons"]] = Field(
        description="Only services actually queried for this candidate"
    )
    search_radius_arcsec: float | None
    designation: str | None = None
    predicted_vmag: float | None = None
    per_epoch: list[KnownObjectEpoch] = []
    nearest: NearestKnown | None = Field(
        default=None, description="Closest known object returned, when not matched"
    )
    observer: str | None = Field(default=None, description="Observer location used for predictions")
    query_utc: str | None = None
    enrichment: Literal["static", "live", "cached"] = Field(
        default="static",
        description="static: as written by the offline pipeline (not checked); live/cached: "
        "filled by the Worker from JPL at request time",
    )


class Scores(Model):
    motion_consistency: float = Field(ge=0, le=1)
    snr: float = Field(ge=0, le=1)
    artifact_likelihood: float = Field(ge=0, le=1)
    overall: float = Field(ge=0, le=1)
    quality_level: QualityLevel
    method: Literal["rule_based_v1"] = "rule_based_v1"
    definition: str = (
        "Rule-based ranking score in [0, 1]: motion_consistency x snr x (1 - "
        "artifact_likelihood). It orders candidates for review. It is not a probability."
    )


class VettingCheck(Model):
    check: str
    description: str
    value: float | int | bool | str | None
    threshold: float | int | bool | str | None
    passed: bool | None = Field(description="null when the check could not be evaluated")


class ErrorSource(Model):
    id: str
    label: str
    explanation: str
    status: ErrorSourceStatus
    evidence: str | None
    from_checks: list[str] = Field(description="vetting[].check names this is derived from")


class Explanation(Model):
    text: str
    generator: str = Field(description="'template_v1', or an LLM name/version")
    grounded_fields: list[str] = Field(
        description="JSON paths inside this candidate, e.g. known_object.per_epoch[0]"
        ".separation_arcsec"
    )
    numeric_check: Literal["passed", "failed", "not_run"]
    generated_utc: str


class SpectrumPoint(Model):
    band_index: int | None = Field(ge=0, le=101)
    wavelength_um: float
    flux_ujy: float
    flux_err_ujy: float
    epoch_id: str


class SpectrumUnits(Model):
    wavelength: Literal["um"] = "um"
    flux: Literal["uJy"] = "uJy"


class Spectrum(Model):
    units: SpectrumUnits = SpectrumUnits()
    points: list[SpectrumPoint]


class InjectedTruth(Model):
    mag_ab: float
    flux_ujy: float
    model: MotionModel
    rate_arcsec_per_hr: float | None
    position_angle_deg: float | None
    distance_au: float | None = None


class InjectionInfo(Model):
    study_id: str
    injection_id: str
    injected: InjectedTruth
    recovered: bool
    recovered_rate_arcsec_per_hr: float | None
    position_error_arcsec: float | None


class CandidateProvenance(Model):
    run_id: str
    generated_utc: str
    parameters: dict[str, float | int | str | bool]


class CandidateSummary(Model):
    candidate_id: str
    field_id: str
    classification: Classification
    label_plain: str
    summary_plain: str
    thumbnail_url: str
    detection_count: int
    time_span_hours: float
    first_time_utc: str
    rate_arcsec_per_hr: float | None
    position_angle_deg: float | None
    mean_snr: float
    overall_score: float
    quality_level: QualityLevel
    known_object_checked: bool
    known_object_matched: bool
    known_object_designation: str | None


class CandidateList(Envelope):
    generated_utc: str
    total: int
    build_run_id: str | None = Field(
        default=None,
        description="Pipeline run that wrote this file: 'gh-<run>-<attempt>' in GitHub Actions, "
        "'local-<UTC time>-<commit>' otherwise",
    )
    candidates: list[CandidateSummary]


class CandidateDetail(Envelope):
    candidate_id: str
    field_id: str
    classification: Classification
    label_plain: str
    summary_plain: str
    thumbnail_url: str
    detections: list[Detection]
    motion: Motion
    known_object: KnownObject
    scores: Scores
    vetting: list[VettingCheck]
    error_sources: list[ErrorSource]
    explanation: Explanation | None
    spectrum: Spectrum | None
    injection: InjectionInfo | None = Field(
        default=None, description="Present only when classification == 'injected'"
    )
    provenance: CandidateProvenance
    disclaimer: str = (
        "An unmatched candidate may be an imaging artifact, a measurement error, or an object "
        "missing from the catalogs we checked. This is not a discovery claim."
    )


# ---------------------------------------------------------------------------
# Injection-recovery study
# ---------------------------------------------------------------------------


class RecoveryCell(Model):
    mag_ab: float
    rate_arcsec_per_hr: float
    n_injected: int
    n_recovered: int
    fraction: float
    ci_low: float = Field(description="Wilson 95% interval, lower bound")
    ci_high: float


class M50(Model):
    rate_arcsec_per_hr: float
    m50_ab: float | None = Field(description="null when 50% completeness is not bracketed")


class FalsePositives(Model):
    n_control_runs: int
    area_deg2: float
    n_candidates: int
    rate_per_deg2: float
    ci_low_per_deg2: float
    ci_high_per_deg2: float


class InjectionStudy(Envelope):
    study_id: str
    generated_utc: str
    simulated: Literal[True] = True
    field_ids: list[str]
    n_injected: int
    n_recovered: int
    mag_bins_ab: list[float]
    rate_bins_arcsec_per_hr: list[float]
    grid: list[RecoveryCell]
    m50_by_rate: list[M50]
    false_positives: FalsePositives
    recovery_criteria: str
    method_notes: list[str]
    example_candidate_ids: list[str]


# ---------------------------------------------------------------------------
# Health, coverage, runs
# ---------------------------------------------------------------------------


class UpstreamStatus(Model):
    name: str
    url: str
    reachable: bool = Field(
        description="True only when the upstream answered a minimal valid request with HTTP 200 "
        "and the expected body"
    )
    http_status: int | None = None
    latency_ms: float | None = None
    detail: str | None = None
    probed_utc: str = Field(description="When this result was measured")
    cached: bool = Field(description="Result reused from a probe in the last 10 minutes")


class Health(Envelope):
    build_run_id: str | None = Field(description="build_run_id of the static data being served")
    status: Literal["ok", "degraded"]
    checked_utc: str
    fields_loaded: int
    candidates_loaded: int
    upstream: list[UpstreamStatus]


class CoverageEpoch(Model):
    """One SPHEREx spectral image covering the position, as listed by IRSA TAP."""

    obs_id: str | None = Field(description="Parsed from the file name when possible")
    planeid: str | None
    detector: int | None = Field(default=None, ge=1, le=6)
    bandpass: str | None
    time_utc: str = Field(description="Exposure start (time_bounds_lower)")
    mjd: float
    time_end_utc: str | None
    wavelength_um_range: list[float] | None = Field(
        default=None, min_length=2, max_length=2, description="From energy_bounds_lower/upper"
    )
    archive_url: str
    cutout_url: str | None


class Coverage(Envelope):
    center: SkyPosition
    radius_deg: float
    searched: str = Field(description="Service and tables queried")
    n_epochs: int
    truncated: bool = Field(description="True when the result hit the row limit")
    epochs: list[CoverageEpoch]


class RunRequest(Model):
    ra_deg: Annotated[float, Field(ge=0, lt=360)]
    dec_deg: Annotated[float, Field(ge=-90, le=90)]
    size_deg: Annotated[float, Field(gt=0, le=0.5)] = 0.3
    time_min_utc: str | None = None
    time_max_utc: str | None = None
    name: str | None = None


class RunStatusValue(StrEnum):
    queued = "queued"
    discovering = "discovering"
    fetching = "fetching"
    detecting = "detecting"
    linking = "linking"
    identifying = "identifying"
    rendering = "rendering"
    done = "done"
    failed = "failed"


class RunStatus(Envelope):
    run_id: str
    status: RunStatusValue
    progress: float = Field(ge=0, le=1)
    message: str | None = None
    request: RunRequest | None = None
    field_id: str | None = Field(
        default=None, description="Set when done; read it with GET /api/fields/{field_id}"
    )
    created_utc: str
    updated_utc: str


class ErrorResponse(Model):
    detail: str
    upstream: str | None = Field(default=None, description="Upstream service name, if any")
    upstream_status: int | str | None = Field(
        default=None,
        description="Upstream HTTP status code, or 'timeout' / 'unreachable', when an upstream "
        "service caused the error",
    )


ALL_RESPONSE_MODELS: dict[str, type[BaseModel]] = {
    "FieldList": FieldList,
    "FieldDetail": FieldDetail,
    "CandidateList": CandidateList,
    "CandidateDetail": CandidateDetail,
    "InjectionStudy": InjectionStudy,
    "Health": Health,
    "Coverage": Coverage,
    "RunRequest": RunRequest,
    "RunStatus": RunStatus,
    "ErrorResponse": ErrorResponse,
}
