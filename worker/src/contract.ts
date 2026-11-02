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

/** Paging of a list response (`?limit=&offset=`). Static files carry the whole list. */
export interface Page {
  /** Items matching the filters, before paging. */
  total?: number;
  offset?: number;
  limit?: number | null;
  /** Offset of the next page, or null on the last page. */
  next_offset?: number | null;
}

export interface FieldList extends Envelope, Page {
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
  /** SPHEREx visits sent to JPL SBIdent, and how many it answered (null in older checks). */
  visits_queried?: number | null;
  visits_answered?: number | null;
  enrichment: "static" | "live" | "cached" | "pending";
}

export type ReportingStatus = "ready" | "incomplete" | "not_ready";

/** GET /api/reporting: objects that are candidates for reporting. Nothing is submitted automatically. */
export interface ReportingQueue extends Envelope {
  generated_utc: string;
  label_plain: string;
  counts: { ready: number; incomplete: number; not_ready: number; not_evaluated: number };
  objects: ObjectSummary[];
  ades_urls: Record<string, string>;
  submission: { automatic: false; station_code_configured: boolean; how_plain: string };
}

export interface ReportingCriterion {
  id: string;
  label: string;
  passed: boolean | null;
  value: number | boolean | string | null;
  threshold: number | boolean | string | null;
  source: "pipeline" | "jpl";
}

export interface Reporting {
  status: ReportingStatus;
  label_plain: string;
  summary_plain: string;
  measurements_passed: boolean;
  criteria: ReportingCriterion[];
  definition: string;
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
  reporting?: Reporting | null;
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
  reporting_status?: ReportingStatus | null;
  reporting_measurements_passed?: boolean | null;
}

export interface CandidateList extends Envelope, Page {
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
  /** JPL's elements at our epoch (heliocentric J2000 ecliptic). */
  jpl_a_au?: number;
  jpl_e?: number;
  jpl_i_deg?: number;
  /** Was JPL's position 30 days after our last detection inside our 3-sigma ellipse? */
  inside_3sigma_30d?: boolean | null;
  /** JPL's distance from the Sun at our epoch, and whether our 5-95% interval contains it. */
  jpl_helio_distance_au?: number;
  our_helio_distance_au?: DistanceEstimate | null;
  distance_in_interval?: boolean | null;
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
  /** Distance from the Sun at the epoch: median and 5-95% range of the clones. */
  helio_distance_au?: DistanceEstimate | null;
  /** Sampled orbits that fit the detections (statistical ranging). */
  n_ranging_orbits?: number | null;
  /** Which of the orbits that fit is reported, in plain words. */
  reported_orbit?: string | null;
  /** Predicted geocentric position 30 days after the last detection (clones' centre, 1-sigma ellipse). */
  check_30d?: PredictionPoint | null;
}

/** objects/{id}/clones.json: orbits consistent with the detections (the uncertainty cloud). */
export interface OrbitClones extends Envelope {
  object_id: string;
  epoch_mjd: number;
  frame: string;
  clones: { a_au: number; e: number; i_deg: number; node_deg: number; peri_deg: number; mean_anomaly_deg: number }[];
}

/** validation/orbits.json: orbit fitting tested on simulated asteroids with SPHEREx's real geometry. */
export interface OrbitValidation extends Envelope {
  generated_utc: string;
  simulated: true;
  method: string;
  geometry_from: string[];
  per_population: number;
  seed: number;
  rows: {
    population: string;
    n: number;
    distance_in_5_95_interval: number;
    distance_rel_error_median: number;
    /** Share given a class (at least 68% of clones agree); the rest are "unknown". */
    distance_class_named: number;
    /** Share right among those given a class. */
    distance_class_correct: number | null;
    a_rel_error_median: number;
    e_abs_error_median: number;
    i_abs_error_deg_median: number;
    prediction_30d_error_arcsec_median: number;
    prediction_30d_inside_2sigma: number;
    prediction_30d_inside_3sigma: number;
    refined_fraction: number;
  }[];
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
  reporting_status?: ReportingStatus | null;
  reporting_measurements_passed?: boolean | null;
  /** Other objects matched to the same JPL designation (the same asteroid in other tiles), merged into this one by the Worker. */
  also_seen_as?: string[];
}

