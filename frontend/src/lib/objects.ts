import type { DistanceClass, ObjectDetail } from "./contract";

type ObjectDetection = ObjectDetail["detections"][number];

export interface Visit {
  index: number;
  detections: ObjectDetection[];
  start_utc: string;
  end_utc: string;
  start_mjd: number;
  end_mjd: number;
  field_ids: string[];
  candidate_ids: string[];
}

/** A new visit starts when sightings are more than this far apart (docs/api-contract.md: n_visits). */
export const VISIT_GAP_DAYS = 30 / (24 * 60);

/** Groups an object's sightings into visits: clusters of exposures more than 30 minutes apart. */
export function groupVisits(detections: ObjectDetection[]): Visit[] {
  const sorted = [...detections].sort((a, b) => a.mjd - b.mjd);
  const groups: ObjectDetection[][] = [];
  for (const d of sorted) {
    const last = groups.at(-1);
    if (last && d.mjd - last.at(-1)!.mjd <= VISIT_GAP_DAYS) last.push(d);
    else groups.push([d]);
  }
  return groups.map((g, index) => ({
    index,
    detections: g,
    start_utc: g[0]!.time_utc,
    end_utc: g.at(-1)!.time_utc,
    start_mjd: g[0]!.mjd,
    end_mjd: g.at(-1)!.mjd,
    field_ids: [...new Set(g.map((d) => d.field_id).filter(Boolean))],
    candidate_ids: [...new Set(g.map((d) => d.candidate_id).filter(Boolean))],
  }));
}

export interface DistanceClassInfo {
  label: string;
  /** Range in AU from the Sun as documented in the contract; null bounds are open. */
  range: [number | null, number | null] | null;
  plain: string;
}

/** Classes and ranges from docs/api-contract.md ("distance_class"). */
export const DISTANCE_CLASSES: Record<DistanceClass, DistanceClassInfo> = {
  neo: { label: "Near Earth", range: [null, 1.3], plain: "Comes close to Earth's orbit." },
  main_belt: { label: "Main asteroid belt", range: [1.8, 4.2], plain: "Between Mars and Jupiter, where most asteroids are." },
  jupiter_trojan: { label: "Jupiter Trojan", range: [4.8, 5.6], plain: "Shares Jupiter's orbit, leading or trailing the planet." },
  centaur: { label: "Centaur", range: [6, 30], plain: "Among the giant planets, between Jupiter and Neptune." },
  tno: { label: "Beyond Neptune", range: [30, null], plain: "A trans-Neptunian object, in the cold outer solar system." },
  unknown: {
    label: "Distance not known",
    range: null,
    plain: "We couldn't measure a distance precisely enough to place it, or it falls between the ranges.",
  },
};

export const ORBIT_STATUS: Record<ObjectDetail["orbit_status"], string> = {
  none: "No orbit yet",
  preliminary: "Preliminary orbit",
  refined: "Refined orbit",
};
