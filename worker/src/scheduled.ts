/**
 * Cron Trigger (wrangler.toml [triggers]): a slow, budgeted rotation that keeps catalog checks
 * fresh, so visitors never wait on an upstream.
 *
 * 1. IMCCE SkyBoT cross-checks (crossCheckRotation): never checked anywhere first, then failed,
 *    then unexplained (daily), then known objects (missing first, then the oldest; about every
 *    30 days). Hard caps per run: KNOWN_CROSS_CHECKS_PER_RUN known candidates and
 *    OTHER_CROSS_CHECKS_PER_RUN others, SKYBOT_VISITS calls each.
 * 2. JPL lookups for unexplained and unchecked candidates with what is left of the budget
 *    (missing first, then failed, then the oldest unexplained, then the orbit-validation sample).
 */
import type { CandidateDetail, CandidateList, CandidateSummary, ObjectList } from "./contract";
import type { Deps, Env } from "./env";
import { MAX_SBIDENT_QUERIES } from "./enrich";
import { ORBIT_COMPARE_CALLS } from "./orbit-compare";
import { orbitOfCandidate, readStaticJson } from "./static-data";
import { finalInList } from "./routes/candidates";
import { type EnrichmentRecord, isStale, readRecord, readRecordsFor, refreshRecord } from "./store";
import {
  KNOWN_CROSS_CHECKS_PER_RUN,
  OTHER_CROSS_CHECKS_PER_RUN,
  lastAttempt,
  readSkybotResults,
  skybotDue,
  writeSkybotResult,
} from "./crosscheck";
import { SKYBOT_VISITS, checkSkybot } from "./skybot";

/** Most SkyBoT calls one cron run can make; the JPL rotation keeps the rest of the budget. */
export const MAX_CROSS_CHECK_CALLS = (KNOWN_CROSS_CHECKS_PER_RUN + OTHER_CROSS_CHECKS_PER_RUN) * SKYBOT_VISITS;

/** Records copied from KV into D1 per run at most (KV allows 1,000 operations per invocation). */
const MAX_SINGLE_READS = 300;

/** Upstream calls one candidate can need: SBIdent per visit, up to 3 Horizons lookups, and the orbit comparison. */
export const CALLS_PER_CANDIDATE = MAX_SBIDENT_QUERIES + 3 + ORBIT_COMPARE_CALLS;

export interface ScheduledReport {
  considered: number;
  stale: number;
  refreshed: string[];
  skipped_for_budget: number;
  /** Candidates asked about at IMCCE SkyBoT in this run (known objects and others). */
  cross_checked: string[];
  cross_checks_due: number;
}

/**
 * Ask IMCCE SkyBoT about the candidates whose cross-check is missing or oldest, inside the
 * per-run caps. Returns the ids checked.
 */
export async function crossCheckRotation(
  env: Env,
  deps: Deps,
  list: CandidateList,
  stored: Map<string, EnrichmentRecord>,
  report: ScheduledReport,
): Promise<void> {
  if (!deps.db) return; // cross-checks are stored in D1 only
  const now = deps.now();
  const sky = await readSkybotResults(deps);
  const queue = list.candidates
    .filter((s) => s.classification !== "injected")
    .flatMap((s) => {
      const rec = stored.get(s.candidate_id);
      const prev = sky.get(s.candidate_id) ?? null;
      const known = finalInList(s) || !!rec?.enrichment.matched || prev?.outcome === "match";
      if (!skybotDue(prev, known, now)) return [];
      const jplAnswered = s.known_object_checked || rec?.status === "checked";
      // 0 never checked anywhere, 1 failed, 2 unexplained, 3 known.
      const rank = known ? 3 : !prev ? (jplAnswered ? 2 : 0) : prev.outcome === "failed" ? 1 : 2;
      return [{ id: s.candidate_id, known, rank, at: prev ? lastAttempt(prev) : 0, prev }];
    })
    .sort((a, b) => a.rank - b.rank || a.at - b.at);
  report.cross_checks_due = queue.length;
  let nKnown = 0;
  let nOther = 0;
  for (const t of queue) {
    if (t.known ? nKnown >= KNOWN_CROSS_CHECKS_PER_RUN : nOther >= OTHER_CROSS_CHECKS_PER_RUN) continue;
    if (deps.budget.remaining < SKYBOT_VISITS) break;
    if (t.known) nKnown += 1;
    else nOther += 1;
    try {
      const cand = await readStaticJson<CandidateDetail>(env, `candidates/${t.id}.json`);
      if (!cand || cand.detections.length === 0) continue;
      await writeSkybotResult(deps, t.id, await checkSkybot(deps, cand.detections), t.prev);
      report.cross_checked.push(t.id);
    } catch (err) {
      console.error(`scheduled SkyBoT cross-check for ${t.id}:`, err);
    }
  }
}

