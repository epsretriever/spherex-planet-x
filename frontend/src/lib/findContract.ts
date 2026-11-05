/**
 * Types for GET /api/find and /api/find/suggest (the precovery search), mirroring
 * pipeline/spherex_px/schemas_find.py and shared/schema/Find*.schema.json.
 * frontend/src/lib/findContract.ts is an identical copy (a test keeps them equal).
 */

export interface FindPhysValue {
  value: number;
  sigma: number | null;
  units: string | null;
  /** SBDB's reference for the value (who measured it). */
  ref: string | null;
}

export interface FindObject {
  /** SBDB primary designation, e.g. "433" or "2024 YR4". */
  designation: string;
  full_name: string;
  kind: "asteroid" | "comet";
  numbered: boolean;
  orbit_class: { code: string; name: string } | null;
  diameter_km: FindPhysValue | null;
  albedo: FindPhysValue | null;
  h_mag: FindPhysValue | null;
  sbdb_url: string;
  horizons_url: string;
}

export interface FindMatch {
  designation: string;
  name: string;
}

export interface FindPrediction {
  ra_deg: number;
  dec_deg: number;
  ra_3sigma_arcsec: number | null;
  dec_3sigma_arcsec: number | null;
  /** Horizons' predicted visual magnitude (comets: total magnitude). */
  vmag: number | null;
  delta_au: number | null;
  method: "horizons_exact" | "interpolated_daily";
  /** "spherex": Horizons computed the position as seen from SPHEREx itself. */
  observer: "spherex" | "geocenter";
}

export interface FindMeasurement {
  object_id: string;
  candidate_id: string;
  ra_deg: number;
  dec_deg: number;
  /** Measured minus predicted position, on the sky (arcsec). */
  offset_arcsec: number;
  flux_ujy: number;
  flux_err_ujy: number;
  snr: number;
  wavelength_um_center: number;
  band_index: number | null;
}

export interface FindFrame {
  /** obs_id plus detector, e.g. 2025W23_1C_0164_1D2. */
  frame_id: string;
  obs_id: string;
  detector: number;
  planeid: string | null;
  file: string;
  data_release: string | null;
  /** Exposure midpoint. */
  time_utc: string;
  mjd: number;
  time_start_utc: string;
  time_end_utc: string | null;
  bandpass: string | null;
  wavelength_um_range: [number, number] | null;
  visit: number;
  predicted: FindPrediction;
  measured: FindMeasurement | null;
  /** The file in IRSA's public SPHEREx bucket (cutouts are read from here). */
  archive_url: string;
  irsa_url: string;
  irsa_cutout_url: string;
}

export interface FindVisit {
  index: number;
  start_utc: string;
  end_utc: string;
  n_frames: number;
  n_measured: number;
  predicted_vmag: number | null;
}

export interface FindCatalogLink {
  object_id: string;
  report_path: string;
  n_detections: number;
  first_time_utc: string;
  last_time_utc: string;
}

export interface FindBrightness {
  vmag_min: number | null;
  vmag_max: number | null;
  m50_ab: number | null;
  m50_study_id: string | null;
  verdict: "brighter_than_limit" | "near_limit" | "fainter_than_limit" | "unknown";
  note_plain: string;
}

export interface FindSearch {
  start_utc: string;
  end_utc: string;
  ephemeris_step_days: number;
  n_tap_queries: number;
  services: string[];
  /** False when part of the search was skipped (row limit, call budget or an upstream error). */
  complete: boolean;
  notes: string[];
}

export interface FindResult {
  schema_version: string;
  pipeline_version: string;
  query: string;
  status: "found" | "ambiguous" | "not_found";
  object: FindObject | null;
  matches: FindMatch[];
  n_frames: number;
  n_visits: number;
  truncated: boolean;
  frames: FindFrame[];
  visits: FindVisit[];
  catalog: FindCatalogLink[];
  brightness: FindBrightness | null;
  search: FindSearch | null;
  summary_plain: string;
  why_it_matters_plain: string;
  query_utc: string;
  cached: boolean;
}

export interface FindSuggestion {
  label: string;
  query: string;
  source: "catalog" | "sbdb";
}

export interface FindSuggestions {
  schema_version: string;
  pipeline_version: string;
  query: string;
  suggestions: FindSuggestion[];
}
