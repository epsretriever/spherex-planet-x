/**
 * SYNTHETIC TEST DATA for end-to-end tests only.
 *
 * Playwright intercepts /api/* and /static/* in the test browser and answers
 * with the responses below so the UI can be exercised before the backend
 * publishes real data. Nothing here is served by the app or written to
 * public/data/; every name, file and value is visibly synthetic.
 */
import type { Page, Route } from "@playwright/test";
import type {
  AiAnswer,
  AiSearch,
  AiWriteup,
  CandidateDetail,
  CandidateList,
  CandidateSummary,
  Classification,
  Epoch,
  FieldDetail,
  FieldList,
  GridWcs,
  InjectionStudy,
  Mover,
  ObjectDetail,
  ObjectList,
  Survey,
  Source,
} from "../../src/lib/contract";
import { skyToGrid } from "../../src/lib/grid";
import { encodePng } from "./png";

const W = 175;
const H = 175;
const FIELD_ID = "synthetic-test-field";
const STUDY_ID = "synthetic-study";
const PIPE = "0.0.0+synthetic";

const wcs: GridWcs = {
  projection: "TAN",
  crval: [120.0, 20.0],
  crpix: [88, 88],
  cdelt_arcsec: 6.15,
  width_px: W,
  height_px: H,
  rotation_deg: 0,
};

const source = (tag: string): Source => ({
  file: `SYNTHETIC_TEST_${tag}.fits`,
  obs_id: `SYNTHETIC_${tag}`,
  planeid: null,
  detector: 2,
  archive_url: "https://example.invalid/synthetic",
  cutout_url: null,
  cutout_method: "s3_byte_range",
  cutout_region_pix: [0, 0, 175, 175],
  data_release: "SYNTHETIC",
  processing_note: "Synthetic test image",
});

const EPOCHS = [
  { id: "t1", mjd: 61000.1, wl: 1.43 },
  { id: "t2", mjd: 61000.35, wl: 1.44 },
  { id: "t3", mjd: 61001.2, wl: 1.71 },
];

const isoFromMjd = (mjd: number) => new Date((mjd - 40587) * 86400000).toISOString().replace(/\.\d+Z$/, "Z");

const epochs: Epoch[] = EPOCHS.map((e) => ({
  epoch_id: e.id,
  obs_id: `SYNTHETIC_${e.id}`,
  time_utc: isoFromMjd(e.mjd),
  mjd: e.mjd,
  time_start_utc: isoFromMjd(e.mjd - 0.0006),
  time_end_utc: isoFromMjd(e.mjd + 0.0006),
  exposure_s: 112,
  detector: 2,
  bandpass: "SPHEREx-D2",
  wavelength_um_center: e.wl,
  bandwidth_um: 0.035,
  wavelength_um_range: [e.wl - 0.02, e.wl + 0.02],
  band_index: 30,
  image: { url: `/static/synthetic/${e.id}.png`, width_px: W, height_px: H, format: "png", source: source(e.id) },
  flagged_pixel_fraction: 0.01,
  n_detections: 40,
  source: source(e.id),
}));

interface Obj {
  id: string;
  cls: Classification;
  label: string;
  radec: [number, number][];
}

const OBJECTS: Obj[] = [
  { id: "syn-known", cls: "known_object", label: "Synthetic known object", radec: [[120.06, 20.05], [120.045, 20.045], [120.0, 20.03]] },
  { id: "syn-unmatched", cls: "unmatched", label: "Synthetic unexplained mover", radec: [[119.95, 19.94], [119.948, 19.943], [119.94, 19.952]] },
  { id: "syn-injected", cls: "injected", label: "Synthetic injected object", radec: [[120.03, 19.95], [120.032, 19.955], [120.04, 19.97]] },
];

const grid = (ra: number, dec: number) => skyToGrid(ra, dec, wcs)!;

const movers: Mover[] = OBJECTS.map((o) => ({
  candidate_id: o.id,
  classification: o.cls,
  label_plain: o.label,
  quality_level: o.cls === "unmatched" ? "medium" : "high",
  rate_arcsec_per_hr: 30,
  track: o.radec.map(([ra, dec], i) => {
    const g = grid(ra, dec);
    return { epoch_id: EPOCHS[i]!.id, time_utc: epochs[i]!.time_utc, mjd: EPOCHS[i]!.mjd, ra_deg: ra, dec_deg: dec, x_grid: g.x, y_grid: g.y };
  }),
}));

