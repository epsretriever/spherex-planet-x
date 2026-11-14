import type { CrossCheck, CrossCheckStatus, CrossCheckSummary, KnownObject } from "./contract";
import { jplLinks, jplSearchString } from "./jpl";

/**
 * The independent small-body catalogs an identification is checked against. Several service
 * names can belong to one catalog ("JPL SBIdent" and "JPL Horizons" are both JPL), so agreement
 * is always counted per catalog, never per service.
 */
export type CatalogFamily = "jpl" | "skybot";

export interface CatalogInfo {
  family: CatalogFamily;
  /** For chips: "JPL", "SkyBoT". */
  short: string;
  name: string;
  /** Who maintains it. */
  who: string;
  home: string;
  /** What it contributes, in one sentence. */
  role: string;
}

export const CATALOGS: Record<CatalogFamily, CatalogInfo> = {
  jpl: {
    family: "jpl",
    short: "JPL",
    name: "JPL Small-Body Identification and Horizons",
    who: "NASA Jet Propulsion Laboratory",
    home: "https://ssd.jpl.nasa.gov/",
    role: "The first check on every track: SBIdent lists the known bodies near each sighting as seen from SPHEREx, and Horizons gives their precise predicted positions.",
  },
  skybot: {
    family: "skybot",
    short: "SkyBoT",
    name: "IMCCE SkyBoT",
    who: "Paris Observatory (IMCCE)",
    home: "https://ssp.imcce.fr/webservices/skybot/",
    role: "A separate ephemeris service with its own orbit computations, asked which solar system objects were in the same patch of sky at the same time.",
  },
};

const FAMILY_ORDER: CatalogFamily[] = ["jpl", "skybot"];

/** The catalogs every identification is checked against, in the order they are shown. */
export const CHECKED_CATALOGS: CatalogFamily[] = ["jpl", "skybot"];

/** "JPL and SkyBoT" */
export function catalogListText(families: CatalogFamily[] = CHECKED_CATALOGS, conj = "and"): string {
  const s = families.map((f) => CATALOGS[f].short);
  return s.length <= 1 ? (s[0] ?? "") : `${s.slice(0, -1).join(", ")} ${conj} ${s[s.length - 1]}`;
}

/** Catalogs agree within this distance of our measured position, at every sighting. */
export const MATCH_RADIUS_ARCSEC = 15;

export const MATCH_RULE =
  "A catalog agrees when its predicted position for the object lies within 15″ of where we measured it at every sighting, after correcting for parallax: SPHEREx orbits Earth, so a nearby asteroid appears slightly shifted from where a catalog computed for Earth's center would put it.";

export function catalogFamily(name: string): CatalogFamily | null {
  const n = name.toLowerCase();
  if (/jpl|sbident|horizons/.test(n)) return "jpl";
  if (/skybot|imcce/.test(n)) return "skybot";
  return null;
}

export const catalogShort = (name: string) => {
  const f = catalogFamily(name);
  return f ? CATALOGS[f].short : name;
};

const familyRank = (name: string) => {
  const f = catalogFamily(name);
  return f ? FAMILY_ORDER.indexOf(f) : FAMILY_ORDER.length;
};

/** Short labels of the distinct catalogs in a list of service names, JPL first. */
export function catalogChips(names: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(names)) return [];
  const sorted = names.filter((n): n is string => typeof n === "string" && n.trim() !== "").sort((a, b) => familyRank(a) - familyRank(b));
  return [...new Set(sorted.map(catalogShort))];
}

/** How many independent catalogs agree, from a summary's list; null when it isn't published. */
export function agreeingCount(names: readonly string[] | null | undefined): number | null {
  return Array.isArray(names) ? catalogChips(names).length : null;
}

export const STATUS_LABEL: Record<CrossCheckStatus, string> = {
  agrees: "Agrees",
  different_object: "Different object",
  nothing_found: "Nothing found",
  not_checked_yet: "Not checked yet",
  failed: "No answer",
};

const isStatus = (s: unknown): s is CrossCheckStatus => typeof s === "string" && s in STATUS_LABEL;

export interface CatalogLink {
  href: string;
  label: string;
}