export async function refreshStale(env: Env, deps: Deps): Promise<ScheduledReport> {
  const report: ScheduledReport = { considered: 0, stale: 0, refreshed: [], skipped_for_budget: 0, cross_checked: [], cross_checks_due: 0 };
  if (!deps.kv && !deps.db) return report; // without a global store there is nothing to keep warm
  const list = await readStaticJson<CandidateList>(env, "candidates.json");
  if (!list) return report;
  const now = deps.now();
  // JPL lookups are repeated only for unexplained and still-unchecked candidates. Candidates
  // the survey pipeline matched are re-checked against IMCCE SkyBoT instead (crossCheckRotation),
  // and the orbit-validation sample (identified objects that kept our orbit) gets one Worker
  // lookup for the comparison of our orbit with JPL's.
  const objectList = await readStaticJson<ObjectList>(env, "objects.json").catch(() => null);
  const withOrbit = new Set(
    (objectList?.objects ?? []).filter((o) => o.orbit_status !== "none").flatMap((o) => o.candidate_ids.slice(0, 1)),
  );
  const versionOf = (s: CandidateSummary) => s.pipeline_version ?? list.pipeline_version;
  const real = list.candidates.filter(
    (s) => s.classification !== "injected" && (!finalInList(s) || withOrbit.has(s.candidate_id)),
  );
  const stored = await readRecordsFor(
    deps,
    real.map((s) => ({ candidate_id: s.candidate_id, pipeline_version: versionOf(s) })),
  );
  await crossCheckRotation(env, deps, list, stored, report);
  let lookups = 0;
  const todo: { id: string; rank: number; attempted: number }[] = [];
  for (const s of real) {
    report.considered += 1;
    let rec = stored.get(s.candidate_id) ?? null;
    if (!rec && deps.db && lookups < MAX_SINGLE_READS) {
      // Not in D1 yet: a record from before D1 may still be in KV (readRecord copies it over).
      lookups += 1;
      rec = await readRecord(deps, { candidate_id: s.candidate_id, pipeline_version: versionOf(s) });
    }
    if (finalInList(s)) {
      if (rec) continue; // validation sample: one lookup is enough, the match is final
      todo.push({ id: s.candidate_id, rank: 3, attempted: 0 });
      continue;
    }
    if (!isStale(rec, now)) continue;
    // Never checked first, then failed, then unexplained (the pipeline's check, or the oldest
    // stored one): new asteroids get catalogued, so an unexplained object is re-checked daily.
    const rank = !rec ? (s.known_object_checked ? 2 : 0) : rec.status === "failed" ? 1 : 2;
    const attempted = rec ? Date.parse(rec.attempted_utc) || 0 : 0;
    todo.push({ id: s.candidate_id, rank, attempted });
  }
  report.stale = todo.length;
  todo.sort((a, b) => a.rank - b.rank || a.attempted - b.attempted);
  for (const t of todo) {
    if (deps.budget.remaining < CALLS_PER_CANDIDATE) {
      report.skipped_for_budget += 1;
      continue;
    }
    try {
      const cand = await readStaticJson<CandidateDetail>(env, `candidates/${t.id}.json`);
      if (!cand) continue;
      const e = await refreshRecord(deps, cand, await orbitOfCandidate(env, t.id));
      if (e) report.refreshed.push(t.id);
    } catch (err) {
      console.error(`scheduled JPL lookup for ${t.id}:`, err);
    }
  }
  return report;
}
