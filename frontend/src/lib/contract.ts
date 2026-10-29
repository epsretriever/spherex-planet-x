/**
 * Types for the backend API (schema 1.0), mirroring docs/api-contract.md and
 * the JSON Schema exports in shared/schema/. The backend owns the contract:
 * when the two disagree, fix this file.
 *
 * The frontend ignores fields it doesn't know, so additive backend changes
 * don't break it. Fields documented as nullable are always present.
 */

export const SUPPORTED_SCHEMA_MAJOR = 1;

export interface Versioned {
  schema_version?: string;
  pipeline_version: string;
}

/** Provenance for an epoch, detection, field image or stamp. */
export interface Source {
  /** Level 2 file name. */
  file: string;
  /** SPHEREx/IRSA observation ID (the OBSID FITS keyword). */
  obs_id: string;
  planeid?: string | null;
  detector: number;
  /** The full file in the public SPHEREx archive. */
  archive_url: string;
  cutout_url?: string | null;
  cutout_method: "irsa_cutout" | "s3_byte_range";
  cutout_region_pix?: number[] | null;
  data_release: string;
  processing_note?: string | null;
}

export interface ImageRef {
  url: string;
  width_px: number;
  height_px: number;
  format?: "webp" | "png";
  source: Source;
}

export type Classification = "known_object" | "unmatched" | "likely_artifact" | "unconfirmed_pair" | "injected";

export type QualityLevel = "low" | "medium" | "high";

export interface SkyPosition {
  ra_deg: number;
  dec_deg: number;
}

export interface DateRange {
  start_utc: string;
  end_utc: string;
  start_mjd: number;
  end_mjd: number;
}

export interface FieldSummary {
  field_id: string;
  name: string;
  blurb: string;
  center: SkyPosition;
  ecliptic_lat_deg: number;
  size_deg: { width: number; height: number };
  thumbnail_url: string;
  epoch_count: number;
  date_range: DateRange;
  candidate_count: number;
  candidate_counts: Partial<Record<Classification, number>>;
  data_release: string;
  origin?: "showcase" | "run";
}

export interface FieldList extends Versioned {
  generated_utc: string;
  fields: FieldSummary[];
}

/** The one common grid for a field. */
export interface GridWcs {
  projection?: "TAN";
  /** [ra_deg, dec_deg] */
  crval: number[];
  /** 1-based FITS reference pixel [x, y]. */
  crpix: number[];
  cdelt_arcsec: number;
  width_px: number;
  height_px: number;
  rotation_deg?: number;
}

export interface Stretch {
  type?: "asinh";
  min: number;
  max: number;
  softening: number;
  units?: "MJy/sr";
  zodi_subtracted?: boolean;
}

export interface WavelengthFields {
  wavelength_um_center: number;
  bandwidth_um: number;
  /** [min, max] */
  wavelength_um_range: number[];
  band_index?: number | null;
}

export interface Epoch extends WavelengthFields {
  epoch_id: string;
  obs_id: string;
  time_utc: string;
  mjd: number;
  time_start_utc: string;
  time_end_utc: string;
  exposure_s: number;
  detector: number;
  bandpass: string;
  image: ImageRef;
  flagged_pixel_fraction: number;
  n_detections: number;
  source: Source;
}

export interface BlinkPair {
  epoch_id_a: string;
  epoch_id_b: string;
  time_separation_hours: number;
  lambda_matched: boolean;
  delta_lambda_frac: number;
  label_plain: string;
  /** How far a mover seen in both images shifts between them (arcsec); null when none is. */
  displacement_arcsec?: number | null;
  /** The pair the viewer opens with. The backend sends pairs best first and marks one default. */
  default?: boolean;
}

export interface TrackPoint {
  epoch_id: string;
  time_utc: string;
  mjd: number;
  ra_deg: number;
  dec_deg: number;
  /** Common-grid position (1-based FITS convention), for overlays. */
  x_grid: number;
  y_grid: number;
}

export interface Mover {
  candidate_id: string;
  classification: Classification;
  label_plain: string;
  quality_level: QualityLevel;
  rate_arcsec_per_hr: number | null;
  track: TrackPoint[];
}

export interface FieldDetail extends Versioned {
  field_id: string;
  name: string;
  blurb: string;
  summary_plain: string;
  center: SkyPosition;
  ecliptic_lat_deg: number;
  size_deg: { width: number; height: number };
  thumbnail_url: string;
  data_release: string;
  origin?: "showcase" | "run";
  generated_utc: string;
  wcs: GridWcs;
  stretch: Stretch;
  epochs: Epoch[];
  blink_pairs: BlinkPair[];
  movers: Mover[];
}

export interface CandidateSummary {
  candidate_id: string;
  field_id: string;
  classification: Classification;
  label_plain: string;
  summary_plain: string;
  thumbnail_url: string;
  detection_count: number;
  time_span_hours: number;
  first_time_utc: string;
  rate_arcsec_per_hr: number | null;
  position_angle_deg: number | null;
  mean_snr: number;
  overall_score: number;
  quality_level: QualityLevel;
  known_object_matched: boolean;
  known_object_designation: string | null;
}

export interface CandidateList extends Versioned {
  generated_utc: string;
  total: number;
  candidates: CandidateSummary[];
}