export const field: FieldDetail = {
  schema_version: "1.0",
  pipeline_version: PIPE,
  field_id: FIELD_ID,
  name: "Synthetic test field",
  blurb: "Generated for automated tests.",
  summary_plain: "Synthetic summary for automated tests.",
  center: { ra_deg: 120, dec_deg: 20 },
  ecliptic_lat_deg: 0.5,
  size_deg: { width: 0.3, height: 0.3 },
  thumbnail_url: "/static/synthetic/t1.png",
  data_release: "SYNTHETIC",
  generated_utc: "2026-01-01T00:00:00Z",
  wcs,
  stretch: { type: "asinh", min: 0, max: 1, softening: 0.1, units: "MJy/sr", zodi_subtracted: true },
  epochs,
  blink_pairs: [
    { epoch_id_a: "t1", epoch_id_b: "t2", time_separation_hours: 6, lambda_matched: true, delta_lambda_frac: 0.007, label_plain: "Synthetic matched pair." },
    { epoch_id_a: "t1", epoch_id_b: "t3", time_separation_hours: 26, lambda_matched: false, delta_lambda_frac: 0.18, label_plain: "Synthetic unmatched pair." },
  ],
  movers,
};

const fields: FieldList = {
  schema_version: "1.0",
  pipeline_version: PIPE,
  generated_utc: "2026-01-01T00:00:00Z",
  fields: [
    {
      field_id: FIELD_ID,
      name: field.name,
      blurb: field.blurb,
      center: field.center,
      ecliptic_lat_deg: field.ecliptic_lat_deg,
      size_deg: field.size_deg,
      thumbnail_url: field.thumbnail_url,
      epoch_count: epochs.length,
      date_range: { start_utc: epochs[0]!.time_utc, end_utc: epochs[2]!.time_utc, start_mjd: EPOCHS[0]!.mjd, end_mjd: EPOCHS[2]!.mjd },
      candidate_count: 3,
      candidate_counts: { known_object: 1, unmatched: 1, injected: 1 },
      data_release: "SYNTHETIC",
      origin: "showcase",
    },
  ],
};

