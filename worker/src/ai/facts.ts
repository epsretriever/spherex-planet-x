/**
 * The facts an AI feature may use: a compact copy of a candidate or object report with the SAME
 * JSON paths as the full report, so every path the model cites resolves in the report the
 * frontend shows (and links to).
 */
import type { CandidateDetail, ObjectDetail } from "../contract";

export type Subject = CandidateDetail | ObjectDetail;

const pick = <T extends object, K extends keyof T>(o: T, keys: K[]): Pick<T, K> =>
  Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]])) as Pick<T, K>;

export function facts(s: Subject): Record<string, unknown> {
  const k = s.known_object;
  const out: Record<string, unknown> = {
    classification: s.classification,
    label_plain: s.label_plain,
    summary_plain: s.summary_plain,
    motion: s.motion,
    known_object: {
      checked: k.checked,
      matched: k.matched,
      designation: k.designation,
      catalogs_checked: k.catalogs_checked,
      search_radius_arcsec: k.search_radius_arcsec,
      predicted_vmag: k.predicted_vmag,
      nearest: k.nearest,
      not_checked_reason: k.not_checked_reason,
      per_epoch: k.per_epoch.map((p) => pick(p, ["epoch_id", "separation_arcsec"])),
    },
    scores: pick(s.scores, ["motion_consistency", "snr", "artifact_likelihood", "overall", "quality_level"]),
    detections: s.detections.map((d) =>
      pick(d, ["epoch_id", "time_utc", "wavelength_um_center", "flux_ujy", "flux_err_ujy", "snr", "flag_names"]),
    ),
  };
  if ("vetting" in s) {
    out.vetting = s.vetting.map((v) => pick(v, ["check", "description", "value", "threshold", "passed"]));
    out.error_sources = s.error_sources.map((e) => pick(e, ["id", "label", "status", "evidence"]));
  }
  if ("distance_class" in s) {
    out.distance_class = s.distance_class;
    out.orbit_status = s.orbit_status;
  }
  return out;
}

/** Glossary the Ask feature may draw on for definitions (not for facts about the object). */
export const GLOSSARY: Record<string, string> = {
  SPHEREx: "NASA infrared space telescope that maps the whole sky in 102 colors from 0.75 to 5 micrometers.",
  arcsecond: "1/3600 of a degree. The full Moon is about 1,800 arcseconds across.",
  "signal-to-noise ratio": "How far a measurement stands above the noise; 5 or more is a solid detection.",
  "position angle": "Direction on the sky measured from north through east, in degrees.",
  parallax: "Apparent shift of a nearby object as the observer moves; larger shifts mean closer objects.",
  AU: "Astronomical unit, the average Earth-Sun distance (about 150 million km).",
  "JPL SBIdent": "NASA JPL service that lists known asteroids and comets predicted in a patch of sky at a time.",
  "known object": "An asteroid or comet already in JPL's catalog.",
  "Unexplained": "Not matched to any catalogued object; it may still be an artifact, an error or an uncatalogued real object.",
  "linear variable filter": "SPHEREx's filter whose color changes across the detector, so each image of a spot is at a different wavelength.",
};
