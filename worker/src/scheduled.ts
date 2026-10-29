/**
 * Cron Trigger (wrangler.toml [triggers]): keeps every candidate's JPL known-object result fresh,
 * so visitors never wait on JPL. Each run refreshes the stalest candidates that fit in this
 * invocation's subrequest budget (missing first, then failed, then oldest).
 */
import type { CandidateDetail, CandidateList } from "./contract";
import type { Deps, Env } from "./env";
import { MAX_SBIDENT_QUERIES } from "./enrich";
import { readStaticJson } from "./static-data";
import { isStale, readRecord, refreshRecord } from "./store";

/** Upstream calls one candidate can need: SBIdent per visit plus up to 3 Horizons lookups. */
export const CALLS_PER_CANDIDATE = MAX_SBIDENT_QUERIES + 3;

export interface ScheduledReport {
  considered: number;
  stale: number;
  refreshed: string[];
  skipped_for_budget: number;
}

export async function refreshStale(env: Env, deps: Deps): Promise<ScheduledReport> {
  const report: ScheduledReport = { considered: 0, stale: 0, refreshed: [], skipped_for_budget: 0 };
  if (!deps.kv) return report; // without a global store there is nothing to keep warm
  const list = await readStaticJson<CandidateList>(env, "candidates.json");
  if (!list) return report;
  const now = deps.now();
  const todo: { id: string; rank: number; attempted: number }[] = [];
  for (const s of list.candidates) {
    if (s.classification === "injected") continue;
    report.considered += 1;
    const rec = await readRecord(deps, { candidate_id: s.candidate_id, pipeline_version: list.pipeline_version });
    if (!isStale(rec, now)) continue;
    // Missing first, then failed, then the oldest successful result.
    const rank = !rec ? 0 : rec.status === "failed" ? 1 : 2;
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
      const e = await refreshRecord(deps, cand);
      if (e) report.refreshed.push(t.id);
    } catch (err) {
      console.error(`scheduled JPL lookup for ${t.id}:`, err);
    }
  }
  return report;
}