function detail(o: Obj): CandidateDetail {
  const mover = movers.find((m) => m.candidate_id === o.id)!;
  const matched = o.cls === "known_object";
  return {
    schema_version: "1.0",
    pipeline_version: PIPE,
    candidate_id: o.id,
    field_id: FIELD_ID,
    classification: o.cls,
    label_plain: o.label,
    summary_plain: `Synthetic summary for ${o.id}.`,
    thumbnail_url: `/static/synthetic/stamp_${o.id}_t1.png`,
    detections: mover.track.map((t, i) => ({
      epoch_id: t.epoch_id,
      obs_id: `SYNTHETIC_${t.epoch_id}`,
      time_utc: t.time_utc,
      mjd: t.mjd,
      ra_deg: t.ra_deg,
      dec_deg: t.dec_deg,
      pos_err_arcsec: 0.9,
      x_pix: 1000 + t.x_grid,
      y_pix: 500 + t.y_grid,
      x_grid: t.x_grid,
      y_grid: t.y_grid,
      flux_ujy: 400 + i * 10,
      flux_err_ujy: 35,
      snr: 11 - i,
      wavelength_um_center: EPOCHS[i]!.wl,
      bandwidth_um: 0.035,
      wavelength_um_range: [EPOCHS[i]!.wl - 0.02, EPOCHS[i]!.wl + 0.02],
      band_index: 30,
      flag_bits: 0,
      flag_names: [],
      flagged_pixels_in_aperture: 0,
      psf_fit_reduced_chi2: 1.1,
      stamp: { url: `/static/synthetic/stamp_${o.id}_${t.epoch_id}.png`, width_px: 64, height_px: 64, format: "png", source: source(t.epoch_id) },
      source: source(t.epoch_id),
    })),
    motion: {
      model: "linear",
      n_detections: 3,
      time_span_hours: 26.4,
      rate_arcsec_per_hr: 30.1,
      rate_err_arcsec_per_hr: 0.4,
      position_angle_deg: 112.4,
      ra_rate_arcsec_per_hr: 27.8,
      dec_rate_arcsec_per_hr: -11.5,
      fit_residual_rms_arcsec: 0.8,
      fit_chi2: 1.2,
      fit_dof: 2,
      distance_au_estimate: null,
    },
    known_object: {
      checked: true,
      not_checked_reason: null,
      matched,
      catalogs_checked: ["JPL SBIdent", "JPL Horizons"],
      search_radius_arcsec: 30,
      designation: matched ? "(99999) Synthetic" : null,
      predicted_vmag: matched ? 17.9 : null,
      per_epoch: matched
        ? mover.track.map((t) => ({ epoch_id: t.epoch_id, predicted_ra_deg: t.ra_deg + 0.0003, predicted_dec_deg: t.dec_deg - 0.0002, separation_arcsec: 1.2 }))
        : [],
      nearest: matched ? null : { designation: "2000 SYN1", separation_arcsec: 410.5 },
      observer: "geocenter",
      query_utc: "2026-01-01T00:00:00Z",
    },
    scores: { motion_consistency: 0.93, snr: 0.88, artifact_likelihood: 0.04, overall: 0.78, quality_level: "high", method: "rule_based_v1", definition: "overall = motion × snr × (1 − artifact)" },
    vetting: [
      { check: "min_detections", description: "At least 3 detections", value: 3, threshold: 3, passed: true },
      { check: "per_detection_snr_min", description: "Weakest detection S/N", value: 9, threshold: 5, passed: true },
      { check: "edge_distance", description: "Distance from cutout edge (px)", value: 12, threshold: 5, passed: true },
      { check: "flux_consistent_across_lambda", description: "Flux consistent across wavelength", value: null, threshold: 0.5, passed: null },
    ],
    error_sources: [
      { id: "cosmic_ray", label: "Cosmic-ray hit or one-off glitch", explanation: "A particle strike makes a dot in one image.", status: "ruled_out", evidence: "Seen in 3 images.", from_checks: ["min_detections"] },
      { id: "detector_artifact", label: "Bad pixels, ghosts or detector defects", explanation: "Hot pixels or ghosts can mimic a source.", status: "ruled_out", evidence: "No flagged pixels.", from_checks: ["edge_distance"] },
      { id: "wavelength_change", label: "Brightness change caused by the filter, not the object", explanation: "Different wavelengths change brightness.", status: "unknown", evidence: null, from_checks: ["flux_consistent_across_lambda"] },
      { id: "catalog_gap", label: "Real object missing from the catalogs we checked", explanation: "Some real objects aren't catalogued.", status: matched ? "ruled_out" : "unknown", evidence: null, from_checks: ["known_object_match"] },
    ],
    explanation: {
      text: `Detected in 3 exposures over 26.4 hours, moving 30.1″/hr toward position angle 112.4°.${matched ? " Positions agree with the prediction to within 1.2″." : ""}`,
      generator: "template_v1",
      grounded_fields: ["motion.n_detections", "motion.time_span_hours", "motion.rate_arcsec_per_hr", "motion.position_angle_deg", ...(matched ? ["known_object.per_epoch[0].separation_arcsec"] : []), "motion.missing_field"],
      numeric_check: "passed",
      generated_utc: "2026-01-01T00:00:00Z",
    },
    spectrum: {
      units: { wavelength: "um", flux: "uJy" },
      points: EPOCHS.map((e, i) => ({ band_index: 30 + i, wavelength_um: e.wl, flux_ujy: 400 + i * 10, flux_err_ujy: 35, epoch_id: e.id })),
    },
    injection:
      o.cls === "injected"
        ? {
            study_id: STUDY_ID,
            injection_id: "syn-inj-1",
            injected: { mag_ab: 18.5, flux_ujy: 143, model: "linear", rate_arcsec_per_hr: 30, position_angle_deg: 45, distance_au: null },
            recovered: true,
            recovered_rate_arcsec_per_hr: 29.6,
            position_error_arcsec: 1.1,
          }
        : null,
    provenance: { run_id: "synthetic-run", generated_utc: "2026-01-01T00:00:00Z", parameters: { detect_threshold_sigma: 5 } },
    disclaimer: "Unmatched candidates may be artifacts, measurement errors, or objects missing from catalogs. This is not a discovery claim.",
  };
}

