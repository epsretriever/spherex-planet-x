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
  schema_version: "1.0" | "1.1";
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
  build_run_id?: string | null;
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
  build_run_id?: string | null;
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
  /** When this result was measured; results are reused for up to 10 minutes. */
  probed_utc: string;
  cached: boolean;
}

export interface Health extends Envelope {
  build_run_id: string | null;
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

// ---------------------------------------------------------------------------- v1.1

export type DistanceClass = "neo" | "main_belt" | "jupiter_trojan" | "centaur" | "tno" | "unknown";
export type OrbitStatus = "none" | "preliminary" | "refined";

export interface DistanceEstimate {
  best: number;
  lo: number;
  hi: number;
}

export interface JplOrbitComparison {
  designation: string;
  delta_a_au: number;
  delta_e: number;
  delta_i_deg: number;
  position_error_arcsec_30d: number | null;
}

export interface OrbitalElements {
  epoch_mjd: number;
  a_au: number;
  e: number;
  i_deg: number;
  node_deg: number;
  peri_deg: number;
  mean_anomaly_deg: number;
  q_au: number;
  method: "ranging" | "least_squares";
  rms_arcsec: number;
  n_detections: number;
  arc_hours: number;
  covariance: number[][] | null;
  n_clones: number;
  clones_url: string | null;
  jpl_comparison: JplOrbitComparison | null;
}

export interface ObjectDetection extends Detection {
  field_id: string;
  candidate_id: string;
}

export interface ObjectSummary {
  object_id: string;
  classification: Classification;
  label_plain: string;
  summary_plain: string;
  thumbnail_url: string;
  field_ids: string[];
  candidate_ids: string[];
  n_detections: number;
  n_visits: number;
  first_time_utc: string;
  last_time_utc: string;
  arc_hours: number;
  rate_arcsec_per_hr: number | null;
  distance_class: DistanceClass;
  distance_au_estimate: DistanceEstimate | null;
  orbit_status: OrbitStatus;
  overall_score: number;
  quality_level: QualityLevel;
  known_object_checked: boolean;
  known_object_matched: boolean;
  known_object_designation: string | null;
}

export interface ObjectList extends Envelope {
  build_run_id?: string | null;
  generated_utc: string;
  total: number;
  objects: ObjectSummary[];
}

export interface ObjectDetail extends Envelope {
  build_run_id?: string | null;
  object_id: string;
  classification: Classification;
  label_plain: string;
  summary_plain: string;
  thumbnail_url: string;
  field_ids: string[];
  candidate_ids: string[];
  detections: ObjectDetection[];
  motion: Motion;
  distance_class: DistanceClass;
  orbit_status: OrbitStatus;
  orbit: OrbitalElements | null;
  known_object: KnownObject;
  scores: Scores;
  explanation: Explanation | null;
  spectrum: unknown;
  history: { utc: string; run_id: string; change: string }[];
  provenance: { run_id: string; generated_utc: string; parameters: Record<string, unknown> };
  disclaimer: string;
}

export interface PredictionPoint {
  time_utc: string;
  mjd: number;
  ra_deg: number;
  dec_deg: number;
  sigma_major_arcsec: number;
  sigma_minor_arcsec: number;
  sigma_pa_deg: number;
  vmag_estimate: number | null;
}

export interface ObjectPrediction extends Envelope {
  object_id: string;
  generated_utc: string;
  orbit_epoch_mjd: number;
  observer: string;
  days: number;
  points: PredictionPoint[];
}

export type TileStatus = "processed" | "pending" | "no_data";

export interface SurveyTile {
  tile_id: string;
  center: SkyPosition;
  ecliptic_lon_deg: number;
  ecliptic_lat_deg: number;
  size_deg: number;
  status: TileStatus;
  n_epochs: number;
  n_visits: number;
  first_time_utc: string | null;
  last_time_utc: string | null;
  last_processed_utc: string | null;
  field_id: string | null;
  n_candidates: number;
  m50_ab: number | null;
}

export interface Survey extends Envelope {
  build_run_id?: string | null;
  generated_utc: string;
  name: string;
  description: string;
  tile_size_deg: number;
  data_releases: string[];
  tiles: SurveyTile[];
  totals: {
    n_tiles: number;
    n_processed: number;
    area_deg2_processed: number;
    n_epochs: number;
    n_candidates: number;
    n_objects: number;
  };
  last_run: {
    run_id: string;
    started_utc: string;
    finished_utc: string;
    pipeline_version: string;
    n_new_files: number;
    n_tiles_processed: number;
    n_new_objects: number;
  } | null;
}

export type AiSubjectKind = "candidate" | "object";
export type NumericCheck = "passed" | "failed" | "not_run";

export interface AiWriteup extends Envelope {
  subject_kind: AiSubjectKind;
  subject_id: string;
  verdict: string;
  paragraphs: string[];
  grounded_fields: string[];
  numeric_check: NumericCheck;
  source: "ai" | "template";
  model: string | null;
  label_plain: string;
  cached: boolean;
  generated_utc: string;
}

export interface AskRequest {
  subject_kind: AiSubjectKind;
  subject_id: string;
  question: string;
  session_id: string;
}

export interface AiAnswer extends Envelope {
  subject_kind: AiSubjectKind;
  subject_id: string;
  question: string;
  answer: string;
  citations: string[];
  answered_from_data: boolean;
  numeric_check: NumericCheck;
  model: string | null;
  cached: boolean;
  generated_utc: string;
}

export type SortKey = "score" | "rate" | "newest" | "unusual";

export interface CandidateFilter {
  classification: Classification[];
  rate_min_arcsec_per_hr: number | null;
  rate_max_arcsec_per_hr: number | null;
  distance_class: DistanceClass[];
  field_id: string[];
  min_score: number | null;
  include_injected: boolean;
  sort: SortKey;
}

export interface AiSearch extends Envelope {
  query: string;
  filter: CandidateFilter;
  explanation_plain: string;
  valid: boolean;
  model: string | null;
  cached: boolean;
}

export interface Digest extends Envelope {
  date: string;
  text: string;
  grounded_fields: string[];
  numeric_check: NumericCheck;
  run_id: string | null;
  model: string | null;
  generated_utc: string;
}

export type SkyRequestStatus = "queued" | "processing" | "done" | "no_coverage" | "rejected";

export interface SkyRequestCreate {
  ra_deg: number;
  dec_deg: number;
  turnstile_token: string;
  note?: string | null;
}

export interface SkyRequest extends Envelope {
  request_id: string;
  status: SkyRequestStatus;
  ra_deg: number;
  dec_deg: number;
  created_utc: string;
  updated_utc: string;
  position_in_queue: number | null;
  field_id: string | null;
  message: string | null;
}

export type VoteLabel = "real" | "artifact" | "unsure";

export interface VettingItem extends Envelope {
  item_id: string;
  candidate_id: string | null;
  epoch_id: string;
  stamps: { detection: ImageRef; reference: ImageRef; difference: ImageRef };
  model_score: number | null;
  model_version: string | null;
}

export interface VoteCreate {
  item_id: string;
  label: VoteLabel;
  session_id: string;
  turnstile_token: string;
}

export interface VoteResult extends Envelope {
  accepted: boolean;
  item_id: string;
  counts: { real: number; artifact: number; unsure: number };
  message: string | null;
}

export interface VettingStats extends Envelope {
  n_votes: number;
  n_sessions: number;
  n_items_labeled: number;
  agreement_with_experts: number | null;
  models: {
    version: string;
    trained_utc: string;
    n_train_real: number;
    n_train_bogus: number;
    n_votes_used: number;
    test_precision: number;
    test_recall: number;
    test_roc_auc: number;
    promoted: boolean;
  }[];
}
