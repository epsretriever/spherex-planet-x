/**
 * Plain-language text for candidates, generated only from values in the candidate JSON.
 *
 * Every number in an explanation must come from one of its grounded_fields; checkNumbers()
 * verifies that and the generator falls back to a minimal sentence if it ever fails.
 */
import type { CandidateDetail, Classification, ErrorSource, Explanation, KnownObject } from "./contract";

export const LABELS: Record<Classification, string> = {
  known_object: "Known object",
  unmatched: "Unexplained",
  likely_artifact: "Likely artifact",
  unconfirmed_pair: "Unconfirmed pair",
  injected: "SIMULATED",
};

const isComet = (designation: string) => /^(\d*[PCDXI]\/|C\/|P\/)/.test(designation.trim());

export function labelPlain(c: Pick<CandidateDetail, "classification" | "known_object">): string {
  if (c.classification === "known_object" && c.known_object.designation) {
    return isComet(c.known_object.designation) ? "Known comet" : "Known asteroid";
  }
  return LABELS[c.classification];
}

/** Format like the explanation does, so the numeric check compares what readers see. */
export function fmt(x: number, decimals?: number): string {
  const d = decimals ?? (Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2);
  return x.toFixed(d);
}

interface Part {
  text: string;
  fields: string[];
}

function motionParts(c: CandidateDetail): Part[] {
  const m = c.motion;
  const parts: Part[] = [];
  parts.push({
    text: `Detected in ${m.n_detections} SPHEREx exposures spanning ${fmt(m.time_span_hours, 1)} hours.`,
    fields: ["motion.n_detections", "motion.time_span_hours"],
  });
  if (m.rate_arcsec_per_hr !== null && m.position_angle_deg !== null) {
    parts.push({
      text: `It moves ${fmt(m.rate_arcsec_per_hr)} arcseconds per hour toward position angle ${fmt(m.position_angle_deg, 0)} degrees.`,
      fields: ["motion.rate_arcsec_per_hr", "motion.position_angle_deg"],
    });
  }
  if (m.fit_residual_rms_arcsec !== null && m.model !== "none") {
    parts.push({
      text: `A ${m.model === "parallax" ? "straight-line motion plus orbital-parallax" : "straight-line"} fit leaves ${fmt(m.fit_residual_rms_arcsec)} arcseconds of scatter.`,
      fields: ["motion.fit_residual_rms_arcsec"],
    });
  }
  if (m.distance_au_estimate) {
    const d = m.distance_au_estimate;
    parts.push({
      text: `SPHEREx's own orbital parallax puts it roughly ${fmt(d.best)} AU away (range ${fmt(d.hi)} to ${fmt(d.lo)} AU).`,
      fields: ["motion.distance_au_estimate.best", "motion.distance_au_estimate.lo", "motion.distance_au_estimate.hi"],
    });
  }
  // weakest detection
  let iMin = 0;
  c.detections.forEach((d, i) => {
    if (d.snr < c.detections[iMin]!.snr) iMin = i;
  });
  if (c.detections.length > 0) {
    parts.push({
      text: `Its faintest detection has a signal-to-noise ratio of ${fmt(c.detections[iMin]!.snr, 1)}.`,
      fields: [`detections[${iMin}].snr`],
    });
  }
  return parts;
}

function knownParts(k: KnownObject): Part[] {
  if (!k.checked) {
    return [
      {
        text: "It has not been checked against JPL's small-body catalog yet, so it may simply be a known asteroid.",
        fields: ["known_object.checked"],
      },
    ];
  }
  if (k.matched && k.designation) {
    let iMax = 0;
    k.per_epoch.forEach((p, i) => {
      if (p.separation_arcsec > k.per_epoch[iMax]!.separation_arcsec) iMax = i;
    });
    const sep = k.per_epoch[iMax]?.separation_arcsec;
    return [
      {
        text:
          sep === undefined
            ? `Its positions match JPL's prediction for ${k.designation}.`
            : `Its positions match JPL's prediction for ${k.designation} to within ${fmt(sep, 1)} arcseconds at every epoch.`,
        fields: ["known_object.designation", ...(sep === undefined ? [] : [`known_object.per_epoch[${iMax}].separation_arcsec`])],
      },
    ];
  }
  const parts: Part[] = [
    {
      text: `No catalogued asteroid or comet in ${k.catalogs_checked.join(" and ")} was predicted within ${fmt(k.search_radius_arcsec ?? 0, 0)} arcseconds at every epoch.`,
      fields: ["known_object.catalogs_checked", "known_object.search_radius_arcsec"],
    },
  ];
  if (k.nearest) {
    parts.push({
      text: `The closest catalogued object, ${k.nearest.designation}, was ${fmt(k.nearest.separation_arcsec, 1)} arcseconds away.`,
      fields: ["known_object.nearest.designation", "known_object.nearest.separation_arcsec"],
    });
  }
  return parts;
}

const CLOSERS: Record<Classification, string> = {
  known_object: "",
  unmatched:
    "That does not make it new: it could be an imaging artifact, a measurement error, or an object missing from the catalogs.",
  likely_artifact: "At least one quality check failed, so it is most likely an artifact of the detector or processing.",
  unconfirmed_pair: "Two sightings are not enough to confirm motion, so treat this as unconfirmed.",
  injected: "This is a simulated object that we inserted into real images to test the pipeline.",
};