const summaries: CandidateSummary[] = OBJECTS.map((o) => ({
  candidate_id: o.id,
  field_id: FIELD_ID,
  classification: o.cls,
  label_plain: o.label,
  summary_plain: `Synthetic summary for ${o.id}.`,
  thumbnail_url: `/static/synthetic/stamp_${o.id}_t1.png`,
  detection_count: 3,
  time_span_hours: 26.4,
  first_time_utc: epochs[0]!.time_utc,
  // The unexplained one is slow, so speed filters have something to separate.
  rate_arcsec_per_hr: o.cls === "unmatched" ? 4.2 : 30.1,
  position_angle_deg: 112.4,
  mean_snr: 10,
  overall_score: o.cls === "unmatched" ? 0.45 : 0.78,
  quality_level: o.cls === "unmatched" ? "medium" : "high",
  known_object_matched: o.cls === "known_object",
  known_object_designation: o.cls === "known_object" ? "(99999) Synthetic" : null,
}));

const MAGS = [16, 17, 18, 19, 20];
const RATES = [1, 3, 10, 30];
const study: InjectionStudy = {
  schema_version: "1.0",
  pipeline_version: PIPE,
  study_id: STUDY_ID,
  generated_utc: "2026-01-01T00:00:00Z",
  simulated: true,
  field_ids: [FIELD_ID],
  n_injected: 400,
  n_recovered: 250,
  mag_bins_ab: MAGS,
  rate_bins_arcsec_per_hr: RATES,
  grid: MAGS.flatMap((m, i) =>
    RATES.map((r) => {
      const f = Math.max(0, Math.min(1, 1 - i * 0.22 - (r === 1 ? 0.1 : 0)));
      return { mag_ab: m, rate_arcsec_per_hr: r, n_injected: 20, n_recovered: Math.round(f * 20), fraction: Math.round(f * 20) / 20, ci_low: Math.max(0, f - 0.15), ci_high: Math.min(1, f + 0.12) };
    }),
  ),
  m50_by_rate: RATES.map((r, i) => ({ rate_arcsec_per_hr: r, m50_ab: i === 0 ? null : 18.6 + i * 0.1 })),
  false_positives: { n_control_runs: 2, area_deg2: 0.18, n_candidates: 1, rate_per_deg2: 5.6, ci_low_per_deg2: 0.1, ci_high_per_deg2: 31 },
  recovery_criteria: "Synthetic criteria text.",
  method_notes: ["Synthetic method note."],
  example_candidate_ids: ["syn-injected"],
  // Proposed fields (build plan section 5), exercised here so the UI is ready for them.
  ...({
    m50_by_distance: [
      { distance_au: 30, m50_ab: 18.8, n_injected: 40 },
      { distance_au: 100, m50_ab: 18.6, n_injected: 40 },
      { distance_au: 500, m50_ab: null, n_injected: 40 },
    ],
    planet_context: {
      assumptions: { diameter_km: 25000, geometric_albedo: 0.4, phase_function: "Synthetic", thermal_model: "Synthetic", reference: "Synthetic test values" },
      rows: [
        { distance_au: 100, predicted_mag_ab: 17.5, band_um: 1.5, m50_ab: 18.6, verdict: "detected" },
        { distance_au: 500, predicted_mag_ab: 21.0, band_um: 1.5, m50_ab: null, verdict: "missed" },
      ],
    },
  } as object),
};

