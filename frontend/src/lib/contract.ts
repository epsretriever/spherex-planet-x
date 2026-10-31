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
  /** False until JPL has answered for this candidate. */
  known_object_checked?: boolean;
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

/* ---- v1.1: objects, survey, AI (docs/api-contract.md, shared/schema/) ---- */

export type DistanceClass = "neo" | "main_belt" | "jupiter_trojan" | "centaur" | "tno" | "unknown";
export type OrbitStatus = "none" | "preliminary" | "refined";

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
  distance_au_estimate: { best: number; lo: number; hi: number } | null;
  orbit_status: OrbitStatus;
  overall_score: number;
  quality_level: QualityLevel;
  known_object_checked: boolean;
  known_object_matched: boolean;
  known_object_designation: string | null;
  /** Other object IDs with the same JPL designation, merged into this entry. */
  also_seen_as?: string[];
}

export interface ObjectList extends Versioned {
  generated_utc: string;
  total: number;
  objects: ObjectSummary[];
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
  method: string;
  rms_arcsec: number;
  n_detections: number;
  arc_hours: number;
  /** 6×6 over [a, e, i, node, peri, M], or null. */
  covariance: number[][] | null;
  n_clones: number;
  clones_url: string | null;
  jpl_comparison: {
    designation: string;
    delta_a_au: number;
    delta_e: number;
    delta_i_deg: number;
    position_error_arcsec_30d: number;
  } | null;
  /** Distance from the Sun at the epoch: median and 5–95% of the clones. */
  helio_distance_au?: { best: number; lo: number; hi: number } | null;
  n_ranging_orbits?: number;
  /** The orbit in one plain-language sentence, from the backend. */
  reported_orbit?: string;
}

export interface ObjectDetail extends Versioned {
  object_id: string;
  classification: Classification;
  label_plain: string;
  summary_plain: string;
  thumbnail_url: string;
  field_ids: string[];
  candidate_ids: string[];
  detections: (Detection & { field_id: string; candidate_id: string })[];
  motion: Motion;
  distance_class: DistanceClass;
  orbit_status: OrbitStatus;
  orbit: OrbitalElements | null;
  known_object: KnownObject;
  scores: Scores;
  explanation: Explanation | null;
  spectrum: Spectrum | null;
  history: { utc: string; run_id: string; change: string }[];
  provenance: CandidateDetail["provenance"];
  disclaimer?: string;
  /** Other objects with the same JPL designation. */
  also_seen_as?: string[];
}

export interface ObjectPrediction extends Versioned {
  object_id: string;
  generated_utc: string;
  orbit_epoch_mjd: number;
  observer: string;
  days: number;
  points: {
    time_utc: string;
    mjd: number;
    ra_deg: number;
    dec_deg: number;
    sigma_major_arcsec: number;
    sigma_minor_arcsec: number;
    sigma_pa_deg: number;
    vmag_estimate: number | null;
  }[];
}

export interface SurveyTile {
  tile_id: string;
  center: SkyPosition;
  ecliptic_lon_deg: number;
  ecliptic_lat_deg: number;
  size_deg: number;
  /** processed: searched, found a mover (field page); empty: searched, nothing passed vetting;
   *  failed: the last search failed (see detail); pending: not searched yet; no_data: no repeat visits. */
  status: "processed" | "empty" | "failed" | "pending" | "no_data";
  /** Why the last search failed, for failed tiles. */
  detail?: string | null;
  m50_study_id?: string | null;
  n_epochs: number;
  n_visits: number;
  first_time_utc: string | null;
  last_time_utc: string | null;
  last_processed_utc: string | null;
  field_id: string | null;
  n_candidates: number;
  /** 50% completeness magnitude from injection-recovery; null until measured. */
  m50_ab: number | null;
}

/**
 * PROPOSED (not yet in docs/api-contract.md): the published Planet Nine search region, binned
 * from Brown & Batygin's reference population by the pipeline. Optional and additive; the map
 * draws nothing without it or without its citation.
 */
export interface PlanetNineRegion {
  citation: string;
  url: string;
  /** Sky positions are for this date. */
  epoch_utc: string;
  cell_deg: number;
  /** Which members were binned, in words; and how many of how many. */
  population?: string;
  n_population?: number;
  n_remaining?: number;
  /** RA/Dec bin centers; fraction is the share of the population in the bin. */
  cells: { ra_deg: number; dec_deg: number; fraction: number }[];
}

export interface Survey extends Versioned {
  generated_utc: string;
  name: string;
  description: string;
  tile_size_deg: number;
  data_releases: string[];
  tiles: SurveyTile[];
  totals: { n_tiles: number; n_processed: number; area_deg2_processed: number; n_epochs: number; n_candidates: number; n_objects: number };
  last_run: {
    run_id: string;
    started_utc: string;
    finished_utc: string;
    pipeline_version: string;
    n_new_files: number;
    n_tiles_processed: number;
    n_new_objects: number;
  } | null;
  planet_nine?: PlanetNineRegion | null;
}

export type AiSubjectKind = "candidate" | "object";

export interface AiWriteup extends Versioned {
  subject_kind: AiSubjectKind;
  subject_id: string;
  verdict: string;
  paragraphs: string[];
  grounded_fields: string[];
  numeric_check: "passed" | "failed" | "not_run";
  /** "template" when the AI output failed a check or the AI was unavailable. */
  source: "ai" | "template";
  /** Workers AI model ID; null for template text. */
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

export interface AiAnswer extends Versioned {
  subject_kind: AiSubjectKind;
  subject_id: string;
  question: string;
  answer: string;
  /** JSON paths in the subject's report. */
  citations: string[];
  /** False when the model said the data doesn't answer the question. */
  answered_from_data: boolean;
  numeric_check: "passed" | "failed" | "not_run";
  model: string | null;
  cached: boolean;
  generated_utc: string;
}

export interface CandidateFilter {
  classification: Classification[];
  rate_min_arcsec_per_hr: number | null;
  rate_max_arcsec_per_hr: number | null;
  distance_class: DistanceClass[];
  field_id: string[];
  min_score: number | null;
  include_injected: boolean;
  sort: "score" | "rate" | "newest" | "unusual";
}

export interface AiSearch extends Versioned {
  query: string;
  filter: CandidateFilter;
  explanation_plain: string;
  /** False when the model's output failed schema validation; the filter is then empty. */
  valid: boolean;
  model: string | null;
  cached: boolean;
}
