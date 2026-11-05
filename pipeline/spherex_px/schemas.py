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
from .schemas_thermal import SizeStatus, ThermalFit, ThermalValidation


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Envelope(Model):
    schema_version: Literal["1.0", "1.1", "1.2"] = SCHEMA_VERSION
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
    total: int | None = Field(default=None, description="Items matching the filters, before paging")
    offset: int = 0
    limit: int | None = Field(default=None, description="Page size requested; null = everything")
    next_offset: int | None = Field(
        default=None, description="Offset of the next page; null on the last"
    )
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
    stamp: ImageRef | None = Field(
        description="64 x 64 px stamp centered on the detection; null when the record is "
        "minimal (a known object: see CandidateDetail.record_level)"
    )
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


class JplLinks(Model):
    sbdb_url: str
    horizons_url: str


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
    enrichment: Literal["static", "pipeline", "live", "cached", "pending"] = Field(
        default="static",
        description="static: as written by the offline pipeline (not checked); pipeline: "
        "checked against JPL by the survey pipeline's triage step (spherex-px triage); pending: "
        "the Worker has started a JPL lookup in the background; live/cached: filled by the Worker "
        "from JPL (live = this request, cached = a stored result)",
    )
    jpl_links: JplLinks | None = Field(
        default=None,
        description="JPL pages for the matched object's orbit (Small-Body Database) and "
        "ephemerides (Horizons); null unless matched",
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
    pipeline_version: str | None = Field(
        default=None,
        description="Pipeline commit that built this candidate (data from several survey runs "
        "can be published together); the Worker keys stored JPL results by it",
    )
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
    offset: int = 0
    limit: int | None = Field(default=None, description="Page size requested; null = everything")
    next_offset: int | None = Field(
        default=None, description="Offset of the next page; null on the last"
    )


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
    record_level: Literal["full", "minimal"] = Field(
        default="full",
        description="full: stamps, orbit, prediction and clones kept. minimal: JPL identified "
        "the object, so per-detection stamps and our own orbit products are not kept; "
        "known_object.jpl_links point to JPL's orbit and ephemerides",
    )
    disclaimer: str = (
        "An unmatched candidate may be an imaging artifact, a measurement error, or an object "
        "missing from the catalogs we checked. This is not a discovery claim."
    )


# ---------------------------------------------------------------------------
# Injection-recovery study
# ---------------------------------------------------------------------------


class RecoveryCell(Model):
    mag_ab: float
    rate_arcsec_per_hr: float = Field(
        description="Linear cells: the injected rate. Distance cells: median rate of their tracks"
    )
    motion: MotionModel = Field(
        default=MotionModel.linear,
        description="linear: fixed rate and direction; parallax: body at a fixed distance",
    )
    distance_au: float | None = Field(default=None, description="Distance cells only")
    n_injected: int
    n_recovered: int
    fraction: float
    ci_low: float = Field(description="Wilson 95% interval, lower bound")
    ci_high: float


class M50(Model):
    rate_arcsec_per_hr: float
    m50_ab: float | None = Field(description="null when 50% completeness is not bracketed")


class M50ByDistance(Model):
    distance_au: float
    median_rate_arcsec_per_hr: float
    m50_ab: float | None = Field(description="null when 50% completeness is not bracketed")
    n_injected: int


class PlanetAssumptions(Model):
    """How a predicted planet brightness was computed. Predictions, not observations."""

    name: str
    diameter_km: float
    geometric_albedo: float
    band_um: float
    phase_function: str
    thermal_model: str
    reference: str


class PlanetContextRow(Model):
    distance_au: float
    predicted_mag_ab: float
    band_um: float
    m50_ab: float | None = Field(description="m50 of the parallax tracks at this distance")
    recovery_fraction_at_predicted: float | None = Field(
        description="Recovery fraction interpolated at the predicted magnitude; null if not tested"
    )
    verdict: Literal["detected", "missed", "not_tested"]


class PlanetContext(Model):
    assumptions: PlanetAssumptions
    rows: list[PlanetContextRow]


class FieldRecovery(Model):
    field_id: str
    n_injected: int
    n_recovered: int
    m50_ab: float | None = Field(description="For linear tracks at 3-100 arcsec/hr")


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
    distance_bins_au: list[float] = []
    grid: list[RecoveryCell]
    m50_by_rate: list[M50]
    m50_by_distance: list[M50ByDistance] = []
    per_field: list[FieldRecovery] = []
    false_positives: FalsePositives
    recovered_rate_error_median: float | None = Field(
        default=None, description="Median |fitted - injected| / injected rate, linear tracks"
    )
    recovered_position_error_arcsec_median: float | None = None
    photometry_check: list[PhotometryCheck] = []
    planet_context: PlanetContext | None = None
    recovery_criteria: str
    method_notes: list[str]
    example_candidate_ids: list[str]


class PhotometryCheck(Model):
    """Injected flux measured back with the pipeline's own photometry, at random positions."""

    mag_ab: float
    n: int
    measured_over_injected_median: float
    measured_over_injected_p25: float
    measured_over_injected_p75: float


class InjectionStudyRef(Model):
    study_id: str
    generated_utc: str
    field_ids: list[str]
    n_injected: int


class InjectionStudyIndex(Envelope):
    build_run_id: str | None = None
    studies: list[InjectionStudyRef]


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


# ---------------------------------------------------------------------------
# v1.1: objects (linked across visits and fields), survey, AI, sky requests, vetting votes
# ---------------------------------------------------------------------------


class DistanceClass(StrEnum):
    """Where in the solar system an object probably is, from its parallax distance or orbit."""

    neo = "neo"  # perihelion < 1.3 AU
    main_belt = "main_belt"  # 1.8-4.2 AU
    jupiter_trojan = "jupiter_trojan"  # ~5.2 AU
    centaur = "centaur"  # between Jupiter and Neptune
    tno = "tno"  # beyond Neptune, > 30 AU
    unknown = "unknown"


class OrbitStatus(StrEnum):
    none = "none"
    preliminary = "preliminary"  # ranging / Vaisala solution
    refined = "refined"  # least-squares fit to all detections


class JplOrbitComparison(Model):
    designation: str
    delta_a_au: float
    delta_e: float
    delta_i_deg: float
    position_error_arcsec_30d: float | None = Field(
        description="Separation of our and JPL's predicted positions 30 days after the last detection"
    )
    jpl_a_au: float | None = None
    jpl_e: float | None = None
    jpl_i_deg: float | None = None
    inside_3sigma_30d: bool | None = Field(
        default=None, description="JPL's 30-day position inside our 3-sigma ellipse"
    )
    jpl_helio_distance_au: float | None = Field(
        default=None, description="JPL's distance from the Sun at our epoch"
    )
    our_helio_distance_au: DistanceEstimate | None = None
    distance_in_interval: bool | None = Field(
        default=None, description="Our 5-95% distance interval contains JPL's distance"
    )


class PredictionPoint(Model):
    time_utc: str
    mjd: float
    ra_deg: float
    dec_deg: float
    sigma_major_arcsec: float = Field(description="1-sigma uncertainty ellipse, semi-major axis")
    sigma_minor_arcsec: float
    sigma_pa_deg: float = Field(description="Position angle of the major axis, east of north")
    vmag_estimate: float | None = None


class OrbitalElements(Model):
    """Heliocentric osculating elements (J2000 ecliptic) with uncertainty."""

    epoch_mjd: float = Field(description="Osculation epoch, MJD (TDB)")
    a_au: float
    e: float
    i_deg: float
    node_deg: float = Field(description="Longitude of the ascending node")
    peri_deg: float = Field(description="Argument of perihelion")
    mean_anomaly_deg: float
    q_au: float = Field(description="Perihelion distance")
    method: Literal["ranging", "least_squares"]
    rms_arcsec: float = Field(description="Residual rms of the fit to our detections")
    n_detections: int
    arc_hours: float
    covariance: list[list[float]] | None = Field(
        default=None, description="6x6 covariance of [a, e, i, node, peri, M] (au, -, deg...)"
    )
    n_clones: int = Field(default=0, description="Number of sampled orbit clones published")
    clones_url: str | None = Field(default=None, description="JSON file of sampled orbit clones")
    jpl_comparison: JplOrbitComparison | None = Field(
        default=None, description="Differences from JPL's orbit when JPL identified the object"
    )
    helio_distance_au: DistanceEstimate | None = Field(
        default=None,
        description="Distance from the Sun at the epoch: median and 5-95% range of the clones",
    )
    n_ranging_orbits: int | None = Field(
        default=None, description="Sampled orbits that fit the detections (statistical ranging)"
    )
    reported_orbit: str | None = Field(
        default=None, description="Which of the orbits that fit is reported, in plain words"
    )
    check_30d: PredictionPoint | None = Field(
        default=None,
        description="Predicted geocentric position 30 days after the last detection (clones' "
        "centre and 1-sigma ellipse); the API compares it with JPL's position for identified objects",
    )


class OrbitValidationRow(Model):
    population: str
    n: int
    distance_in_5_95_interval: float = Field(description="Fraction with the true distance inside")
    distance_rel_error_median: float
    distance_class_named: float = Field(
        description="Share of objects given a class (at least 68% of clones agree); the rest are unknown"
    )
    distance_class_correct: float | None = Field(
        description="Share right among those given a class"
    )
    a_rel_error_median: float
    e_abs_error_median: float
    i_abs_error_deg_median: float
    prediction_30d_error_arcsec_median: float
    prediction_30d_inside_2sigma: float
    prediction_30d_inside_3sigma: float
    refined_fraction: float


class OrbitValidation(Envelope):
    """Orbit fitting tested on simulated asteroids seen with SPHEREx's real geometry."""

    generated_utc: str
    simulated: Literal[True] = True
    method: str
    geometry_from: list[str] = Field(description="Candidates whose times and positions were used")
    per_population: int
    seed: int
    rows: list[OrbitValidationRow]


class CloneElements(Model):
    a_au: float
    e: float
    i_deg: float
    node_deg: float
    peri_deg: float
    mean_anomaly_deg: float


class OrbitClones(Envelope):
    """Sampled orbits consistent with the detections (the uncertainty cloud)."""

    object_id: str
    epoch_mjd: float = Field(description="Osculation epoch, MJD (TDB)")
    frame: str
    clones: list[CloneElements]


class ObjectDetection(Detection):
    field_id: str
    candidate_id: str


class ObjectHistoryEntry(Model):
    utc: str
    run_id: str
    change: str = Field(description="Plain-language note, e.g. 'linked 4 new detections'")


class ObjectSummary(Model):
    object_id: str
    pipeline_version: str | None = Field(
        default=None,
        description="Pipeline commit that built this object's candidate; the Worker keys stored "
        "JPL results by it",
    )
    classification: Classification
    label_plain: str
    summary_plain: str
    thumbnail_url: str
    field_ids: list[str]
    candidate_ids: list[str]
    n_detections: int
    n_visits: int = Field(description="Separate visits (clusters of exposures hours apart)")
    first_time_utc: str
    last_time_utc: str
    arc_hours: float
    rate_arcsec_per_hr: float | None
    distance_class: DistanceClass
    distance_au_estimate: DistanceEstimate | None
    orbit_status: OrbitStatus
    overall_score: float
    quality_level: QualityLevel
    known_object_checked: bool
    known_object_matched: bool
    known_object_designation: str | None
    also_seen_as: list[str] = Field(
        default=[],
        description="Objects with the same JPL designation (the same asteroid in other tiles), "
        "merged into this one by the Worker",
    )
    size_status: SizeStatus | None = Field(
        default=None, description="As ObjectDetail.thermal.status (null: not computed)"
    )
    diameter_km: float | None = Field(
        default=None, description="Thermal diameter (ObjectDetail.thermal), when sized"
    )
    diameter_upper_limit_km: float | None = Field(
        default=None, description="Largest possible diameter, when too cold or faint to size"
    )


class ObjectList(Envelope):
    build_run_id: str | None = None
    generated_utc: str
    total: int
    objects: list[ObjectSummary]
    offset: int = 0
    limit: int | None = Field(default=None, description="Page size requested; null = everything")
    next_offset: int | None = Field(
        default=None, description="Offset of the next page; null on the last"
    )


class ObjectDetail(Envelope):
    build_run_id: str | None = None
    object_id: str
    classification: Classification
    label_plain: str
    summary_plain: str
    thumbnail_url: str
    field_ids: list[str]
    candidate_ids: list[str]
    also_seen_as: list[str] = Field(default=[], description="Objects with the same JPL designation")
    detections: list[ObjectDetection]
    motion: Motion
    distance_class: DistanceClass
    orbit_status: OrbitStatus
    orbit: OrbitalElements | None
    known_object: KnownObject
    scores: Scores
    explanation: Explanation | None
    spectrum: Spectrum | None
    history: list[ObjectHistoryEntry]
    provenance: CandidateProvenance
    record_level: Literal["full", "minimal"] = Field(
        default="full", description="As CandidateDetail.record_level"
    )
    disclaimer: str = CandidateDetail.model_fields["disclaimer"].default
    thermal: ThermalFit | None = Field(
        default=None,
        description="Size and albedo from SPHEREx's 3-5 um heat (NEATM); see docs/api-contract.md",
    )


class ObjectPrediction(Envelope):
    object_id: str
    generated_utc: str
    orbit_epoch_mjd: float
    observer: str = Field(description="Where the positions are computed for, e.g. 'geocenter'")
    days: int
    points: list[PredictionPoint]
    note_plain: str | None = Field(
        default=None, description="How far the orbit can be trusted, from the clones' spread"
    )


class TileStatus(StrEnum):
    processed = "processed"  # searched; a field page exists (it found a moving object)
    empty = "empty"  # searched; no moving object passed vetting, so no field page
    failed = "failed"  # the last search of this tile failed (see SurveyTile.detail)
    pending = "pending"  # covered by SPHEREx, not processed yet
    no_data = "no_data"  # no repeated SPHEREx visits in the releases searched


class SurveyTile(Model):
    tile_id: str
    center: SkyPosition
    ecliptic_lon_deg: float
    ecliptic_lat_deg: float
    size_deg: float
    status: TileStatus
    n_epochs: int
    n_visits: int
    first_time_utc: str | None
    last_time_utc: str | None
    last_processed_utc: str | None
    field_id: str | None = Field(description="Field built for this tile, when processed")
    n_candidates: int
    m50_ab: float | None = Field(
        default=None, description="50% completeness magnitude from injection-recovery, if measured"
    )
    m50_study_id: str | None = Field(default=None, description="Injection study m50_ab comes from")
    detail: str | None = Field(default=None, description="Why the last search failed")


class SurveyRun(Model):
    run_id: str
    started_utc: str
    finished_utc: str
    pipeline_version: str
    n_new_files: int = Field(description="Exposures in tiles this run searched for the first time")
    n_tiles_processed: int = Field(description="Tiles searched in this run")
    n_new_objects: int = Field(description="Objects published by this run that were not before")
    segments: list[str] = []
    n_tiles_with_movers: int = 0
    n_tiles_empty: int = 0
    n_tiles_failed: int = 0
    n_candidates: int = 0
    workflow_url: str | None = None


class SurveyTotals(Model):
    n_tiles: int
    n_processed: int
    area_deg2_processed: float
    n_epochs: int
    n_candidates: int
    n_objects: int
    n_known_objects: int | None = Field(
        default=None,
        description="Distinct JPL designations among matched objects (added by the Worker)",
    )
    n_searched: int = Field(default=0, description="Tiles searched: processed + empty")
    n_empty: int = 0
    n_failed: int = 0
    area_deg2_searched: float = Field(
        default=0.0,
        description="Distinct sky searched (a patch searched in several weeks counts once)",
    )
    sky_fraction_searched: float | None = Field(
        default=None, description="area_deg2_searched / 41,253 deg2 (the whole sky)"
    )


class PlanetNineCell(Model):
    ra_deg: float
    dec_deg: float
    fraction: float = Field(description="Share of the remaining population in this RA/Dec cell")


class PlanetNineRegion(Model):
    """Brown & Batygin's Planet Nine population still open after the ZTF, DES and Pan-STARRS
    searches, binned on the sky (spherex-px planet-nine)."""

    citation: str
    url: str
    epoch_utc: str = Field(description="Sky positions are for this date")
    cell_deg: float
    population: str
    n_population: int
    n_remaining: int
    cells: list[PlanetNineCell]


class SurveyEmptyCells(Model):
    """Searched sky where nothing passed vetting, in compact form (survey.json would otherwise
    grow by a full tile record per searched tile)."""

    size_deg: float = Field(description="Tile size")
    n_tiles: int = Field(
        description="Empty tile searches (a patch searched in two weeks counts twice)"
    )
    positions: list[list[float]] = Field(
        description="[ra_deg, dec_deg] of each distinct empty patch, rounded to 0.01 deg"
    )


class Survey(Envelope):
    build_run_id: str | None = None
    generated_utc: str
    name: str
    description: str
    tile_size_deg: float
    data_releases: list[str]
    tiles: list[SurveyTile] = Field(
        description="Showcase fields, tiles with a field page and failed tiles. Survey tiles "
        "searched with nothing found are in empty_cells (since v1.2)"
    )
    empty_cells: SurveyEmptyCells | None = None
    totals: SurveyTotals
    last_run: SurveyRun | None
    runs: list[SurveyRun] = Field(default=[], description="Most recent runs first (up to 20)")
    planet_nine: PlanetNineRegion | None = Field(
        default=None, description="Published Planet Nine search region (added by the Worker)"
    )


class AiSubjectKind(StrEnum):
    candidate = "candidate"
    object = "object"


class AiWriteup(Envelope):
    subject_kind: AiSubjectKind
    subject_id: str
    verdict: str = Field(description="One line")
    paragraphs: list[str] = Field(description="Three short paragraphs for the public")
    grounded_fields: list[str]
    numeric_check: Literal["passed", "failed", "not_run"]
    source: Literal["ai", "template"] = Field(
        description="template when the AI output failed a check or the AI was unavailable"
    )
    model: str | None = Field(description="Workers AI model ID, null for template text")
    label_plain: str = Field(
        description='"AI-written from the measurements below", or "Written from the measurements below" for template text'
    )
    cached: bool
    generated_utc: str


class AskRequest(Model):
    subject_kind: AiSubjectKind
    subject_id: str
    question: Annotated[str, Field(min_length=1, max_length=500)]
    session_id: Annotated[str, Field(min_length=8, max_length=64)]


class AiAnswer(Envelope):
    subject_kind: AiSubjectKind
    subject_id: str
    question: str
    answer: str
    citations: list[str] = Field(description="JSON paths in the subject's report the answer uses")
    answered_from_data: bool = Field(
        description="False when the model said the data doesn't answer the question"
    )
    numeric_check: Literal["passed", "failed", "not_run"]
    model: str | None
    cached: bool
    generated_utc: str


class SearchRequest(Model):
    query: Annotated[str, Field(min_length=1, max_length=300)]


class SortKey(StrEnum):
    score = "score"
    rate = "rate"
    newest = "newest"
    unusual = "unusual"


class CandidateFilter(Model):
    classification: list[Classification] = []
    rate_min_arcsec_per_hr: float | None = None
    rate_max_arcsec_per_hr: float | None = None
    distance_class: list[DistanceClass] = []
    field_id: list[str] = []
    min_score: Annotated[float, Field(ge=0, le=1)] | None = None
    include_injected: bool = False
    sort: SortKey = SortKey.score


class AiSearch(Envelope):
    query: str
    filter: CandidateFilter
    explanation_plain: str = Field(description="What the filter does, in words")
    valid: bool = Field(description="False when the model's output failed schema validation")
    model: str | None
    cached: bool


class Digest(Envelope):
    date: str
    text: str
    grounded_fields: list[str] = Field(description="JSON paths in the run ledger")
    numeric_check: Literal["passed", "failed", "not_run"]
    run_id: str | None
    model: str | None
    generated_utc: str


class SkyRequestCreate(Model):
    ra_deg: Annotated[float, Field(ge=0, lt=360)]
    dec_deg: Annotated[float, Field(ge=-90, le=90)]
    turnstile_token: Annotated[str, Field(min_length=1, max_length=2048)]
    note: Annotated[str, Field(max_length=200)] | None = None


class SkyRequestStatus(StrEnum):
    queued = "queued"
    processing = "processing"
    done = "done"
    no_coverage = "no_coverage"
    rejected = "rejected"


class SkyRequest(Envelope):
    request_id: str
    status: SkyRequestStatus
    ra_deg: float
    dec_deg: float
    created_utc: str
    updated_utc: str
    position_in_queue: int | None
    field_id: str | None = Field(description="Set when done")
    message: str | None


class VoteLabel(StrEnum):
    real = "real"
    artifact = "artifact"
    unsure = "unsure"


class VettingStamps(Model):
    detection: ImageRef
    reference: ImageRef = Field(description="Same sky from another visit")
    difference: ImageRef


class VettingItem(Envelope):
    item_id: str
    candidate_id: str | None
    epoch_id: str
    stamps: VettingStamps
    model_score: float | None = Field(description="Real-bogus model output in [0, 1]")
    model_version: str | None


class VoteCreate(Model):
    item_id: Annotated[str, Field(min_length=1, max_length=96)]
    label: VoteLabel
    session_id: Annotated[str, Field(min_length=8, max_length=64)]
    turnstile_token: Annotated[str, Field(min_length=1, max_length=2048)]


class VoteCounts(Model):
    real: int
    artifact: int
    unsure: int


class VoteResult(Envelope):
    accepted: bool
    item_id: str
    counts: VoteCounts
    message: str | None


class ModelVersion(Model):
    version: str
    trained_utc: str
    n_train_real: int
    n_train_bogus: int
    n_votes_used: int
    test_precision: float
    test_recall: float
    test_roc_auc: float
    promoted: bool


class VettingStats(Envelope):
    n_votes: int
    n_sessions: int
    n_items_labeled: int = Field(description="Items with >= 5 votes and >= 80% agreement")
    agreement_with_experts: float | None = Field(
        description="Vote agreement on items JPL confirmed or that are injected"
    )
    models: list[ModelVersion]


ALL_RESPONSE_MODELS: dict[str, type[BaseModel]] = {
    "FieldList": FieldList,
    "FieldDetail": FieldDetail,
    "CandidateList": CandidateList,
    "CandidateDetail": CandidateDetail,
    "InjectionStudy": InjectionStudy,
    "InjectionStudyIndex": InjectionStudyIndex,
    "Health": Health,
    "Coverage": Coverage,
    "RunRequest": RunRequest,
    "RunStatus": RunStatus,
    "ErrorResponse": ErrorResponse,
    "ObjectList": ObjectList,
    "ObjectDetail": ObjectDetail,
    "ObjectPrediction": ObjectPrediction,
    "OrbitClones": OrbitClones,
    "OrbitValidation": OrbitValidation,
    "ThermalValidation": ThermalValidation,
    "Survey": Survey,
    "AiWriteup": AiWriteup,
    "AskRequest": AskRequest,
    "AiAnswer": AiAnswer,
    "SearchRequest": SearchRequest,
    "AiSearch": AiSearch,
    "Digest": Digest,
    "SkyRequestCreate": SkyRequestCreate,
    "SkyRequest": SkyRequest,
    "VettingItem": VettingItem,
    "VoteCreate": VoteCreate,
    "VoteResult": VoteResult,
    "VettingStats": VettingStats,
}
