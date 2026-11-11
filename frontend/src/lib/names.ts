import type { CandidateSummary, Classification, FieldSummary } from "./contract";
import { constellationAt } from "./constellation";

/**
 * Human-readable names for moving objects.
 *
 * A JPL-matched object is called by its designation. Everything else gets a letter within its
 * constellation, e.g. "Moving object A in Aquarius". Letters are assigned across every published
 * candidate in that constellation in a fixed order (first sighting, then ID), so the same
 * object has the same name on every page. Simulated objects are lettered separately so they
 * never shift the names of real ones.
 */
export interface ObjectName {
  /** "(2524) Budovicium", "Moving object A in Aquarius", "Simulated object A in Aquarius". */
  title: string;
  /** The pipeline's ID, shown as secondary text. */
  id: string;
  constellation: string | null;
}

export interface NameInput {
  candidate_id: string;
  field_id: string;
  classification: Classification;
  first_time_utc: string;
  known_object_designation: string | null;
}

/** 0 → A, 25 → Z, 26 → AA. */
export function letterFor(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function buildNames(candidates: NameInput[], fields: Pick<FieldSummary, "field_id" | "center">[]): Map<string, ObjectName> {
  const constellationOf = new Map(
    fields.map((f) => [f.field_id, constellationAt(f.center.ra_deg, f.center.dec_deg)?.name ?? null]),
  );
  const groups = new Map<string, NameInput[]>();
  for (const c of candidates) {
    const key = `${c.classification === "injected" ? "sim" : "real"}|${constellationOf.get(c.field_id) ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const names = new Map<string, ObjectName>();
  for (const [key, group] of groups) {
    const simulated = key.startsWith("sim|");
    const sorted = [...group].sort(
      (a, b) => a.first_time_utc.localeCompare(b.first_time_utc) || a.candidate_id.localeCompare(b.candidate_id),
    );
    sorted.forEach((c, i) => {
      const constellation = constellationOf.get(c.field_id) ?? null;
      const generic = `${simulated ? "Simulated object" : "Moving object"} ${letterFor(i)}${constellation ? ` in ${constellation}` : ""}`;
      const designation = c.classification === "known_object" ? c.known_object_designation : null;
      names.set(c.candidate_id, { title: designation || generic, id: c.candidate_id, constellation });
    });
  }
  return names;
}

/** Name for a candidate the name table doesn't know yet, e.g. while it loads. */
export function fallbackName(c: { candidate_id: string; classification: Classification; designation?: string | null }): ObjectName {
  const designation = c.classification === "known_object" ? (c.designation ?? null) : null;
  return { title: designation || (c.classification === "injected" ? "Simulated object" : "Moving object"), id: c.candidate_id, constellation: null };
}

/** The candidate summary fields the name table needs. */
export function toNameInput(c: CandidateSummary): NameInput {
  return {
    candidate_id: c.candidate_id,
    field_id: c.field_id,
    classification: c.classification,
    first_time_utc: c.first_time_utc,
    known_object_designation: c.known_object_designation,
  };
}

/**
 * The smallest lists `buildNames` needs, for pages that pass them to the browser. Object and
 * field pages embed this in their HTML, so sending whole candidate summaries made every page
 * grow with each survey (about 860 KB per object page by November 2026).
 */
export interface NameSeed {
  candidates: NameInput[];
  fields: Pick<FieldSummary, "field_id" | "center">[];
}

export function toNameSeed(candidates: CandidateSummary[], fields: Pick<FieldSummary, "field_id" | "center">[]): NameSeed {
  return {
    candidates: candidates.map(toNameInput),
    fields: fields.map((f) => ({ field_id: f.field_id, center: { ra_deg: f.center.ra_deg, dec_deg: f.center.dec_deg } })),
  };
}
