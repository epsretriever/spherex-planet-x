/**
 * Cron Trigger (wrangler.toml [triggers]): keeps unexplained and unchecked candidates' JPL
 * known-object results fresh, so visitors never wait on JPL. Candidates the survey pipeline
 * already matched (spherex-px triage) are final and skipped. Each run refreshes the stalest
 * candidates that fit in this invocation's subrequest budget (missing first, then failed, then
 * the oldest unexplained, then the orbit-validation sample).
 */
import type { CandidateDetail, CandidateList, CandidateSummary, ObjectList } from "./contract";
import type { Deps, Env } from "./env";
import { MAX_SBIDENT_QUERIES } from "./enrich";
import { ORBIT_COMPARE_CALLS } from "./orbit-compare";
import { orbitOfCandidate, readStaticJson } from "./static-data";
import { finalInList } from "./routes/candidates";
import { isStale, readRecord, readRecordsFor, refreshRecord } from "./store";

/** Records copied from KV into D1 per run at most (KV allows 1,000 operations per invocation). */
const MAX_SINGLE_READS = 300;

/** Upstream calls one candidate can need: SBIdent per visit, up to 3 Horizons lookups, and the orbit comparison. */
export const CALLS_PER_CANDIDATE = MAX_SBIDENT_QUERIES + 3 + ORBIT_COMPARE_CALLS;

export interface ScheduledReport {
  considered: number;
  stale: number;
  refreshed: string[];
  skipped_for_budget: number;
}

export async function refreshStale(env: Env, deps: Deps): Promise<ScheduledReport> {
  const report: ScheduledReport = { considered: 0, stale: 0, refreshed: [], skipped_for_budget: 0 };
  if (!deps.kv && !deps.db) return report; // without a global store there is nothing to keep warm
  const list = await readStaticJson<CandidateList>(env, "candidates.json");
  if (!list) return report;
  const now = deps.now();
  // Candidates the survey pipeline matched to a known object are final and never re-checked;
  // only unexplained and still-unchecked ones are. The exception is the orbit-validation
  // sample: identified objects that kept our orbit get one Worker lookup for the comparison
  // of our orbit with JPL's.
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
