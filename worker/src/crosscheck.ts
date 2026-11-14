/**
 * Multi-catalog identification: JPL's answer (store.ts) combined with IMCCE SkyBoT's
 * (skybot.ts), stored in D1 table `cross_checks`. Requests only read stored answers; the cron
 * (scheduled.ts) asks SkyBoT in a slow, budgeted rotation.
 *
 * Rule: a candidate is a known object when a catalog predicts one object within 15″ at every
 * visit checked. Which catalogs give that identification is recorded, and a catalog that
 * answered differently is reported as a disagreement, never hidden.
 */
import type { CandidateSummary, CrossCheck, CrossCheckCatalog, CrossCheckProgress, KnownObject, ObjectSummary } from "./contract";
import { ensureSchema } from "./db";
import type { Deps } from "./env";
import { SKYBOT, type CatalogResult, sameObject } from "./skybot";

export const JPL = "JPL";
/** Known objects are re-checked against SkyBoT about this often. */
export const KNOWN_RECHECK_DAYS = 30;
/** Unexplained and unanswered candidates are re-checked this often. */
export const OTHER_RECHECK_HOURS = 24;
/** A SkyBoT check that got no answer is retried after this long. */
export const FAILED_RETRY_MINUTES = 30;
/** Known candidates cross-checked per cron run at most (hard cap; scheduled.ts). */
export const KNOWN_CROSS_CHECKS_PER_RUN = 2;
/** Unexplained, failed and never-checked candidates cross-checked per cron run at most. */
export const OTHER_CROSS_CHECKS_PER_RUN = 3;
export const CRON_RUNS_PER_HOUR = 6;

async function d1(deps: Deps): Promise<D1Database | null> {
  if (!deps.db) return null;
  try {
    await ensureSchema(deps.db);
    return deps.db;
  } catch (err) {
    console.error("D1 unavailable for cross-checks:", err);
    return null;
  }
}

const parse = (text: string): CatalogResult | null => {
  try {
    const r = JSON.parse(text) as CatalogResult;
    return r && typeof r.outcome === "string" ? r : null;
  } catch {
    return null;
  }
};

/** Every stored SkyBoT answer, by candidate id, in one query. */
export async function readSkybotResults(deps: Deps): Promise<Map<string, CatalogResult>> {
  const out = new Map<string, CatalogResult>();
  const db = await d1(deps);
  if (!db) return out;
  try {
    const { results } = await db
      .prepare("SELECT candidate_id, record FROM cross_checks WHERE catalog = ?")
      .bind(SKYBOT)
      .all<{ candidate_id: string; record: string }>();
    for (const r of results) {
      const rec = parse(r.record);
      if (rec) out.set(r.candidate_id, rec);
    }
  } catch (err) {
    console.error("D1 read of cross-checks failed:", err);
  }
  return out;
}

export async function readSkybotResult(deps: Deps, candidateId: string): Promise<CatalogResult | null> {
  const db = await d1(deps);
  if (!db) return null;
  try {
    const row = await db
      .prepare("SELECT record FROM cross_checks WHERE candidate_id = ? AND catalog = ?")
      .bind(candidateId, SKYBOT)
      .first<{ record: string }>();
    return row ? parse(row.record) : null;
  } catch (err) {
    console.error("D1 read of a cross-check failed:", err);
    return null;
  }
}

/** Store a SkyBoT answer. A failed attempt never overwrites an earlier answer's content. */
export async function writeSkybotResult(deps: Deps, candidateId: string, r: CatalogResult, prev: CatalogResult | null): Promise<void> {
  const db = await d1(deps);
  if (!db) return;
  // Keep the last real answer when SkyBoT does not respond; only note that a retry happened.
  const rec: CatalogResult & { retry_utc?: string } =
    r.outcome === "failed" && prev && prev.outcome !== "failed" ? { ...prev, retry_utc: r.checked_utc } : r;
  await db
    .prepare(
      "INSERT INTO cross_checks (candidate_id, catalog, outcome, designation, checked_utc, record) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (candidate_id, catalog) DO UPDATE SET outcome = excluded.outcome, designation = excluded.designation, " +
        "checked_utc = excluded.checked_utc, record = excluded.record",
    )
    .bind(candidateId, SKYBOT, rec.outcome, rec.designation, rec.checked_utc, JSON.stringify(rec))
    .run();
}

/** When the rotation last tried this candidate (a retry after a kept answer counts). */
export const lastAttempt = (r: CatalogResult): number =>
  Date.parse((r as CatalogResult & { retry_utc?: string }).retry_utc ?? r.checked_utc) || 0;

/** Whether the cron should ask SkyBoT about this candidate now. */
export function skybotDue(r: CatalogResult | null | undefined, known: boolean, now: Date): boolean {
  if (!r) return true;
  const age = now.getTime() - lastAttempt(r);
  if (r.outcome === "failed") return age >= FAILED_RETRY_MINUTES * 60_000;
  return age > (known ? KNOWN_RECHECK_DAYS * 24 : OTHER_RECHECK_HOURS) * 3_600_000;
}

const jplFailed = (k: KnownObject) =>
  !k.checked && k.enrichment !== "pending" && k.enrichment !== "static" && !!k.not_checked_reason;

/**
 * Combine JPL's stored answer with SkyBoT's into the known_object block the API serves:
 * cross_checks (one entry per catalog), the counts, and a SkyBoT identification when JPL has
 * none. `known` must be JPL's own answer (never an already combined block).
 */
