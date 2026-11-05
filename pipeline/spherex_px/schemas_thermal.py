"""Contract models for asteroid sizes from thermal emission ("How big is it?").

Kept in their own module so the size feature touches ``schemas.py`` only where it attaches:
``ObjectDetail.thermal``, the size fields of ``ObjectSummary`` and ``ThermalValidation`` in the
exported schema list. Produced by ``spherex_px/thermal.py`` (science in ``science/thermal.py``).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from . import SCHEMA_VERSION

SizeStatus = Literal["sized", "upper_limit", "not_sizable"]
GeometrySource = Literal["jpl_horizons", "jpl_elements", "orbit_clones"]
HSource = Literal["jpl_sbdb", "spherex_reflectance"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ThermalPoint(_Model):
    band_index: int | None
    wavelength_um: float
    flux_ujy: float = Field(description="Measured flux")
    reflected_ujy: float = Field(description="Reflected sunlight extrapolated from 0.7-2.6 um")
    excess_ujy: float = Field(description="Measured minus reflected: the heat")
    excess_err_ujy: float = Field(
        description="1-sigma error of the excess: flux error, 7% floor, reflectance fit and a 15% "
        "extrapolation systematic"
    )
    sigma: float = Field(description="excess_ujy / excess_err_ujy")


class ThermalModelCurve(_Model):
    """Best-fit model at one detection's geometry (for plotting over the spectrum)."""

    time_utc: str = Field(description="Detection whose geometry the curve uses")
    wavelength_um: list[float]
    reflected_ujy: list[float]
    thermal_ujy: list[float] = Field(
        description="NEATM heat for the fitted size (or for the upper limit when not sized)"
    )


class JplPhysical(_Model):
    """JPL Small-Body Database physical parameters, when JPL identified the object."""

    designation: str
    h: float | None
    g: float | None
    diameter_km: float | None
    diameter_sigma_km: float | None
    albedo: float | None
    albedo_sigma: float | None
    diameter_ref: str | None = Field(description="SBDB's reference for the diameter (e.g. NEOWISE)")
    sbdb_url: str


class ThermalFit(_Model):
    status: SizeStatus = Field(
        description="sized: heat seen at >= min_sigma in >= min_bands channels; upper_limit: "
        "too cold or faint, only a largest possible size; not_sizable: data or orbit missing"
    )
    status_plain: str
    method: str
    diameter_km: float | None = Field(description="Median of the Monte Carlo draws")
    diameter_lo_km: float | None = Field(description="16th percentile")
    diameter_hi_km: float | None = Field(description="84th percentile")
    diameter_upper_limit_km: float | None = Field(
        description="3-sigma upper limit (84th percentile over the draws) when not sized"
    )
    albedo: float | None = Field(description="Geometric albedo p_V, median of the draws")
    albedo_lo: float | None
    albedo_hi: float | None
    albedo_plain: str | None = Field(description="Dark / medium / bright, in words")
    h: float | None = Field(description="Absolute magnitude used")
    h_sigma: float | None
    h_source: HSource | None
    g: float | None = Field(description="Slope parameter used")
    eta: float | None = Field(description="NEATM beaming parameter (centre of its prior)")
    eta_sigma: float | None
    eta_mode: Literal["fixed", "fitted"]
    t_subsolar_k: float | None = Field(description="Hottest-point temperature of the model")
    r_au: float | None = Field(description="Distance from the Sun at the model's detection")
    delta_au: float | None = Field(description="Distance from SPHEREx at the model's detection")
    alpha_deg: float | None = Field(description="Phase angle at the model's detection")
    geometry_source: GeometrySource | None
    n_thermal_points: int
    n_significant_bands: int
    min_sigma: float
    min_bands: int
    n_mc: int
    points: list[ThermalPoint]
    model: ThermalModelCurve | None
    jpl: JplPhysical | None = None
    caveats: list[str]


class ThermalValidationRow(_Model):
    object_id: str
    designation: str
    status: SizeStatus
    diameter_km: float | None
    diameter_lo_km: float | None
    diameter_hi_km: float | None
    diameter_upper_limit_km: float | None
    jpl_diameter_km: float
    jpl_diameter_sigma_km: float | None
    jpl_diameter_ref: str | None
    ratio: float | None = Field(description="Our diameter / JPL's (sized objects)")
    albedo: float | None
    jpl_albedo: float | None
    h_source: HSource | None
    geometry_source: GeometrySource | None


class ThermalValidation(_Model):
    """Our thermal sizes compared with the diameters in JPL's Small-Body Database."""

    schema_version: Literal["1.0", "1.1", "1.2"] = SCHEMA_VERSION
    pipeline_version: str
    generated_utc: str
    method: str
    n_objects: int = Field(description="Real objects in the published data")
    n_sized: int
    n_upper_limit: int
    n_not_sizable: int
    n_identified: int = Field(description="Objects JPL identified (pipeline or Worker)")
    n_jpl_inputs: int = Field(description="Identified objects whose JPL data was pulled")
    n_with_jpl_diameter: int = Field(description="Identified objects with an SBDB diameter")
    n_compared: int = Field(description="Denominator: sized objects with an SBDB diameter")
    median_ratio: float | None = Field(description="Median of our D / JPL D over n_compared")
    ratio_p16: float | None
    ratio_p84: float | None
    scatter_pct: float | None = Field(
        description="Robust scatter of ln(ratio) (1.4826 x MAD), as a percentage"
    )
    within_1sigma: float | None = Field(
        description="Share whose JPL diameter lies inside our 16-84% range"
    )
    albedo_median_ratio: float | None
    n_upper_limit_compared: int = Field(description="Not sized, with an SBDB diameter")
    upper_limit_consistent: float | None = Field(
        description="Share of those whose JPL diameter is below our upper limit"
    )
    rows: list[ThermalValidationRow]
    note: str