export interface ObjectList extends Envelope, Page {
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
  /** Other objects matched to the same JPL designation. */
  also_seen_as?: string[];
  detections: ObjectDetection[];
  motion: Motion;
  distance_class: DistanceClass;
  orbit_status: OrbitStatus;
  orbit: OrbitalElements | null;
  known_object: KnownObject;
  scores: Scores;
  reporting?: Reporting | null;
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
  /** How far the orbit can be trusted, from the clones' spread. */
  note_plain?: string | null;
}

export type TileStatus = "processed" | "empty" | "failed" | "pending" | "no_data";

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
  m50_study_id?: string | null;
  /** Why the last search failed (status "failed"). */
  detail?: string | null;
}

export interface SurveyRun {
  run_id: string;
  started_utc: string;
  finished_utc: string;
  pipeline_version: string;
  n_new_files: number;
  n_tiles_processed: number;
  n_new_objects: number;
  segments?: string[];
  n_tiles_with_movers?: number;
  n_tiles_empty?: number;
  n_tiles_failed?: number;
  n_candidates?: number;
  workflow_url?: string | null;
}

/** Brown & Batygin's Planet Nine population still open after the ZTF, DES and Pan-STARRS searches, binned on the sky. */
export interface PlanetNineRegion {
  citation: string;
  url: string;
  /** Sky positions are for this date. */
  epoch_utc: string;
  cell_deg: number;
  population: string;
  n_population: number;
  n_remaining: number;
  /** RA/Dec bin centres; fraction = share of the remaining population in the bin (sums to 1; empty bins omitted). */
  cells: { ra_deg: number; dec_deg: number; fraction: number }[];
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
    /** Distinct JPL designations among matched objects (from stored JPL results; added by the Worker). */
    n_known_objects?: number | null;
    n_searched?: number;
    n_empty?: number;
    n_failed?: number;
    area_deg2_searched?: number;
  };
  last_run: SurveyRun | null;
  /** Most recent runs first (up to 20). */
  runs?: SurveyRun[];
  planet_nine?: PlanetNineRegion | null;
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
  /** Why template text was served instead of the model's (diagnostics; absent when source is "ai"). */
  fallback_reason?: string;
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

export interface SearchRequest {
  query: string;
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

// ---------------------------------------------------------------------------- injection study

export interface RecoveryCell {
  mag_ab: number;
  rate_arcsec_per_hr: number;
  motion: MotionModel;
  distance_au: number | null;
  n_injected: number;
  n_recovered: number;
  fraction: number;
  ci_low: number;
  ci_high: number;
}

export interface InjectionStudy extends Envelope {
  study_id: string;
  generated_utc: string;
  simulated: true;
  field_ids: string[];
  n_injected: number;
  n_recovered: number;
  mag_bins_ab: number[];
  rate_bins_arcsec_per_hr: number[];
  distance_bins_au: number[];
  grid: RecoveryCell[];
  m50_by_rate: { rate_arcsec_per_hr: number; m50_ab: number | null }[];
  m50_by_distance: { distance_au: number; median_rate_arcsec_per_hr: number; m50_ab: number | null; n_injected: number }[];
  per_field: { field_id: string; n_injected: number; n_recovered: number; m50_ab: number | null }[];
  false_positives: {
    n_control_runs: number;
    area_deg2: number;
    n_candidates: number;
    rate_per_deg2: number;
    ci_low_per_deg2: number;
    ci_high_per_deg2: number;
  };
  recovered_rate_error_median: number | null;
  recovered_position_error_arcsec_median: number | null;
  photometry_check: {
    mag_ab: number;
    n: number;
    measured_over_injected_median: number;
    measured_over_injected_p25: number;
    measured_over_injected_p75: number;
  }[];
  planet_context: PlanetContext | null;
  recovery_criteria: string;
  method_notes: string[];
  example_candidate_ids: string[];
}

export interface PlanetContext {
  assumptions: {
    name: string;
    diameter_km: number;
    geometric_albedo: number;
    band_um: number;
    phase_function: string;
    thermal_model: string;
    reference: string;
  };
  rows: {
    distance_au: number;
    predicted_mag_ab: number;
    band_um: number;
    m50_ab: number | null;
    recovery_fraction_at_predicted: number | null;
    verdict: "detected" | "missed" | "not_tested";
  }[];
}

export interface InjectionStudyIndex extends Envelope {
  build_run_id?: string | null;
  studies: { study_id: string; generated_utc: string; field_ids: string[]; n_injected: number }[];
}