export function buildExplanation(c: CandidateDetail, generatedUtc: string): Explanation {
  const parts = [...motionParts(c), ...(c.classification === "injected" ? [] : knownParts(c.known_object))];
  const closer = CLOSERS[c.classification];
  const text = [...parts.map((p) => p.text), ...(closer ? [closer] : [])].join(" ");
  const grounded = [...new Set(parts.flatMap((p) => p.fields))];
  const check = checkNumbers(text, grounded, c);
  if (check) return { text, generator: "template_v1", grounded_fields: grounded, numeric_check: "passed", generated_utc: generatedUtc };
  const fallback = `Detected in ${c.motion.n_detections} SPHEREx exposures.`;
  return {
    text: fallback,
    generator: "template_v1",
    grounded_fields: ["motion.n_detections"],
    numeric_check: checkNumbers(fallback, ["motion.n_detections"], c) ? "passed" : "failed",
    generated_utc: generatedUtc,
  };
}

/** Resolve a path like "known_object.per_epoch[0].separation_arcsec". */
export function resolvePath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const token of path.match(/[^.[\]]+/g) ?? []) {
    if (cur === null || cur === undefined) return undefined;
    cur = /^\d+$/.test(token) ? (cur as unknown[])[Number(token)] : (cur as Record<string, unknown>)[token];
  }
  return cur;
}

/** True when every number in `text` equals (as displayed) a numeric value at a grounded path. */
export function checkNumbers(text: string, grounded: string[], doc: unknown): boolean {
  let scrubbed = text;
  const nums: number[] = [];
  for (const p of grounded) {
    const v = resolvePath(doc, p);
    if (v === undefined) return false;
    if (typeof v === "number") nums.push(v);
    else if (typeof v === "string") scrubbed = scrubbed.split(v).join(" ");
    else if (Array.isArray(v)) for (const s of v) if (typeof s === "string") scrubbed = scrubbed.split(s).join(" ");
  }
  for (const m of scrubbed.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const shown = m[0];
    const decimals = shown.includes(".") ? shown.split(".")[1]!.length : 0;
    if (!nums.some((n) => n.toFixed(decimals) === shown || Math.abs(n - Number(shown)) < 0.5 * 10 ** -decimals)) {
      return false;
    }
  }
  return true;
}

export function summaryPlain(c: CandidateDetail): string {
  const m = c.motion;
  const span = m.time_span_hours >= 48 ? `${fmt(m.time_span_hours / 24, 1)} days` : `${fmt(m.time_span_hours, 1)} hours`;
  const motion =
    m.rate_arcsec_per_hr !== null
      ? `Moves about ${fmt(m.rate_arcsec_per_hr, m.rate_arcsec_per_hr >= 10 ? 0 : 1)} arcseconds per hour across ${m.n_detections} images over ${span}.`
      : `Seen in ${m.n_detections} images over ${span}.`;
  const k = c.known_object;
  let tail: string;
  if (c.classification === "injected") tail = "This is a simulated object inserted into real SPHEREx images.";
  else if (!k.checked) tail = "Not yet checked against JPL's catalog of known asteroids and comets.";
  else if (k.matched && k.designation) tail = `It matches the known ${isComet(k.designation) ? "comet" : "asteroid"} ${k.designation}.`;
  else if (c.classification === "likely_artifact") tail = "It failed a quality check and is most likely an artifact.";
  else if (c.classification === "unconfirmed_pair") tail = "Only two sightings, so the motion is unconfirmed.";
  else tail = "It does not match any known object we checked.";
  return `${motion} ${tail}`;
}

/** Update the two catalog-related error sources from the known_object block. */
export function catalogErrorSources(c: CandidateDetail): ErrorSource[] {
  const k = c.known_object;
  const out = c.error_sources.filter((e) => e.id !== "known_object" && e.id !== "catalog_gap");
  const injected = c.classification === "injected";
  out.push({
    id: "known_object",
    label: "A catalogued asteroid or comet",
    explanation: "Most moving dots in SPHEREx images are asteroids that are already known.",
    status: injected ? "ruled_out" : !k.checked ? "unknown" : k.matched ? "not_ruled_out" : "ruled_out",
    evidence: injected
      ? "Simulated object; not a real source."
      : !k.checked
        ? (k.not_checked_reason ?? "Not checked against JPL yet.")
        : k.matched
          ? `Matches ${k.designation} (JPL).`
          : `No match in ${k.catalogs_checked.join(" and ")} within ${k.search_radius_arcsec} arcsec.`,
    from_checks: ["known_object_match"],
  });
  out.push({
    id: "catalog_gap",
    label: "A real object missing from the catalogs we checked",
    explanation: "Some real asteroids are faint or newly found and are not in JPL's database yet.",
    status: injected ? "ruled_out" : k.checked && k.matched ? "ruled_out" : "unknown",
    evidence: injected
      ? "Simulated object; not a real source."
      : k.checked && k.matched
        ? "Already catalogued."
        : "Cannot be ruled out from SPHEREx data alone.",
    from_checks: ["known_object_match"],
  });
  return out;
}

/** Apply known-object results and regenerate every text field that depends on them. */
export function applyKnownObject(c: CandidateDetail, known: KnownObject, matched: boolean, nowUtc: string): CandidateDetail {
  const next: CandidateDetail = {
    ...c,
    known_object: known,
    classification: matched && c.classification !== "injected" ? "known_object" : c.classification,
  };
  next.vetting = next.vetting.map((v) =>
    v.check === "known_object_match"
      ? { ...v, value: known.checked ? known.matched : null, passed: known.checked ? !known.matched : null }
      : v,
  );
  next.error_sources = catalogErrorSources(next);
  next.label_plain = labelPlain(next);
  next.summary_plain = summaryPlain(next);
  next.explanation = buildExplanation(next, nowUtc);
  return next;
}
