import type { CandidateFilter, CandidateSummary, Classification, DistanceClass } from "./contract";
import { CLASSIFICATIONS, isClassification } from "./labels";

/**
 * The Detective page's filter, in the contract's CandidateFilter shape so the
 * natural-language search can hand one straight over. It lives in the URL so a
 * filtered list can be shared:
 *
 *   class=unmatched&class=…  field=…&field=…  rmin=  rmax=  dist=tno&dist=…
 *   min=0.3  sim=1  sort=rate
 */

export type SortKey = CandidateFilter["sort"];

export const SORT_LABELS: Record<SortKey, string> = {
  score: "Highest score",
  rate: "Fastest",
  newest: "Newest",
  unusual: "Most unusual",
};

export const DISTANCE_LABELS: Record<DistanceClass, string> = {
  neo: "Near Earth",
  main_belt: "Main asteroid belt",
  jupiter_trojan: "Jupiter Trojan",
  centaur: "Centaur (between Jupiter and Neptune)",
  tno: "Beyond Neptune",
  unknown: "Distance not measured",
};

export const DISTANCE_ORDER: DistanceClass[] = ["neo", "main_belt", "jupiter_trojan", "centaur", "tno", "unknown"];

const isDistance = (v: string): v is DistanceClass => v in DISTANCE_LABELS;
const isSort = (v: string): v is SortKey => v in SORT_LABELS;

export const EMPTY_FILTER: CandidateFilter = {
  classification: [],
  rate_min_arcsec_per_hr: null,
  rate_max_arcsec_per_hr: null,
  distance_class: [],
  field_id: [],
  min_score: null,
  include_injected: false,
  sort: "score",
};

