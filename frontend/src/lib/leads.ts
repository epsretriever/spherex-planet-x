import type { CandidateDetail, Classification, DistanceClass, FieldDetail, ObjectPrediction, ObjectSummary } from "./contract";

/**
 * "Unexplained leads": the published objects JPL could not identify, ranked by how much the
 * evidence supports them being real, so a follow-up observer knows where to look first.
 *
 * Everything here is computed from the published measurements (candidate report, motion fit,
 * vetting checks, the orbit prediction). Nothing is invented: a missing input lowers what can be
 * said, it is never filled in.
 */

/** One image of the blink: a field image and where the object was measured on it. */
export interface LeadFrame {
  epoch_id: string;
  url: string;
  time_utc: string;
  wavelength_um: number | null;
  x_grid: number;
  y_grid: number;
}

export interface LeadCheck {
  label: string;
  passed: boolean | null;
}

export interface LeadPrediction {
  time_utc: string;
  ra_deg: number;
  dec_deg: number;
  sigma_major_arcsec: number;
  sigma_minor_arcsec: number;
  sigma_pa_deg: number;
  note_plain: string | null;
}

/** What the page needs about one object, extracted at build time (small enough to inline). */
export interface Lead {
  object_id: string;
  candidate_id: string;
  field_id: string;
  name: string;
  classification: Classification;
  n_visits: number;
  n_detections: number;
  arc_hours: number;
  first_time_utc: string;
  last_time_utc: string;
  rate_arcsec_per_hr: number | null;
  position_angle_deg: number | null;
  min_snr: number | null;
  mean_snr: number | null;
  fit_rms_arcsec: number | null;
  pos_err_arcsec: number | null;
  distance_class: DistanceClass;
  distance_au: { best: number; lo: number; hi: number } | null;
  real_bogus: number | null;
  checks: LeadCheck[];
  ruled_out: string[];
  not_ruled_out: string[];
  jpl_note: string | null;
  /** Whether JPL answered for this object (the page overrides it with the live list). */
  jpl_checked: boolean;
  last: { time_utc: string; ra_deg: number; dec_deg: number } | null;
  grid: { width_px: number; height_px: number; cdelt_arcsec: number } | null;
  frames: LeadFrame[];
  prediction: LeadPrediction | null;
}