export interface Detection extends WavelengthFields {
  epoch_id: string;
  obs_id: string;
  time_utc: string;
  mjd: number;
  ra_deg: number;
  dec_deg: number;
  pos_err_arcsec: number;
  /** Native detector pixels, 0-based. Measurement table only. */
  x_pix: number;
  y_pix: number;
  /** Common grid, for overlays. */
  x_grid: number;
  y_grid: number;
  flux_ujy: number;
  flux_err_ujy: number;
  snr: number;
  flag_bits: number;
  flag_names: string[];
  flagged_pixels_in_aperture: number;
  psf_fit_reduced_chi2: number | null;
  stamp: ImageRef;
  source: Source;
}

export type MotionModel = "linear" | "parallax" | "none";

export interface Motion {
  model: MotionModel;
  n_detections: number;
  time_span_hours: number;
  rate_arcsec_per_hr: number | null;
  rate_err_arcsec_per_hr: number | null;
  position_angle_deg: number | null;
  ra_rate_arcsec_per_hr: number | null;
  dec_rate_arcsec_per_hr: number | null;
  fit_residual_rms_arcsec: number | null;
  fit_chi2: number | null;
  fit_dof: number | null;
  distance_au_estimate?: { best: number; lo: number; hi: number } | null;
}

export interface KnownObjectEpoch {
  epoch_id: string;
  predicted_ra_deg: number;
  predicted_dec_deg: number;
  separation_arcsec: number;
}

export interface KnownObject {
  checked: boolean;
  not_checked_reason?: string | null;
  matched: boolean;
  catalogs_checked: ("JPL SBIdent" | "JPL Horizons")[];
  search_radius_arcsec: number | null;
  designation?: string | null;
  predicted_vmag?: number | null;
  per_epoch?: KnownObjectEpoch[];
  nearest?: { designation: string; separation_arcsec: number } | null;
  observer?: string | null;
  query_utc?: string | null;
  /**
   * Where this result came from. "pending": the Worker is asking JPL right now; fetch the
   * report again in a few seconds for the result.
   */
  enrichment?: "static" | "live" | "cached" | "pending";
}

export interface Scores {
  motion_consistency: number;
  snr: number;
  artifact_likelihood: number;
  overall: number;
  quality_level: QualityLevel;
  method?: "rule_based_v1";
  definition?: string;
}

export interface VettingCheck {
  check: string;
  description: string;
  value: number | boolean | string | null;
  threshold: number | boolean | string | null;
  passed: boolean | null;
}

export type ErrorSourceStatus = "ruled_out" | "not_ruled_out" | "unknown";

export interface ErrorSource {
  id: string;
  label: string;
  explanation: string;
  status: ErrorSourceStatus;
  evidence: string | null;
  from_checks: string[];
}

export interface Explanation {
  text: string;
  generator: string;
  /** JSON paths into the same candidate document; may contain [n]. */
  grounded_fields: string[];
  numeric_check: "passed" | "failed" | "not_run";
  generated_utc: string;
}

export interface SpectrumPoint {
  band_index: number | null;
  wavelength_um: number;
  flux_ujy: number;
  flux_err_ujy: number;
  epoch_id: string;
}

export interface Spectrum {
  units?: { wavelength?: "um"; flux?: "uJy" };
  points: SpectrumPoint[];
}

export interface InjectionInfo {
  study_id: string;
  injection_id: string;
  injected: {
    mag_ab: number;
    flux_ujy: number;
    model: MotionModel;
    rate_arcsec_per_hr: number | null;
    position_angle_deg: number | null;
    distance_au?: number | null;
  };
  recovered: boolean;
  recovered_rate_arcsec_per_hr: number | null;
  position_error_arcsec: number | null;
}

export interface CandidateDetail extends Versioned {
  candidate_id: string;
  field_id: string;
  classification: Classification;
  label_plain: string;
  summary_plain: string;
  thumbnail_url: string;
  detections: Detection[];
  motion: Motion;
  known_object: KnownObject;
  scores: Scores;
  vetting: VettingCheck[];
  error_sources: ErrorSource[];
  explanation: Explanation | null;
  spectrum: Spectrum | null;
  injection?: InjectionInfo | null;
  provenance: { run_id: string; generated_utc: string; parameters: Record<string, number | string | boolean> };
  disclaimer?: string;
}

export interface RecoveryCell {
  mag_ab: number;
  rate_arcsec_per_hr: number;
  n_injected: number;
  n_recovered: number;
  fraction: number;
  ci_low: number;
  ci_high: number;
}

export interface InjectionStudy extends Versioned {
  study_id: string;
  generated_utc: string;
  simulated?: true;
  field_ids: string[];
  n_injected: number;
  n_recovered: number;
  mag_bins_ab: number[];
  rate_bins_arcsec_per_hr: number[];
  grid: RecoveryCell[];
  m50_by_rate: { rate_arcsec_per_hr: number; m50_ab: number | null }[];
  false_positives: {
    n_control_runs: number;
    area_deg2: number;
    n_candidates: number;
    rate_per_deg2: number;
    ci_low_per_deg2: number;
    ci_high_per_deg2: number;
  };
  recovery_criteria: string;
  method_notes: string[];
  example_candidate_ids: string[];
}