function num(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const unique = <T,>(xs: T[]) => [...new Set(xs)];

export function filterFromParams(params: URLSearchParams): CandidateFilter {
  const min = num(params.get("min"));
  const sort = params.get("sort") ?? "";
  return {
    classification: unique(params.getAll("class").filter(isClassification)),
    rate_min_arcsec_per_hr: num(params.get("rmin")),
    rate_max_arcsec_per_hr: num(params.get("rmax")),
    distance_class: unique(params.getAll("dist").filter(isDistance)),
    field_id: unique(params.getAll("field").filter(Boolean)),
    min_score: min !== null && min > 0 ? Math.min(1, min) : null,
    include_injected: params.get("sim") === "1",
    sort: isSort(sort) ? sort : "score",
  };
}

const FILTER_KEYS = ["class", "rmin", "rmax", "dist", "field", "min", "sim", "sort"];

/** Writes the filter into a copy of `params`, keeping unrelated parameters. */
export function filterToParams(f: CandidateFilter, params = new URLSearchParams()): URLSearchParams {
  const p = new URLSearchParams(params.toString());
  for (const k of FILTER_KEYS) p.delete(k);
  for (const c of f.classification) p.append("class", c);
  for (const id of f.field_id) p.append("field", id);
  if (f.rate_min_arcsec_per_hr !== null) p.set("rmin", String(f.rate_min_arcsec_per_hr));
  if (f.rate_max_arcsec_per_hr !== null) p.set("rmax", String(f.rate_max_arcsec_per_hr));
  for (const d of f.distance_class) p.append("dist", d);
  if (f.min_score !== null && f.min_score > 0) p.set("min", String(f.min_score));
  if (f.include_injected) p.set("sim", "1");
  if (f.sort !== "score") p.set("sort", f.sort);
  return p;
}

/**
 * Cleans a filter that came from the AI search: drops values the app doesn't
 * know, swaps a reversed speed range and clamps the score to 0–1.
 */
export function normalizeFilter(f: Partial<CandidateFilter> | null | undefined): CandidateFilter {
  const arr = <T,>(v: unknown, ok: (x: string) => x is T & string): T[] =>
    Array.isArray(v) ? unique(v.filter((x): x is T & string => typeof x === "string" && ok(x))) : [];
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  let lo = n(f?.rate_min_arcsec_per_hr);
  let hi = n(f?.rate_max_arcsec_per_hr);
  if (lo !== null && hi !== null && lo > hi) [lo, hi] = [hi, lo];
  const score = n(f?.min_score);
  const sort = typeof f?.sort === "string" && isSort(f.sort) ? f.sort : "score";
  return {
    classification: arr<Classification>(f?.classification, isClassification),
    rate_min_arcsec_per_hr: lo,
    rate_max_arcsec_per_hr: hi,
    distance_class: arr<DistanceClass>(f?.distance_class, isDistance),
    field_id: arr<string>(f?.field_id, (x): x is string => x.length > 0),
    min_score: score !== null && score > 0 ? Math.min(1, score) : null,
    include_injected: f?.include_injected === true,
    sort,
  };
}

/** Whether the filter needs each candidate's distance class (from the objects list). */
export const needsDistance = (f: CandidateFilter) => f.distance_class.length > 0;

/** Applies every part of the filter except the API-side ones already applied, then sorts. */
export function applyFilter(
  list: CandidateSummary[],
  f: CandidateFilter,
  distanceOf?: (candidateId: string) => DistanceClass | undefined,
): CandidateSummary[] {
  const classes = f.classification.length ? new Set<Classification>(f.classification) : null;
  const fields = f.field_id.length ? new Set(f.field_id) : null;
  const dists = f.distance_class.length ? new Set(f.distance_class) : null;
  const out = list.filter((c) => {
    if (c.classification === "injected") {
      if (!f.include_injected) return false;
    } else if (classes && !classes.has(c.classification)) return false;
    if (fields && !fields.has(c.field_id)) return false;
    if (f.min_score !== null && c.overall_score < f.min_score) return false;
    const rate = c.rate_arcsec_per_hr;
    if (f.rate_min_arcsec_per_hr !== null && (rate === null || rate < f.rate_min_arcsec_per_hr)) return false;
    if (f.rate_max_arcsec_per_hr !== null && (rate === null || rate > f.rate_max_arcsec_per_hr)) return false;
    if (dists) {
      const d = distanceOf?.(c.candidate_id) ?? "unknown";
      if (!dists.has(d)) return false;
    }
    return true;
  });
  return out.sort(comparator(f.sort));
}

const byScore = (a: CandidateSummary, b: CandidateSummary) => b.overall_score - a.overall_score || a.candidate_id.localeCompare(b.candidate_id);

function comparator(sort: SortKey) {
  switch (sort) {
    case "rate":
      return (a: CandidateSummary, b: CandidateSummary) => (b.rate_arcsec_per_hr ?? -1) - (a.rate_arcsec_per_hr ?? -1) || byScore(a, b);
    case "newest":
      return (a: CandidateSummary, b: CandidateSummary) => b.first_time_utc.localeCompare(a.first_time_utc) || byScore(a, b);
    case "unusual":
      // The anomaly ranking (build plan row 7); objects it hasn't scored go last, by score. With
      // no anomaly scores published at all, this is plain score order and the sort chip says so.
      return (a: CandidateSummary, b: CandidateSummary) => (b.anomaly_score ?? -1) - (a.anomaly_score ?? -1) || byScore(a, b);
    default:
      return byScore;
  }
}

/** Whether any candidate in the list carries an anomaly score. */
export const hasAnomalyScores = (list: CandidateSummary[]) => list.some((c) => typeof c.anomaly_score === "number");

/** Whether the app can rank by this sort yet ("unusual" needs published anomaly scores). */
export const sortAvailable = (sort: SortKey, hasAnomaly = false) => sort !== "unusual" || hasAnomaly;

export interface FilterChip {
  key: string;
  label: string;
  /** The filter without this chip. */
  without: CandidateFilter;
}

const rateText = (v: number) => `${Number(v.toFixed(1))}″/hr`;

/** One removable chip per active part of the filter, in reading order. */
export function filterChips(f: CandidateFilter, fieldName: (id: string) => string = (id) => id, hasAnomaly = false): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const c of f.classification) {
    chips.push({ key: `class:${c}`, label: CLASSIFICATIONS[c].label, without: { ...f, classification: f.classification.filter((x) => x !== c) } });
  }
  const lo = f.rate_min_arcsec_per_hr;
  const hi = f.rate_max_arcsec_per_hr;
  if (lo !== null || hi !== null) {
    const label =
      lo !== null && hi !== null ? `Speed ${rateText(lo)} – ${rateText(hi)}` : lo !== null ? `Faster than ${rateText(lo)}` : `Slower than ${rateText(hi!)}`;
    chips.push({ key: "rate", label, without: { ...f, rate_min_arcsec_per_hr: null, rate_max_arcsec_per_hr: null } });
  }
  for (const d of f.distance_class) {
    chips.push({ key: `dist:${d}`, label: DISTANCE_LABELS[d], without: { ...f, distance_class: f.distance_class.filter((x) => x !== d) } });
  }
  for (const id of f.field_id) {
    chips.push({ key: `field:${id}`, label: `In ${fieldName(id)}`, without: { ...f, field_id: f.field_id.filter((x) => x !== id) } });
  }
  if (f.min_score !== null) {
    chips.push({ key: "min", label: `Score ≥ ${f.min_score}`, without: { ...f, min_score: null } });
  }
  if (f.include_injected) {
    chips.push({ key: "sim", label: "Including SIMULATED", without: { ...f, include_injected: false } });
  }
  if (f.sort !== "score") {
    const label = sortAvailable(f.sort, hasAnomaly)
      ? `Sorted: ${SORT_LABELS[f.sort].toLowerCase()}`
      : `${SORT_LABELS[f.sort]}: not ranked yet, sorted by score`;
    chips.push({ key: "sort", label, without: { ...f, sort: "score" } });
  }
  return chips;
}

export const isEmptyFilter = (f: CandidateFilter) => filterChips(f).length === 0;
