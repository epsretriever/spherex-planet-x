/**
 * Candidates for reporting: the JPL half of the test (the pipeline evaluates the rest when the
 * data is published, pipeline/spherex_px/reporting.py).
 *
 * The Worker fills in the three JPL criteria from the catalog check it serves and sets the final
 * status. "ready" means "not in any catalog we checked", never "new" or "discovered": the object
 * may be a known one JPL's search missed, and nothing is reported without the team's review.
 */
import type { KnownObject, Reporting, ReportingCriterion, ReportingStatus } from "./contract";

/** Kept identical to NEARBY_KNOWN_ARCSEC in pipeline/spherex_px/reporting.py. */
export const NEARBY_KNOWN_ARCSEC = 60;

export const REPORTING_LABELS: Record<ReportingStatus, string> = {
  ready: "Not in any catalog we checked — candidate for reporting",
  incomplete: "Catalog check incomplete",
  not_ready: "Not a candidate for reporting",
};

/** The three JPL criteria for a catalog check (unevaluated while it has not run). */
export function jplCriteria(k: KnownObject): ReportingCriterion[] {
  const checked = k.checked && k.enrichment !== "pending";
  const q = k.visits_queried ?? null;
  const a = k.visits_answered ?? null;
  const everyVisit = !checked ? null : q === null || a === null ? null : q > 0 && a === q;
  const nearest = k.nearest?.separation_arcsec ?? null;
  return [
    {
      id: "jpl_every_visit",
      label: "JPL answered for every visit searched",
      passed: everyVisit,
      value: checked && q !== null && a !== null ? `${a} of ${q} visits` : null,
      threshold: "all",
      source: "jpl",
    },
    {
      id: "jpl_no_match",
      label: "No known asteroid or comet at its position",
      passed: checked ? !k.matched : null,
      value: checked ? k.matched : null,
      threshold: false,
      source: "jpl",
    },
    {
      id: "jpl_nothing_nearby",
      label: `No known asteroid or comet within ${NEARBY_KNOWN_ARCSEC}″`,
      // A match is ruled out by the test above; here only an unmatched near neighbor counts.
      passed: !checked ? null : k.matched ? false : nearest === null || nearest > NEARBY_KNOWN_ARCSEC,
      value: checked ? nearest : null,
      threshold: NEARBY_KNOWN_ARCSEC,
      source: "jpl",
    },
  ];
}

export function statusOf(criteria: Pick<ReportingCriterion, "passed">[]): ReportingStatus {
  if (criteria.some((c) => c.passed === false)) return "not_ready";
  if (criteria.some((c) => c.passed === null)) return "incomplete";
  return "ready";
}

function summaryPlain(status: ReportingStatus, criteria: ReportingCriterion[]): string {
  if (status === "ready") {
    return (
      "Passes every test, and JPL's catalog of known asteroids and comets has nothing at or near its " +
      "position at any visit. It is a candidate for the team to review and report to the Minor Planet " +
      "Center; it may still be a known object JPL's search missed."
    );
  }
  const lower = (c: ReportingCriterion) => c.label.charAt(0).toLowerCase() + c.label.slice(1);
  if (status === "incomplete") {
    return `Passes every test measured so far. Not yet evaluated: ${criteria.filter((c) => c.passed === null).map(lower).join("; ")}.`;
  }
  return `Fails: ${criteria.filter((c) => c.passed === false).map(lower).join("; ")}.`;
}

/** The published reporting block with its JPL criteria filled in from this catalog check. */
export function applyReporting(r: Reporting | null | undefined, k: KnownObject): Reporting | null {
  if (!r) return null;
  const criteria = [...r.criteria.filter((c) => c.source !== "jpl"), ...jplCriteria(k)];
  const status = statusOf(criteria);
  return { ...r, status, label_plain: REPORTING_LABELS[status], summary_plain: summaryPlain(status, criteria), criteria };
}

/** A list row's status from its published measurements and this catalog check. */
export function summaryStatus(measurementsPassed: boolean | null | undefined, k: KnownObject): ReportingStatus | null {
  if (measurementsPassed === null || measurementsPassed === undefined) return null;
  return statusOf([{ passed: measurementsPassed }, ...jplCriteria(k)]);
}