/** Deterministic pseudo-random numbers for the synthetic sky. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const rand = rng(42);
const STARS = Array.from({ length: 70 }, () => ({ x: rand() * W, y: rand() * H, a: 40 + rand() * 200, s: 0.7 + rand() * 0.8 }));

function skyImage(epochIndex: number, w = W, h = H, center?: { x: number; y: number }) {
  const noise = rng(100 + epochIndex);
  const dots = OBJECTS.map((o) => {
    const t = movers.find((m) => m.candidate_id === o.id)!.track[epochIndex]!;
    return { x: t.x_grid - 1, y: H - t.y_grid, a: 220, s: 0.9 };
  });
  const sources = [...STARS, ...dots];
  const ox = center ? center.x - w / 2 : 0;
  const oy = center ? center.y - h / 2 : 0;
  // The third date has a corner outside the detector: transparent, as real field images are.
  const noData = epochIndex === 2 && !center;
  return encodePng(w, h, (px, py) => {
    const x = px + ox;
    const y = py + oy;
    if (noData && x + y < 50) return [0, 0, 0, 0];
    let v = 14 + noise() * 16;
    for (const st of sources) {
      const d2 = (x - st.x) ** 2 + (y - st.y) ** 2;
      if (d2 < 25) v += st.a * Math.exp(-d2 / (2 * st.s * st.s));
    }
    const c = Math.min(255, Math.round(v));
    return noData ? [c, c, c, 255] : [c, c, c];
  }, noData);
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export interface MockOptions {
  /** Make every /api request fail with this status. */
  failWith?: number;
  /** Answer the AI endpoints (write-up, ask, search). Off by default: they 404, as before the AI ships. */
  ai?: boolean;
  /** Make POST /api/ask fail with this status. */
  askStatus?: number;
  /** Serve the survey's Planet Nine region without its citation (it must not be drawn). */
  surveyWithoutCitation?: boolean;
}

const AI_MODEL = "@synthetic/test-model";

function writeup(id: string): AiWriteup {
  return {
    schema_version: "1.1",
    pipeline_version: PIPE,
    subject_kind: "candidate",
    subject_id: id,
    verdict: "Synthetic verdict: a steady mover seen 3 times.",
    paragraphs: [
      "Synthetic paragraph one. It was caught in 3 images over 26.4 hours.",
      "Synthetic paragraph two. It moved 30.1 arcseconds per hour.",
      "Synthetic paragraph three. Nothing here is a discovery claim.",
    ],
    grounded_fields: ["motion.n_detections", "motion.time_span_hours", "motion.rate_arcsec_per_hr"],
    numeric_check: "passed",
    source: "ai",
    model: AI_MODEL,
    label_plain: "AI-written from the measurements below",
    cached: false,
    generated_utc: "2026-01-01T00:00:00Z",
  };
}

function answer(id: string, question: string): AiAnswer {
  const fromData = !/colou?r|name|who/i.test(question);
  return {
    schema_version: "1.1",
    pipeline_version: PIPE,
    subject_kind: "candidate",
    subject_id: id,
    question,
    answer: fromData
      ? "Synthetic answer: it moved 30.1 arcseconds per hour across 3 sightings."
      : "Synthetic answer: the data doesn't tell us that.",
    citations: fromData ? ["motion.rate_arcsec_per_hr", "motion.n_detections", "detections[0].snr"] : [],
    answered_from_data: fromData,
    numeric_check: fromData ? "passed" : "not_run",
    model: AI_MODEL,
    cached: false,
    generated_utc: "2026-01-01T00:00:00Z",
  };
}

function search(query: string): AiSearch {
  const valid = !/gibberish/i.test(query);
  return {
    schema_version: "1.1",
    pipeline_version: PIPE,
    query,
    filter: valid
      ? { classification: ["unmatched"], rate_min_arcsec_per_hr: null, rate_max_arcsec_per_hr: 10, distance_class: [], field_id: [], min_score: null, include_injected: false, sort: "rate" }
      : { classification: [], rate_min_arcsec_per_hr: null, rate_max_arcsec_per_hr: null, distance_class: [], field_id: [], min_score: null, include_injected: false, sort: "score" },
    explanation_plain: valid ? "Synthetic reading: unexplained objects slower than 10″ per hour, fastest first." : "Synthetic: that didn't make a filter.",
    valid,
    model: AI_MODEL,
    cached: false,
  };
}