export interface ScorePart {
  key: "visits" | "snr" | "fit" | "artifacts" | "real_bogus";
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface Confidence {
  /** 0–100. A ranking for follow-up, not a probability that the object is real. */
  score: number;
  level: "strong" | "moderate" | "weak";
  parts: ScorePart[];
}

export const CONFIDENCE_DEFINITION =
  "Follow-up confidence, 0–100: points for separate visits (25), the faintest detection's signal-to-noise (20), how tightly the positions fit one steady motion (20), the share of artifact checks passed (20) and the real-or-bogus classifier (15, only when it has scored the object; otherwise the other parts are rescaled to 100). It ranks leads for follow-up. It is not the probability that an object is real or new.";

/**
 * The vetting checks that test for image artifacts (visits, S/N and the motion fit are scored on
 * their own), with short labels.
 */
export const ARTIFACT_CHECKS: Record<string, string> = {
  flagged_aperture_pixels: "Clear of pixels SPHEREx flags as unreliable",
  psf_like_shape: "Star-like shape, not a cosmic-ray spike",
  edge_distance: "Away from the image edge",
  not_static: "Nothing at its first position on other visits (not a fixed star)",
  flux_consistent_across_lambda: "Steady brightness across wavelengths",
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Groups detection times into visits: exposures less than an hour apart are one visit. */
export function countVisits(timesUtc: string[]): number {
  const t = timesUtc.map((s) => Date.parse(s)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!t.length) return 0;
  let n = 1;
  for (let i = 1; i < t.length; i++) if (t[i]! - t[i - 1]! > 3600_000) n++;
  return n;
}

export function confidence(lead: Pick<Lead, "n_visits" | "min_snr" | "fit_rms_arcsec" | "checks" | "real_bogus">): Confidence {
  const parts: ScorePart[] = [];
  const v = lead.n_visits;
  parts.push({
    key: "visits",
    label: "Separate visits",
    max: 25,
    points: v >= 4 ? 25 : v === 3 ? 20 : v === 2 ? 8 : 0,
    detail: `${v} ${v === 1 ? "visit" : "visits"} (3 or more lets the motion be checked, not just assumed)`,
  });
  const snr = lead.min_snr;
  parts.push({
    key: "snr",
    label: "Signal-to-noise",
    max: 20,
    points: snr == null ? 0 : 20 * clamp01((snr - 4.5) / (20 - 4.5)),
    detail: snr == null ? "no detection S/N published" : `faintest detection S/N ${round1(snr)} (detection threshold 4.5)`,
  });
  const rms = lead.fit_rms_arcsec;
  parts.push({
    key: "fit",
    label: "Linking fit",
    max: 20,
    points: rms == null ? 0 : 20 * clamp01((6 - rms) / (6 - 1)),
    detail: rms == null ? "no motion fit" : `positions scatter ${round1(rms)}″ about one steady motion (pixels are 6.2″)`,
  });
  const scored = lead.checks.filter((c) => c.passed !== null);
  const passed = scored.filter((c) => c.passed).length;
  parts.push({
    key: "artifacts",
    label: "Artifact checks",
    max: 20,
    points: scored.length ? (20 * passed) / scored.length : 0,
    detail: scored.length ? `${passed} of ${scored.length} passed` : "no checks published",
  });
  if (lead.real_bogus != null) {
    parts.push({
      key: "real_bogus",
      label: "Real-or-bogus classifier",
      max: 15,
      points: 15 * clamp01(lead.real_bogus),
      detail: `P(real) ${lead.real_bogus.toFixed(2)} from the image classifier`,
    });
  }
  const got = parts.reduce((a, p) => a + p.points, 0);
  const max = parts.reduce((a, p) => a + p.max, 0);
  const score = Math.round((100 * got) / max);
  for (const p of parts) p.points = round1(p.points);
  return { score, level: score >= 75 ? "strong" : score >= 50 ? "moderate" : "weak", parts };
}

const DISTANCE_WORDS: Record<DistanceClass, string> = {
  neo: "a near-Earth object",
  main_belt: "a main-belt asteroid",
  jupiter_trojan: "a Jupiter Trojan",
  centaur: "a centaur",
  tno: "a trans-Neptunian object",
  unknown: "",
};

/** Plain-language case for, built only from the lead's own numbers. */
export function whyReal(lead: Lead): string[] {
  const out: string[] = [];
  if (lead.n_visits >= 3) out.push(`Seen on ${lead.n_visits} separate visits spread over ${formatArc(lead.arc_hours)}, all lining up on one steady path.`);
  else if (lead.n_visits === 2) out.push(`Seen on 2 separate visits ${formatArc(lead.arc_hours)} apart.`);
  if (lead.min_snr != null && lead.min_snr >= 7) out.push(`Every one of its ${lead.n_detections} detections is clear of the noise (signal-to-noise at least ${round1(lead.min_snr)}).`);
  if (lead.fit_rms_arcsec != null && lead.fit_rms_arcsec <= 2)
    out.push(`Its positions fit a steady motion to within ${round1(lead.fit_rms_arcsec)}″, a fraction of one 6.2″ pixel.`);
  if (lead.ruled_out.length) out.push(`Ruled out by our checks: ${lowerList(lead.ruled_out)}.`);
  if (lead.real_bogus != null && lead.real_bogus >= 0.7) out.push(`The image classifier rates its stamps as real (P = ${lead.real_bogus.toFixed(2)}).`);
  const kind = DISTANCE_WORDS[lead.distance_class];
  if (kind && lead.rate_arcsec_per_hr != null)
    out.push(`Its speed, ${round1(lead.rate_arcsec_per_hr)}″ per hour, and parallax are typical of ${kind}, a kind of body that really exists in large numbers.`);
  return out;
}

/** Plain-language case against (or for it being already known), built from the same data. */
export function whyNot(lead: Lead): string[] {
  const out: string[] = [];
  if (lead.classification === "unconfirmed_pair") out.push("Only two visits link it, so the motion is assumed from two points rather than confirmed by a third.");
  if (lead.classification === "likely_artifact") out.push("Our own checks flag it as a likely artifact.");
  const failed = lead.checks.filter((c) => c.passed === false).map((c) => c.label);
  if (failed.length) out.push(`Failed ${failed.length === 1 ? "check" : "checks"}: ${lowerList(failed)}.`);
  if (lead.min_snr != null && lead.min_snr < 7) out.push(`Its faintest detection is weak (signal-to-noise ${round1(lead.min_snr)}), where noise can mimic a source.`);
  if (lead.fit_rms_arcsec != null && lead.fit_rms_arcsec > 2) out.push(`Its positions scatter ${round1(lead.fit_rms_arcsec)}″ about the fitted motion, so some sightings may belong to something else.`);
  if (lead.jpl_note) out.push(lead.jpl_note);
  out.push(
    "Unexplained is not new: JPL's check only looks within 15″ of each known object's predicted position, so a catalogued asteroid with a poorly known orbit, or a very recent discovery, could still be the answer.",
  );
  if (lead.not_ruled_out.length) out.push(`Not yet ruled out: ${lowerList(lead.not_ruled_out)}.`);
  return out;
}

function lowerList(items: string[]) {
  const l = items.map((s) => s.charAt(0).toLowerCase() + s.slice(1));
  return l.length <= 1 ? (l[0] ?? "") : `${l.slice(0, -1).join("; ")} and ${l[l.length - 1]}`;
}

export function formatArc(hours: number) {
  return hours >= 48 ? `${round1(hours / 24)} days` : `${round1(hours)} hours`;
}

/** Shortest readable size of an angle given in arcseconds. */
export function formatAngle(arcsec: number) {
  if (arcsec >= 3600) return `${round1(arcsec / 3600)}°`;
  if (arcsec >= 60) return `${round1(arcsec / 60)}′`;
  return `${round1(arcsec)}″`;
}

export function formatRa(deg: number) {
  const h = (((deg % 360) + 360) % 360) / 15;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const ss = ((h - hh) * 60 - mm) * 60;
  return `${String(hh).padStart(2, "0")}h ${String(mm).padStart(2, "0")}m ${ss.toFixed(1).padStart(4, "0")}s`;
}

export function formatDec(deg: number) {
  const s = deg < 0 ? "−" : "+";
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const sec = ((a - d) * 60 - m) * 60;
  return `${s}${String(d).padStart(2, "0")}° ${String(m).padStart(2, "0")}′ ${sec.toFixed(0).padStart(2, "0")}″`;
}

/** The "what would confirm it" advice, sized to the prediction's uncertainty. */
export function followUpAdvice(lead: Lead): string {
  const p = lead.prediction;
  if (!p) {
    return "No orbit could be fitted yet, so there is no predicted position. More SPHEREx visits of this patch, or a search along its measured motion within a few days of its last sighting, are the way to confirm it.";
  }
  const three = 3 * p.sigma_major_arcsec;
  if (three <= 1800)
    return `Image a ${formatAngle(2 * three)} region around the predicted position. Detecting a source there that moves at about ${lead.rate_arcsec_per_hr != null ? round1(lead.rate_arcsec_per_hr) : "the measured"}″/hr in the predicted direction would confirm it; send the measurements to the Minor Planet Center.`;
  return `The orbit is fitted from ${formatArc(lead.arc_hours)} of observations, so today's position is uncertain by about ${formatAngle(p.sigma_major_arcsec)} (1σ): too large for a single telescope pointing. Confirming it needs more SPHEREx visits of this region, or a wide-field survey's archive (for example images taken within days of ${lead.last_time_utc.slice(0, 10)}) searched along the measured motion.`;
}

/** A pipeline error message, without the request URLs it carries. */
export function cleanReason(reason: string): string {
  const cut = reason.search(/\s*\((GET|POST) https?:/);
  if (cut < 0) return reason;
  const rateLimited = /HTTP 429/.test(reason);
  return `${reason.slice(0, cut).trim()}${rateLimited ? " (JPL was limiting how fast we could ask)" : ""}. It is retried on a schedule.`;
}

/** Applies the live JPL status: a note about an unfinished check is dropped once JPL has answered. */
export function withLiveStatus(lead: Lead, checked: boolean | undefined): Lead {
  if (checked === undefined || checked === lead.jpl_checked) return lead;
  if (checked) return { ...lead, jpl_checked: true, jpl_note: lead.jpl_note?.startsWith("The JPL check has not completed") ? null : lead.jpl_note };
  return { ...lead, jpl_checked: false, jpl_note: lead.jpl_note ?? "JPL hasn't answered for this object yet; it is re-checked on a schedule." };
}

/** Extracts a lead from the published files (runs at build time and in tests). */
export function buildLead(
  obj: ObjectSummary,
  cand: CandidateDetail,
  name: string,
  field: Pick<FieldDetail, "epochs" | "wcs"> | null,
  prediction: (ObjectPrediction & { note_plain?: string | null }) | null,
  now: Date = new Date(),
): Lead {
  const dets = [...cand.detections].sort((a, b) => a.mjd - b.mjd);
  const snrs = dets.map((d) => d.snr).filter(Number.isFinite);
  const rb = dets.map((d) => d.real_bogus).filter((x): x is number => typeof x === "number");
  const ko = cand.known_object;
  const checks: LeadCheck[] = cand.vetting
    .filter((c) => c.check in ARTIFACT_CHECKS)
    .map((c) => ({ label: ARTIFACT_CHECKS[c.check]!, passed: c.passed }));
  let jpl_note: string | null = null;
  if (!ko.checked && ko.not_checked_reason) jpl_note = `The JPL check has not completed yet: ${cleanReason(ko.not_checked_reason)}`;
  else if (ko.nearest) jpl_note = `The nearest known object JPL found, ${ko.nearest.designation}, was ${round1(ko.nearest.separation_arcsec)}″ away: too far to be a match, but worth a second look.`;

  // Blink frames: the first detection of each visit (up to four), on the field images.
  const frames: LeadFrame[] = [];
  if (field) {
    const byEpoch = new Map(field.epochs.map((e) => [e.epoch_id, e]));
    let lastT = -Infinity;
    for (const d of dets) {
      const t = Date.parse(d.time_utc);
      const e = byEpoch.get(d.epoch_id);
      if (t - lastT > 3600_000 && e?.image?.url) {
        frames.push({ epoch_id: d.epoch_id, url: e.image.url, time_utc: d.time_utc, wavelength_um: d.wavelength_um_center ?? null, x_grid: d.x_grid, y_grid: d.y_grid });
        lastT = t;
      }
    }
  }
  const lastDet = dets[dets.length - 1];
  let pred: LeadPrediction | null = null;
  if (prediction?.points?.length) {
    const nowMs = now.getTime();
    const p = prediction.points.reduce((best, q) =>
      Math.abs(Date.parse(q.time_utc) - nowMs) < Math.abs(Date.parse(best.time_utc) - nowMs) ? q : best,
    );
    pred = {
      time_utc: p.time_utc,
      ra_deg: p.ra_deg,
      dec_deg: p.dec_deg,
      sigma_major_arcsec: p.sigma_major_arcsec,
      sigma_minor_arcsec: p.sigma_minor_arcsec,
      sigma_pa_deg: p.sigma_pa_deg,
      note_plain: prediction.note_plain ?? null,
    };
  }
  return {
    object_id: obj.object_id,
    candidate_id: cand.candidate_id,
    field_id: cand.field_id,
    name,
    classification: obj.classification,
    n_visits: obj.n_visits || countVisits(dets.map((d) => d.time_utc)),
    n_detections: dets.length,
    arc_hours: obj.arc_hours,
    first_time_utc: obj.first_time_utc,
    last_time_utc: obj.last_time_utc,
    rate_arcsec_per_hr: cand.motion.rate_arcsec_per_hr,
    position_angle_deg: cand.motion.position_angle_deg,
    min_snr: snrs.length ? Math.min(...snrs) : null,
    mean_snr: snrs.length ? snrs.reduce((a, b) => a + b, 0) / snrs.length : null,
    fit_rms_arcsec: cand.motion.fit_residual_rms_arcsec,
    pos_err_arcsec: dets.length ? dets.reduce((a, d) => a + d.pos_err_arcsec, 0) / dets.length : null,
    distance_class: obj.distance_class,
    distance_au: obj.distance_au_estimate,
    real_bogus: rb.length ? rb.reduce((a, b) => a + b, 0) / rb.length : (cand.scores.real_bogus ?? null),
    checks,
    ruled_out: cand.error_sources.filter((e) => e.status === "ruled_out").map((e) => e.label),
    not_ruled_out: cand.error_sources.filter((e) => e.status === "not_ruled_out").map((e) => e.label),
    jpl_note,
    jpl_checked: ko.checked,
    last: lastDet ? { time_utc: lastDet.time_utc, ra_deg: lastDet.ra_deg, dec_deg: lastDet.dec_deg } : null,
    grid: field ? { width_px: field.wcs.width_px, height_px: field.wcs.height_px, cdelt_arcsec: field.wcs.cdelt_arcsec } : null,
    frames,
    prediction: pred,
  };
}

/** Classes the live site counts as "unidentified" (everything JPL hasn't named, minus simulations). */
export function isUnidentified(c: Classification) {
  return c !== "known_object" && c !== "injected";
}

export function rankLeads(leads: Lead[]): (Lead & { confidence: Confidence })[] {
  return leads
    .map((l) => ({ ...l, confidence: confidence(l) }))
    .sort((a, b) => b.confidence.score - a.confidence.score || b.n_detections - a.n_detections || a.object_id.localeCompare(b.object_id));
}
