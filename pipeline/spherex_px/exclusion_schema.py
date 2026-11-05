"""Contract models for the exclusion map (`data/survey/exclusion.json`, `GET /api/exclusion`).

Kept apart from schemas.py so this feature stays in its own files; contract.py exports it with
the other response models.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .schemas import Envelope, Model

Testable = Literal["yes", "partial", "no"]
Reason = Literal[
    "measured",
    "below_linker_minimum",
    "faster_than_study",
    "slower_than_study",
    "brighter_than_study",
    "fainter_than_study",
    "outside_distance_range",
]


class ExclusionSurvey(Model):
    survey_generated_utc: str
    n_patches_searched: int = Field(
        description="Distinct 0.3 deg patches searched successfully (empty or with moving objects)"
    )
    area_deg2_searched: float
    sky_fraction_searched: float = Field(description="area_deg2_searched / 41,253 deg2")
    n_patches_measured: int = Field(
        description="Searched patches whose completeness the injection study measured directly"
    )
    n_failed_searches: int = Field(
        description="Tile searches that failed (not counted as searched)"
    )


class ExclusionLinker(Model):
    min_rate_arcsec_per_hr: float
    max_rate_arcsec_per_hr: float
    min_visits: int
    detect_threshold_snr: float


class CompletenessCell(Model):
    mag_ab: float
    rate_arcsec_per_hr: float
    n_injected: int
    n_recovered: int
    fraction: float


class Completeness(Model):
    """Recovery of SIMULATED linear-track objects (flat F_nu) pooled over the study's tiles."""

    study_id: str
    simulated: Literal[True] = True
    field_ids: list[str]
    n_injected: int
    n_recovered: int
    mag_bins_ab: list[float]
    rate_bins_arcsec_per_hr: list[float]
    cells: list[CompletenessCell]
    pooled_m50_ab: float | None = Field(
        description="50% magnitude pooled over the study's tiles, linear tracks at 3-100 arcsec/hr "
        "(the same definition as each tile's m50_ab)"
    )


class RateAtDistance(Model):
    distance_au: float
    median_rate_arcsec_per_hr: float
    n_injected: int = Field(
        description="SIMULATED objects at this distance (real SPHEREx geometry)"
    )


class ConsistencyRow(Model):
    """The rate-based completeness model against the study's own distance tracks."""

    distance_au: float
    mag_ab: float
    measured_fraction: float = Field(
        description="Parallax-track recovery measured at this distance"
    )
    n_injected: int
    model_fraction: float | None = Field(description="Linear-track grid at the median rate")


class ReachRow(Model):
    distance_au: float
    rate_arcsec_per_hr: float
    best_fraction: float | None = Field(
        description="Highest completeness at any magnitude the study measured (brightest bin)"
    )
    m50_ab: float | None = Field(description="Flat-spectrum AB magnitude of 50% completeness")
    testable: Testable
    reason: Reason


class ReachSummary(Model):
    d_max_50_au: float | None = Field(
        description="Largest distance where a bright enough object is found at least half the "
        "time (completeness interpolated between the study's rates)"
    )
    d_max_any_au: float | None = Field(
        description="Farthest of the study's fixed distances at which any SIMULATED object was "
        "recovered"
    )
    d_linker_limit_au: float | None = Field(
        description="Distance where the sky motion falls to the linker's minimum rate: nothing "
        "beyond it can be found by the current pipeline, however bright"
    )


class SizeLimit(Model):
    distance_au: float
    geometric_albedo: float
    t_int_k: float
    min_diameter_km: float | None = Field(
        description="Smallest planet found at least 50% of the time (conservative band rule); "
        "null where no size is (too slow, or brighter than the study measured)"
    )
    reason: Reason


class BandInfo(Model):
    detector: int
    wl_min_um: float
    wl_max_um: float
    wl_eff_um: float


class ReferencePoint(Model):
    """Model outputs from the pipeline, so the website's port of the model can be checked."""

    diameter_km: float
    geometric_albedo: float
    t_int_k: float
    distance_au: float
    band_mags_ab: list[float] = Field(description="Total (reflected + thermal) AB per detector")
    thermal_mags_ab: list[float | None] = Field(description="Thermal-only AB; null when > 99")
    rate_arcsec_per_hr: float
    completeness_conservative: float | None
    completeness_optimistic: float | None


class MeasuredTile(Model):
    tile_id: str
    ra_deg: float
    dec_deg: float
    m50_ab: float
    delta_mag: float = Field(description="Tile m50 minus pooled m50: shifts the pooled curve")
    planet_nine_weight: float = Field(description="Share of the open Planet Nine region in it")


class PlanetNinePopulationStats(Model):
    n_open: int
    n_open_in_searched: int = Field(
        description="Open members whose 2018 sky position falls inside a searched patch"
    )
    distance_au_p05: float
    distance_au_p50: float
    distance_au_p95: float
    distance_au_min: float
    rate_arcsec_per_hr_max: float = Field(description="Fastest sky motion among open members")
    n_faster_than_linker_minimum: int
    band_mag_ab_p50: float = Field(description="Median faintest-band AB magnitude (our model)")
    v_mag_p50: float = Field(description="Median V magnitude from the population file")
    expected_recovered: float = Field(
        description="Sum over open members in searched patches of the conservative completeness"
    )
    fraction_excluded: float = Field(description="expected_recovered / n_open")


class PlanetNineExclusion(Model):
    citation: str
    url: str
    n_population: int
    n_open: int
    region_fraction_in_searched: float = Field(
        description="Share of the open region (5 deg cell density) lying inside searched patches"
    )
    population: PlanetNinePopulationStats | None = Field(
        description="Member-level numbers, present when the population file was available"
    )


class Exclusion(Envelope):
    build_run_id: str | None = None
    generated_utc: str
    survey: ExclusionSurvey
    linker: ExclusionLinker
    completeness: Completeness
    rate_by_distance: list[RateAtDistance]
    consistency: list[ConsistencyRow]
    reach: list[ReachRow]
    reach_summary: ReachSummary
    size_limits: list[SizeLimit]
    bands: list[BandInfo]
    measured_tiles: list[MeasuredTile]
    planet_nine: PlanetNineExclusion | None
    reference_points: list[ReferencePoint]
    assumptions: list[str]
    references: list[str]