/** Object detail: the candidate's report as one object. The known one has a SYNTHETIC orbit with a covariance. */
function objectDetail(o: Obj): ObjectDetail {
  const c = detail(o);
  const known = o.cls === "known_object";
  return {
    schema_version: "1.1",
    pipeline_version: PIPE,
    object_id: `obj-${o.id}`,
    classification: c.classification,
    label_plain: c.label_plain,
    summary_plain: c.summary_plain,
    thumbnail_url: c.thumbnail_url,
    field_ids: [FIELD_ID],
    candidate_ids: [o.id],
    detections: c.detections.map((d) => ({ ...d, field_id: FIELD_ID, candidate_id: o.id })),
    motion: { ...c.motion, distance_au_estimate: known ? { best: 2.6, lo: 2.1, hi: 3.4 } : null },
    distance_class: known ? "main_belt" : "unknown",
    orbit_status: known ? "preliminary" : "none",
    orbit: known
      ? {
          epoch_mjd: 61000.5,
          a_au: 2.71,
          e: 0.14,
          i_deg: 9.3,
          node_deg: 112.5,
          peri_deg: 47.1,
          mean_anomaly_deg: 201.4,
          q_au: 2.33,
          method: "synthetic_test_fit",
          rms_arcsec: 0.82,
          n_detections: 3,
          arc_hours: 26.4,
          covariance: [
            [0.01, 0.0004, 0, 0, 0, 0],
            [0.0004, 0.0004, 0, 0, 0, 0],
            [0, 0, 0.09, 0, 0, 0],
            [0, 0, 0, 0.25, 0, 0],
            [0, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 4],
          ],
          n_clones: 60,
          clones_url: null,
          helio_distance_au: { best: 2.55, lo: 2.31, hi: 2.92 },
          n_ranging_orbits: 40,
          reported_orbit: "Synthetic: a main-belt orbit, roughly 2.7 AU from the Sun.",
          jpl_comparison: { designation: "(99999) Synthetic", delta_a_au: 0.021, delta_e: 0.004, delta_i_deg: 0.12, position_error_arcsec_30d: 14.2 },
        }
      : null,
    known_object: c.known_object,
    scores: c.scores,
    explanation: c.explanation,
    spectrum: c.spectrum,
    history: [{ utc: "2026-01-01T00:00:00Z", run_id: "synthetic-run", change: "Synthetic: linked 3 detections over 3 visits" }],
    provenance: c.provenance,
    disclaimer: c.disclaimer,
  };
}

const objectList: ObjectList = {
  schema_version: "1.1",
  pipeline_version: PIPE,
  generated_utc: "2026-01-01T00:00:00Z",
  total: OBJECTS.length,
  objects: OBJECTS.map((o) => ({
    object_id: `obj-${o.id}`,
    classification: o.cls,
    label_plain: o.label,
    summary_plain: `Synthetic summary for ${o.id}.`,
    thumbnail_url: `/static/synthetic/stamp_${o.id}_t1.png`,
    field_ids: [FIELD_ID],
    candidate_ids: [o.id],
    n_detections: 3,
    n_visits: 2,
    first_time_utc: epochs[0]!.time_utc,
    last_time_utc: epochs[2]!.time_utc,
    arc_hours: 26.4,
    rate_arcsec_per_hr: 30.1,
    distance_class: o.cls === "known_object" ? "main_belt" : "unknown",
    distance_au_estimate: null,
    orbit_status: "none",
    overall_score: 0.5,
    quality_level: "medium",
    known_object_checked: true,
    known_object_matched: o.cls === "known_object",
    known_object_designation: o.cls === "known_object" ? "(99999) Synthetic" : null,
  })),
};

/** Synthetic survey: one searched tile on the mock field, one waiting, and a SYNTHETIC test region. */
export const survey: Survey = {
  schema_version: "1.1",
  pipeline_version: PIPE,
  generated_utc: "2026-01-01T00:00:00Z",
  name: "Synthetic survey",
  description: "Synthetic survey for tests.",
  tile_size_deg: 0.3,
  data_releases: ["SYNTHETIC"],
  tiles: [
    {
      tile_id: FIELD_ID, center: { ra_deg: 120, dec_deg: 20 }, ecliptic_lon_deg: 117.9, ecliptic_lat_deg: -0.4, size_deg: 0.3, status: "processed",
      n_epochs: 3, n_visits: 2, first_time_utc: epochs[0]!.time_utc, last_time_utc: epochs[2]!.time_utc, last_processed_utc: "2026-01-01T00:00:00Z",
      field_id: FIELD_ID, n_candidates: 3, m50_ab: 19.4,
    },
    {
      tile_id: "synthetic-pending-tile", center: { ra_deg: 200, dec_deg: -10 }, ecliptic_lon_deg: 205, ecliptic_lat_deg: 0.2, size_deg: 0.3, status: "pending",
      n_epochs: 0, n_visits: 0, first_time_utc: null, last_time_utc: null, last_processed_utc: null, field_id: null, n_candidates: 0, m50_ab: null,
    },
  ],
  totals: { n_tiles: 2, n_processed: 1, area_deg2_processed: 0.09, n_epochs: 3, n_candidates: 3, n_objects: 3 },
  last_run: null,
  planet_nine: {
    citation: "SYNTHETIC test region (not a real prediction)",
    url: "https://example.invalid/synthetic-region",
    epoch_utc: "2026-01-01T00:00:00Z",
    cell_deg: 10,
    population: "SYNTHETIC members not ruled out",
    n_population: 1000,
    n_remaining: 250,
    cells: [
      { ra_deg: 50, dec_deg: 10, fraction: 0.5 },
      { ra_deg: 60, dec_deg: 10, fraction: 0.3 },
      { ra_deg: 70, dec_deg: 15, fraction: 0.2 },
    ],
  },
};

