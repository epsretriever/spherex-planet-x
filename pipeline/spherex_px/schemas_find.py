"""Contract models for the precovery search, GET /api/find (served by the Worker only).

Kept in their own module so the find feature touches schemas.py with a single import line.
The Worker's TypeScript mirror is worker/src/find/contract.ts (re-exported by contract.ts).
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .schemas import Envelope, Model


class FindPhysValue(Model):
    """A physical parameter as JPL's Small-Body Database lists it, with its source."""

    value: float
    sigma: float | None = Field(description="1-sigma uncertainty as listed by SBDB, or null")
    units: str | None
    ref: str | None = Field(description="SBDB's reference for the value (who measured it)")


class FindOrbitClass(Model):
    code: str
    name: str


class FindObject(Model):
    designation: str = Field(description="SBDB primary designation (pdes), e.g. '433' or '2024 YR4'")
    full_name: str
    kind: Literal["asteroid", "comet"]
    numbered: bool
    orbit_class: FindOrbitClass | None
    diameter_km: FindPhysValue | None
    albedo: FindPhysValue | None
    h_mag: FindPhysValue | None
    sbdb_url: str = Field(description="JPL Small-Body Database page")
    horizons_url: str = Field(description="JPL Horizons, the ephemeris service used for the predictions")


class FindMatch(Model):
    """One of several objects SBDB matched to an ambiguous query."""

    designation: str
    name: str


class FindPrediction(Model):
    ra_deg: float
    dec_deg: float
    ra_3sigma_arcsec: float | None = Field(description="Horizons' 3-sigma RA uncertainty, null if not given")
    dec_3sigma_arcsec: float | None = Field(description="Horizons' 3-sigma Dec uncertainty, null if not given")
    vmag: float | None = Field(description="Horizons' predicted visual magnitude (comets: total magnitude T-mag)")
    delta_au: float | None = Field(description="Distance from Earth's center")
    method: Literal["horizons_exact", "interpolated_daily"] = Field(
        description="Horizons at the exposure midpoint, or interpolated from Horizons' daily table"
    )
    observer: Literal["geocenter"] = "geocenter"


class FindMeasurement(Model):
    """Our pipeline's own detection of the object in this frame (only frames we measured)."""

    object_id: str
    candidate_id: str
    ra_deg: float
    dec_deg: float
    offset_arcsec: float = Field(description="Measured minus predicted position, on the sky")
    flux_ujy: float
    flux_err_ujy: float
    snr: float
    wavelength_um_center: float
    band_index: int | None


class FindFrame(Model):
    """One SPHEREx exposure on one detector whose footprint contains the predicted position."""

    frame_id: str = Field(description="obs_id plus detector, e.g. 2025W23_1C_0164_1D2")
    obs_id: str
    detector: int = Field(ge=1, le=6)
    planeid: str | None
    file: str = Field(description="Level 2 file name")
    data_release: str | None
    time_utc: str = Field(description="Exposure midpoint")
    mjd: float
    time_start_utc: str
    time_end_utc: str | None
    bandpass: str | None
    wavelength_um_range: list[float] | None = Field(
        default=None, min_length=2, max_length=2, description="The detector's wavelength range (IRSA)"
    )
    visit: int = Field(ge=0, description="Index into visits[]")
    predicted: FindPrediction
    measured: FindMeasurement | None
    archive_url: str = Field(description="The file in IRSA's public SPHEREx bucket (cutouts read from here)")
    irsa_url: str = Field(description="The file at IRSA")
    irsa_cutout_url: str = Field(description="IRSA's cutout service around the predicted position (FITS)")


class FindVisit(Model):
    """Frames less than 30 minutes apart from each other, grouped."""

    index: int
    start_utc: str
    end_utc: str
    n_frames: int
    n_measured: int
    predicted_vmag: float | None


class FindCatalogLink(Model):
    """An object in our own catalog that JPL identified as this body."""

    object_id: str
    report_path: str
    n_detections: int
    first_time_utc: str
    last_time_utc: str


class FindBrightness(Model):
    vmag_min: float | None
    vmag_max: float | None
    m50_ab: float | None = Field(description="Our pipeline's 50% recovery magnitude, from the injection study")
    m50_study_id: str | None
    verdict: Literal["brighter_than_limit", "near_limit", "fainter_than_limit", "unknown"]
    note_plain: str


class FindSearch(Model):
    start_utc: str
    end_utc: str
    ephemeris_step_days: float
    n_tap_queries: int
    services: list[str] = Field(description="Upstream services that answered")
    complete: bool = Field(description="False when part of the search was skipped (row limit or call budget)")
    notes: list[str]


class FindResult(Envelope):
    query: str
    status: Literal["found", "ambiguous", "not_found"]
    object: FindObject | None
    matches: list[FindMatch]
    n_frames: int
    n_visits: int
    truncated: bool = Field(description="True when more frames matched than are listed")
    frames: list[FindFrame]
    visits: list[FindVisit]
    catalog: list[FindCatalogLink]
    brightness: FindBrightness | None
    search: FindSearch | None
    summary_plain: str
    why_it_matters_plain: str
    query_utc: str
    cached: bool


class FindSuggestion(Model):
    label: str
    query: str
    source: Literal["catalog", "sbdb"]


class FindSuggestions(Envelope):
    query: str
    suggestions: list[FindSuggestion]


FIND_RESPONSE_MODELS = {
    "FindResult": FindResult,
    "FindSuggestions": FindSuggestions,
}
