import type { ObjectDetail } from "./contract";
import { fmt, formatHours, formatRate } from "./format";
import { CLASSIFICATIONS } from "./labels";
import { DISTANCE_CLASSES, ORBIT_STATUS, groupVisits } from "./objects";

export interface CompareRow {
  label: string;
  /** One cell per object; "—" when the value was not measured. */
  values: string[];
  /** Why the row matters, in a few words. */
  hint?: string;
}

const NONE = "—";
const num = (v: number | null | undefined, digits: number, unit = "") => (typeof v === "number" && Number.isFinite(v) ? `${fmt(v, digits)}${unit}` : NONE);

/**
 * The measurements of two (or more) objects, row by row, each formatted as its own report
 * shows it. Only published values: nothing is derived here beyond counting visits.
 */
export function compareRows(objects: ObjectDetail[]): CompareRow[] {
  const row = (label: string, value: (o: ObjectDetail) => string, hint?: string): CompareRow => ({ label, values: objects.map(value), hint });
  return [
    row("Status", (o) => CLASSIFICATIONS[o.classification]?.label ?? o.label_plain),
    row(
      "JPL catalog check",
      (o) =>
        o.classification === "injected"
          ? "Not checked (simulated)"
          : !o.known_object.checked
            ? "Not checked yet"
            : o.known_object.matched
              ? (o.known_object.designation ?? "Known object")
              : "No known object matched",
    ),
    row("Sightings", (o) => String(o.detections.length)),
    row("Visits", (o) => String(groupVisits(o.detections).length), "Sets of images more than 30 minutes apart"),
    row("Tracked over", (o) => formatHours(o.motion.time_span_hours)),
    row("Speed across the sky", (o) => formatRate(o.motion.rate_arcsec_per_hr)),
    row("Direction of motion", (o) => num(o.motion.position_angle_deg, 0, "° east of north")),
    row("Fit scatter", (o) => num(o.motion.fit_residual_rms_arcsec, 2, "″"), "How closely the sightings follow one smooth path"),
    row("Where", (o) => DISTANCE_CLASSES[o.distance_class]?.label ?? NONE),
    row(
      "Distance from the Sun",
      (o) => {
        const h = o.orbit?.helio_distance_au;
        return h ? `${fmt(h.best, 2)} AU (${fmt(h.lo, 2)}–${fmt(h.hi, 2)})` : NONE;
      },
      "Median and 5–95% range of the orbits that fit",
    ),
    row("Orbit", (o) => ORBIT_STATUS[o.orbit_status]),
    row("Semi-major axis a", (o) => num(o.orbit?.a_au, 3, " AU")),
    row("Eccentricity e", (o) => num(o.orbit?.e, 3)),
    row("Inclination i", (o) => num(o.orbit?.i_deg, 2, "°")),
    row("Signal quality", (o) => o.scores.quality_level),
    row(
      "How unusual",
      (o) => (o.anomaly ? `#${o.anomaly.rank} of ${o.anomaly.n_ranked}` : NONE),
      "Rank among our own tracked objects; 1 is the least like the others",
    ),
  ];
}

/** Rows where the objects differ (rows where every cell is "—" are dropped). */
export function differingRows(rows: CompareRow[]): CompareRow[] {
  return rows.filter((r) => r.values.some((v) => v !== NONE) && new Set(r.values).size > 1);
}