export async function installMockApi(page: Page, opts: MockOptions = {}) {
  await page.route("**/api/**", async (route) => {
    if (opts.failWith) return json(route, { detail: "synthetic failure" }, opts.failWith);
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/api/fields") return json(route, fields);
    if (path === `/api/fields/${FIELD_ID}`) return json(route, field);
    if (path === "/api/candidates") {
      const cls = url.searchParams.getAll("classification");
      const includeInjected = url.searchParams.get("include_injected") === "true";
      const fieldId = url.searchParams.get("field_id");
      const list = summaries.filter(
        (c) =>
          (!fieldId || c.field_id === fieldId) &&
          (!cls.length || cls.includes(c.classification)) &&
          (c.classification !== "injected" || includeInjected || cls.includes("injected")),
      );
      const body: CandidateList = { schema_version: "1.0", pipeline_version: PIPE, generated_utc: "2026-01-01T00:00:00Z", total: list.length, candidates: list };
      return json(route, body);
    }
    if (path === "/api/objects") return json(route, objectList);
    const obj = path.match(/^\/api\/objects\/obj-([^/]+)$/);
    if (obj) {
      const o = OBJECTS.find((x) => x.id === decodeURIComponent(obj[1]!));
      return o ? json(route, objectDetail(o)) : json(route, { detail: "not found" }, 404);
    }
    if (path === "/api/survey") return json(route, opts.surveyWithoutCitation ? { ...survey, planet_nine: { ...survey.planet_nine!, citation: "" } } : survey);
    if (opts.ai) {
      const w = path.match(/^\/api\/candidates\/(.+)\/writeup$/);
      if (w) return json(route, writeup(decodeURIComponent(w[1]!)));
      const body = route.request().method() === "POST" ? (route.request().postDataJSON() as Record<string, string>) : null;
      if (path === "/api/ask" && body) {
        if (opts.askStatus) return json(route, { detail: `Synthetic ${opts.askStatus} detail.` }, opts.askStatus);
        return json(route, answer(body.subject_id!, body.question!));
      }
      if (path === "/api/search" && body) return json(route, search(body.query!));
    }
    const cand = path.match(/^\/api\/candidates\/([^/]+)$/);
    if (cand) {
      const o = OBJECTS.find((x) => x.id === decodeURIComponent(cand[1]!));
      return o ? json(route, detail(o)) : json(route, { detail: "not found" }, 404);
    }
    if (path === `/api/injection/${STUDY_ID}`) return json(route, study);
    return json(route, { detail: "not found" }, 404);
  });

  await page.route("**/static/synthetic/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!.replace(".png", "");
    const epochIndex = EPOCHS.findIndex((e) => name.endsWith(e.id));
    if (name.startsWith("stamp_")) {
      const id = name.slice("stamp_".length, name.lastIndexOf("_"));
      const t = movers.find((m) => m.candidate_id === id)?.track[epochIndex];
      if (!t) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: "image/png", body: skyImage(epochIndex, 64, 64, { x: t.x_grid - 1, y: H - t.y_grid }) });
    }
    if (epochIndex < 0) return route.fulfill({ status: 404 });
    return route.fulfill({ contentType: "image/png", body: skyImage(epochIndex) });
  });
}

export const SYNTHETIC = { FIELD_ID, STUDY_ID };
