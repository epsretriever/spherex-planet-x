/**
 * TypeScript mirror of the API contract (docs/api-contract.md).
 * Source of truth: pipeline/spherex_px/schemas.py, exported to shared/schema/*.schema.json.
 */

export type Classification =
  | "known_object"
  | "unmatched"
  | "likely_artifact"
  | "unconfirmed_pair"
  | "injected";
export const CLASSIFICATIONS: readonly Classification[] = [
  "known_object",
  "unmatched",
  "likely_artifact",
  "unconfirmed_pair",
  "injected",
];
export type QualityLevel = "low" | "medium" | "high";
export type ErrorSourceStatus = "ruled_out" | "not_ruled_out" | "unknown";
export type MotionModel = "linear" | "parallax" | "none";

export interface Envelope {
  schema_version: "1.0";
  pipeline_version: string;
}

export interface SkyPosition {
  ra_deg: number;
  dec_deg: number;
}

export interface Source {
  file: string;
  obs_id: string;
  planeid: string | null;
  detector: number;
  archive_url: string;
  cutout_url: string | null;
  cutout_method: "irsa_cutout" | "s3_byte_range";
  cutout_region_pix: [number, number, number, number] | null;
  data_release: string;
  processing_note: string | null;
}

export interface ImageRef {
  url: string;
  width_px: number;
  height_px: number;
  format: "webp" | "png";
  source: Source;
}

export interface Epoch {
  epoch_id: string;
  obs_id: string;
  time_utc: string;
  mjd: number;
  time_start_utc: string;
  time_end_utc: string;
  exposure_s: number;
  detector: number;
  bandpass: string;
  wavelength_um_center: number;
  bandwidth_um: number;
  wavelength_um_range: [number, number];
  band_index: number | null;
  image: ImageRef;
  flagged_pixel_fraction: number;
  n_detections: number;
  spacecraft_geocentric_km: [number, number, number];
  source: Source;
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
  date_range: { start_utc: string; end_utc: string; start_mjd: number; end_mjd: number };
  candidate_count: number;
  candidate_counts: Partial<Record<Classification, number>>;
  data_release: string;
  origin: "showcase" | "run";
}

export interface FieldList extends Envelope {
  generated_utc: string;
  fields: FieldSummary[];
}

export interface FieldDetail extends Envelope {
  field_id: string;
  name: string;
  epochs: Epoch[];
  [key: string]: unknown;
}

export interface Detection {
  epoch_id: string;
  obs_id: string;
  time_utc: string;
  mjd: number;
  ra_deg: number;
  dec_deg: number;
  pos_err_arcsec: number;
  x_pix: number;
  y_pix: number;
  x_grid: number;
  y_grid: number;
  flux_ujy: number;
  flux_err_ujy: number;
  snr: number;
  wavelength_um_center: number;
  bandwidth_um: number;
  wavelength_um_range: [number, number];
  band_index: number | null;
  flag_bits: number;
  flag_names: string[];
  flagged_pixels_in_aperture: number;
  psf_fit_reduced_chi2: number | null;
  stamp: ImageRef;
  spacecraft_geocentric_km: [number, number, number];
  source: Source;
}

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
  distance_au_estimate: { best: number; lo: number; hi: number } | null;
}

export type CatalogName = "JPL SBIdent" | "JPL Horizons";

export interface KnownObject {
  checked: boolean;
  not_checked_reason: string | null;
  matched: boolean;
  catalogs_checked: CatalogName[];
  search_radius_arcsec: number | null;
  designation: string | null;
  predicted_vmag: number | null;
  per_epoch: {
    epoch_id: string;
    predicted_ra_deg: number;
    predicted_dec_deg: number;
    separation_arcsec: number;
  }[];
  nearest: { designation: string; separation_arcsec: number } | null;
  observer: string | null;
  query_utc: string | null;
  enrichment: "static" | "live" | "cached" | "pending";
}

export interface Scores {
  motion_consistency: number;
  snr: number;
  artifact_likelihood: number;
  overall: number;
  quality_level: QualityLevel;
  method: "rule_based_v1";
  definition: string;
}

export interface VettingCheck {
  check: string;
  description: string;
  value: number | boolean | string | null;
  threshold: number | boolean | string | null;
  passed: boolean | null;
}

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
  grounded_fields: string[];
  numeric_check: "passed" | "failed" | "not_run";
  generated_utc: string;
}

export interface CandidateDetail extends Envelope {
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
  spectrum: unknown;
  injection: unknown;
  provenance: { run_id: string; generated_utc: string; parameters: Record<string, unknown> };
  disclaimer: string;
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
  known_object_checked: boolean;
  known_object_matched: boolean;
  known_object_designation: string | null;
}

export interface CandidateList extends Envelope {
  generated_utc: string;
  total: number;
  candidates: CandidateSummary[];
}

export interface UpstreamStatusEntry {
  name: string;
  url: string;
  reachable: boolean;
  http_status: number | null;
  latency_ms: number | null;
  detail: string | null;
}

export interface Health extends Envelope {
  status: "ok" | "degraded";
  checked_utc: string;
  fields_loaded: number;
  candidates_loaded: number;
  upstream: UpstreamStatusEntry[];
}

export interface CoverageEpoch {
  obs_id: string | null;
  planeid: string | null;
  detector: number | null;
  bandpass: string | null;
  time_utc: string;
  mjd: number;
  time_end_utc: string | null;
  wavelength_um_range: [number, number] | null;
  archive_url: string;
  cutout_url: string | null;
}

export interface Coverage extends Envelope {
  center: SkyPosition;
  radius_deg: number;
  searched: string;
  n_epochs: number;
  truncated: boolean;
  epochs: CoverageEpoch[];
}

export interface RunStatus extends Envelope {
  run_id: string;
  status: string;
  progress: number;
  message: string | null;
  request: unknown;
  field_id: string | null;
  created_utc: string;
  updated_utc: string;
}

export interface ErrorResponse {
  detail: string;
  upstream: string | null;
  upstream_status: number | string | null;
}
