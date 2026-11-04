/**
 * Test doubles shaped like the contract. Values are synthetic (ids start with "test-") and exist
 * only to exercise the Worker's logic; recorded real responses live in shared/fixtures.
 */
import type { CandidateDetail, CandidateList, CandidateSummary, Detection, Source } from "../src/contract";

const source: Source = {
  file: "test.fits",
  obs_id: "TEST_0001_1",
  planeid: null,
  detector: 1,
  archive_url: "https://example.test/test.fits",
  cutout_url: null,
  cutout_method: "s3_byte_range",
  cutout_region_pix: [0, 10, 0, 10],
  data_release: "TEST",
  processing_note: null,
};

export function detection(i: number, ra: number, dec: number, mjd: number): Detection {
  return {
    epoch_id: `e${i}`,
    obs_id: `TEST_000${i}_1`,
    time_utc: new Date((mjd - 40587) * 86400000).toISOString(),
    mjd,
    ra_deg: ra,
    dec_deg: dec,
    pos_err_arcsec: 1,
    x_pix: 1,
    y_pix: 1,
    x_grid: 1,
    y_grid: 1,
    flux_ujy: 1000,
    flux_err_ujy: 50,
    snr: 20 - i,
    wavelength_um_center: 1,
    bandwidth_um: 0.03,
    wavelength_um_range: [0.98, 1.02],
    band_index: 10,
    flag_bits: 0,
    flag_names: [],
    flagged_pixels_in_aperture: 0,
    psf_fit_reduced_chi2: null,
    stamp: { url: "/data/test.webp", width_px: 64, height_px: 64, format: "webp", source },
    spacecraft_geocentric_km: [0, 0, 0],
    source,
  };
}

export function candidate(over: Partial<CandidateDetail> = {}): CandidateDetail {
  const dets = [detection(1, 10.0, 1.0, 60000.0), detection(2, 10.01, 1.0, 60000.5), detection(3, 10.02, 1.0, 60001.0)];
  return {
    schema_version: "1.0",
    pipeline_version: "test",
    candidate_id: "test-cand-1",
    field_id: "test-field",
    classification: "unmatched",
    label_plain: "Unexplained",
    summary_plain: "static",
    thumbnail_url: "/data/test.webp",
    detections: dets,
    motion: {
      model: "linear",
      n_detections: 3,
      time_span_hours: 24,
      rate_arcsec_per_hr: 3,
      rate_err_arcsec_per_hr: 0.1,
      position_angle_deg: 90,
      ra_rate_arcsec_per_hr: 3,
      dec_rate_arcsec_per_hr: 0,
      fit_residual_rms_arcsec: 0.8,
      fit_chi2: 1,
      fit_dof: 2,
      distance_au_estimate: null,
    },
    known_object: {
      checked: false,
      not_checked_reason: "Not checked yet.",
      matched: false,
      catalogs_checked: [],
      search_radius_arcsec: 15,
      designation: null,
      predicted_vmag: null,
      per_epoch: [],
      nearest: null,
      observer: null,
      query_utc: null,
      enrichment: "static",
    },
    scores: {
      motion_consistency: 0.9,
      snr: 0.9,
      artifact_likelihood: 0.1,
      overall: 0.73,
      quality_level: "high",
      method: "rule_based_v1",
      definition: "test",
    },
    vetting: [{ check: "known_object_match", description: "test", value: null, threshold: false, passed: null }],
    error_sources: [],
    explanation: null,
    spectrum: null,
    injection: null,
    provenance: { run_id: "test-run", generated_utc: "2026-10-29T00:00:00Z", parameters: {} },
    disclaimer: "test",
    ...over,
  };
}

export function summary(c: CandidateDetail): CandidateSummary {
  return {
    candidate_id: c.candidate_id,
    field_id: c.field_id,
    classification: c.classification,
    label_plain: c.label_plain,
    summary_plain: c.summary_plain,
    thumbnail_url: c.thumbnail_url,
    detection_count: c.detections.length,
    time_span_hours: c.motion.time_span_hours,
    first_time_utc: c.detections[0]!.time_utc,
    rate_arcsec_per_hr: c.motion.rate_arcsec_per_hr,
    position_angle_deg: c.motion.position_angle_deg,
    mean_snr: 18,
    overall_score: c.scores.overall,
    quality_level: c.scores.quality_level,
    known_object_checked: c.known_object.checked,
    known_object_matched: c.known_object.matched,
    known_object_designation: c.known_object.designation,
  };
}

export function list(cands: CandidateDetail[]): CandidateList {
  return {
    schema_version: "1.0",
    pipeline_version: "test",
    generated_utc: "2026-10-29T00:00:00Z",
    total: cands.length,
    candidates: cands.map(summary),
  };
}

/** SBIdent-shaped body listing one object at the given position. */
export function sbidentBody(name: string, ra: number, dec: number) {
  const hms = (deg: number) => {
    const s = (deg / 15) * 3600;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s - h * 3600) / 60);
    return `${h}:${m}:${(s - h * 3600 - m * 60).toFixed(3)}`;
  };
  const dms = (deg: number) => {
    const sign = deg < 0 ? "-" : "+";
    const s = Math.abs(deg) * 3600;
    const d = Math.floor(s / 3600);
    const m = Math.floor((s - d * 3600) / 60);
    return `${sign}${d} ${m}'${(s - d * 3600 - m * 60).toFixed(2)}"`;
  };
  return {
    fields_second: ["Object name", "Astrometric RA (hh:mm:ss)", "Astrometric Dec (dd mm'ss\")", "Visual magnitude (V)"],
    data_second_pass: [[name, hms(ra), dms(dec), "17.1"]],
  };
}

export function horizonsBody(points: { jd: number; ra: number; dec: number; delta: number }[]) {
  const lines = points.map((p) => ` ${p.jd.toFixed(9)}, , , ${p.ra.toFixed(7)}, ${p.dec.toFixed(7)}, ${p.delta}, -1.0,`);
  return { result: ["$$SOE", ...lines, "$$EOE"].join("\n") };
}