export function withCrossChecks(known: KnownObject, sky: CatalogResult | null | undefined): { known_object: KnownObject; matched: boolean } {
  const jplMatch = known.checked && known.matched && !!known.designation;
  const skyMatch = sky?.outcome === "match" && !!sky.designation;
  const consensus = jplMatch ? known.designation! : skyMatch ? sky!.designation! : null;
  const seps = known.per_epoch.map((p) => p.separation_arcsec);
  const jpl: CrossCheck = {
    catalog: JPL,
    status: jplMatch ? "agrees" : known.checked ? "nothing_found" : jplFailed(known) ? "failed" : "not_checked_yet",
    designation: jplMatch ? known.designation : null,
    separation_arcsec: jplMatch && seps.length > 0 ? Math.max(...seps) : null,
    checked_utc: known.checked || jplFailed(known) ? known.query_utc : null,
    n_visits: null,
    detail: known.checked ? null : known.not_checked_reason,
  };
  const skybot: CrossCheck = !sky
    ? { catalog: SKYBOT, status: "not_checked_yet", designation: null, separation_arcsec: null, checked_utc: null, n_visits: null, detail: null }
    : {
        catalog: SKYBOT,
        status:
          sky.outcome === "failed"
            ? "failed"
            : sky.outcome === "none"
              ? "nothing_found"
              : sameObject(consensus!, sky.designation!)
                ? "agrees"
                : "different_object",
        designation: sky.outcome === "match" ? sky.designation : null,
        separation_arcsec: sky.outcome === "match" ? sky.separation_arcsec : null,
        checked_utc: sky.outcome === "failed" ? null : sky.checked_utc,
        n_visits: sky.n_visits,
        detail: sky.detail,
      };
  const cross_checks = [jpl, skybot];
  const answered = (c: CrossCheck) => c.status === "agrees" || c.status === "different_object" || c.status === "nothing_found";
  const agreeing = cross_checks.filter((c) => c.status === "agrees").length;
  const skyAnswered = answered(skybot);
  const promote = !jplMatch && skyMatch; // identified by SkyBoT alone
  const next: KnownObject = {
    ...known,
    ...(skyAnswered && !known.checked ? { checked: true, not_checked_reason: null, search_radius_arcsec: known.search_radius_arcsec ?? 15 } : {}),
    ...(promote
      ? {
          matched: true,
          designation: sky!.designation,
          predicted_vmag: sky!.vmag,
          per_epoch: [],
          nearest: null,
          observer: "SPHEREx (geocentric IMCCE SkyBoT positions corrected with the spacecraft position from the FITS headers)",
          query_utc: sky!.checked_utc,
        }
      : {}),
    catalogs_checked: skyAnswered ? [...known.catalogs_checked.filter((c) => c !== SKYBOT), SKYBOT] : known.catalogs_checked,
    cross_checks,
    agreeing_catalogs: agreeing,
    checked_catalogs: cross_checks.filter(answered).length,
    catalogs_disagree: agreeing > 0 && cross_checks.some((c) => c.status === "different_object" || c.status === "nothing_found"),
  };
  return { known_object: next, matched: next.checked && next.matched };
}

export const agreeingCatalogs = (k: KnownObject): CrossCheckCatalog[] =>
  (k.cross_checks ?? []).filter((c) => c.status === "agrees").map((c) => c.catalog);

/** JPL's answer as far as a list row knows it (enough for withCrossChecks). */
export function knownFromSummary(s: Pick<CandidateSummary | ObjectSummary, "known_object_checked" | "known_object_matched" | "known_object_designation">): KnownObject {
  return {
    checked: s.known_object_checked,
    not_checked_reason: null,
    matched: s.known_object_matched,
    catalogs_checked: s.known_object_checked ? ["JPL SBIdent"] : [],
    search_radius_arcsec: 15,
    designation: s.known_object_designation,
    predicted_vmag: null,
    per_epoch: [],
    nearest: null,
    observer: null,
    query_utc: null,
    enrichment: s.known_object_checked ? "pipeline" : "static",
  };
}

/** Progress of the rotation, from combined known_object blocks (one per real candidate). */
export function crossCheckProgress(blocks: KnownObject[], sky: (CatalogResult | null | undefined)[], now: Date): CrossCheckProgress {
  let known = 0;
  let checked = 0;
  let two = 0;
  let disagreements = 0;
  let due = 0;
  let oldest = Infinity;
  blocks.forEach((k, i) => {
    if (k.catalogs_disagree) disagreements += 1;
    if (!(k.checked && k.matched)) return;
    known += 1;
    if ((k.checked_catalogs ?? 0) >= 2) checked += 1;
    if ((k.agreeing_catalogs ?? 0) >= 2) two += 1;
    const r = sky[i];
    if (!r || r.outcome === "failed" || skybotDue(r, true, now)) due += 1;
    else oldest = Math.min(oldest, Date.parse(r.checked_utc) || Infinity);
  });
  const perHour = KNOWN_CROSS_CHECKS_PER_RUN * CRON_RUNS_PER_HOUR;
  const estimate =
    known === 0
      ? null
      : due > 0
        ? new Date(now.getTime() + (due / perHour) * 3_600_000)
        : Number.isFinite(oldest)
          ? new Date(oldest + KNOWN_RECHECK_DAYS * 86_400_000 + (known / perHour) * 3_600_000)
          : null;
  return {
    known_total: known,
    cross_checked: checked,
    agreeing_2plus: two,
    disagreements,
    next_full_pass_estimate_utc: estimate ? estimate.toISOString() : null,
  };
}