export interface CatalogRow {
  key: string;
  family: CatalogFamily | null;
  /** The catalog as the data names it. */
  catalog: string;
  short: string;
  status: CrossCheckStatus;
  designation: string | null;
  separation_arcsec: number | null;
  checked_utc: string | null;
  /** The object's page in this catalog. */
  link: CatalogLink | null;
}

/** "433 Eros (A898 PA)" -> "Eros"; "(2019 AB12)" -> "2019_AB12": what an SsODNet ssoCard address takes. */
export function ssoCardName(designation: string): string {
  const named = /^\d+\s+([^()]+?)\s*(\(|$)/.exec(designation.trim());
  if (named && !/^\d{4} [A-Z]{1,2}\d*$/.test(named[1]!)) return named[1]!.replace(/\s+/g, "_");
  return jplSearchString(designation).replace(/\s+/g, "_");
}

/** The object's own page in a catalog, when the catalog has one. */
export function catalogObjectLink(family: CatalogFamily | null, designation: string | null | undefined): CatalogLink | null {
  if (!family || !designation) return null;
  const q = jplSearchString(designation);
  switch (family) {
    case "jpl":
      return { href: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(q)}`, label: "JPL SBDB" };
    case "skybot":
      return { href: `https://ssp.imcce.fr/forms/ssocard/${encodeURIComponent(ssoCardName(designation))}`, label: "SsODNet ssoCard" };
  }
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * One row per catalog asked, JPL first; null when the data carries no cross-checks. When the
 * list leaves JPL out, JPL's row is taken from the known-object block itself.
 */
export function crossCheckRows(known: KnownObject): CatalogRow[] | null {
  const list = Array.isArray(known.cross_checks) ? known.cross_checks.filter((c): c is CrossCheck => !!c && typeof c.catalog === "string") : [];
  if (list.length === 0) return null;
  const rows: CatalogRow[] = list.map((c, i) => {
    const family = catalogFamily(c.catalog);
    const status = isStatus(c.status) ? c.status : "not_checked_yet";
    const designation = c.designation ?? (status === "agrees" ? (known.designation ?? null) : null);
    return {
      key: `${c.catalog}:${i}`,
      family,
      catalog: c.catalog,
      short: catalogShort(c.catalog),
      status,
      designation,
      separation_arcsec: finite(c.separation_arcsec) ? c.separation_arcsec : null,
      checked_utc: c.checked_utc ?? null,
      link:
        status === "agrees" || status === "different_object"
          ? family === "jpl" && status === "agrees" && jplLinks(known)
            ? { href: jplLinks(known)!.sbdb_url, label: "JPL SBDB" }
            : catalogObjectLink(family, designation)
          : null,
    };
  });
  if (!rows.some((r) => r.family === "jpl")) {
    const seps = (known.per_epoch ?? []).map((p) => p.separation_arcsec).filter(finite);
    const links = jplLinks(known);
    rows.unshift({
      key: "jpl",
      family: "jpl",
      catalog: "JPL SBIdent + Horizons",
      short: "JPL",
      status: !known.checked ? (known.enrichment === "pending" ? "not_checked_yet" : "failed") : known.matched ? "agrees" : "nothing_found",
      designation: known.matched ? (known.designation ?? null) : null,
      separation_arcsec: known.matched && seps.length ? Math.max(...seps) : null,
      checked_utc: known.query_utc ?? null,
      link: links ? { href: links.sbdb_url, label: "JPL SBDB" } : null,
    });
  }
  return rows.sort((a, b) => familyRank(a.catalog) - familyRank(b.catalog));
}

export type CatalogVerdictKind = "confirmed" | "disagree" | "single_waiting" | "single_alone" | "none_found" | "waiting";

export interface CatalogVerdict {
  kind: CatalogVerdictKind;
  tone: "ok" | "warn" | "pending";
  headline: string;
  detail: string;
  /** Short labels of the catalogs that agree. */
  agreeing: string[];
  /** Distinct catalogs that have answered (agree, name another object, or found nothing). */
  answered: number;
  /** Distinct catalogs asked. */
  asked: number;
}

const list = (xs: string[], conj = "and") => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${conj} ${xs[xs.length - 1]}`);

/** The honest one-line reading of the per-catalog answers. */
export function catalogVerdict(rows: CatalogRow[], designation?: string | null): CatalogVerdict {
  const shorts = (pick: (r: CatalogRow) => boolean) => [...new Set(rows.filter(pick).map((r) => r.short))];
  const agreeing = shorts((r) => r.status === "agrees");
  const differing = shorts((r) => r.status === "different_object").filter((s) => !agreeing.includes(s));
  const empty = shorts((r) => r.status === "nothing_found").filter((s) => !agreeing.includes(s) && !differing.includes(s));
  const asked = shorts(() => true).length;
  const answered = agreeing.length + differing.length + empty.length;
  const waiting = shorts(() => true).filter((s) => !agreeing.includes(s) && !differing.includes(s) && !empty.includes(s));
  const base = { agreeing, answered, asked };
  const name = designation ?? "this object";

  if (differing.length > 0) {
    const others = rows.filter((r) => r.status === "different_object" && r.designation).map((r) => `${r.short} places ${r.designation} here`);
    return {
      ...base,
      kind: "disagree",
      tone: "warn",
      headline: "Catalogs disagree",
      detail: `${agreeing.length ? `${list(agreeing)} ${agreeing.length === 1 ? "identifies" : "identify"} it as ${name}, but ` : ""}${
        others.length ? list(others) : `${list(differing)} ${differing.length === 1 ? "names" : "name"} a different object`
      }. Until they agree, treat the identification as uncertain; it is re-checked on the rolling schedule.`,
    };
  }
  if (agreeing.length >= 2) {
    return {
      ...base,
      kind: "confirmed",
      tone: "ok",
      headline: `Confirmed by ${agreeing.length} independent catalogs`,
      detail: `${list(agreeing)} each place ${name} within ${MATCH_RADIUS_ARCSEC}″ of our measured positions${
        empty.length ? `; ${list(empty)} found nothing there` : ""
      }${waiting.length ? `; ${list(waiting)} ${waiting.length === 1 ? "has" : "have"} not answered yet` : ""}.`,
    };
  }
  if (agreeing.length === 1) {
    if (empty.length > 0) {
      return {
        ...base,
        kind: "single_alone",
        tone: "warn",
        headline: `Only ${agreeing[0]} places a known object here`,
        detail: `${agreeing[0]} identifies it as ${name}, but ${list(empty)} found nothing at these positions${
          waiting.length ? ` and ${list(waiting)} ${waiting.length === 1 ? "has" : "have"} not answered yet` : ""
        }. One catalog is not independent confirmation; it is re-checked on the rolling schedule.`,
      };
    }
    return {
      ...base,
      kind: "single_waiting",
      tone: "pending",
      headline: `Only ${agreeing[0]} has answered so far: re-checking`,
      detail: `${agreeing[0]} identifies it as ${name}. ${list(waiting)} ${
        waiting.length === 1 ? "has" : "have"
      } not answered yet, so the identification rests on one catalog for now. Each object is revisited on a rolling schedule.`,
    };
  }
  if (empty.length > 0 && waiting.length === 0) {
    return {
      ...base,
      kind: "none_found",
      tone: "warn",
      headline: empty.length === 1 ? "No known object found" : `No known object in ${empty.length} catalogs`,
      detail: `${list(empty)} ${empty.length === 1 ? "has" : "have"} no catalogued asteroid or comet within ${MATCH_RADIUS_ARCSEC}″ of these positions. That does not make it new: catalogs are incomplete, and it could still be an artifact.`,
    };
  }
  return {
    ...base,
    kind: "waiting",
    tone: "pending",
    headline: empty.length ? "No match so far: still checking" : "Catalog checks in progress",
    detail: `${empty.length ? `${list(empty)} found nothing at these positions. ` : ""}${list(waiting)} ${
      waiting.length === 1 ? "has" : "have"
    } not answered yet. Until every catalog answers, “no match” tells us little.`,
  };
}

/** The live survey-wide totals of the cross-check, or null when any required number is missing. */
export function crossCheckTotals(cc: CrossCheckSummary | null | undefined): CrossCheckSummary | null {
  if (!cc) return null;
  const n = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
  if (!n(cc.known_total) || !n(cc.cross_checked) || !n(cc.agreeing_2plus)) return null;
  if (cc.agreeing_2plus > cc.known_total || cc.cross_checked > cc.known_total) return null;
  return { ...cc, disagreements: n(cc.disagreements) ? cc.disagreements : 0 };
}
