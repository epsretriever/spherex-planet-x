/**
 * Known-object results, stored globally in Workers KV (binding ENRICHMENT).
 *
 * JPL lookups take 10-30 s, so they never run inside a request that waits for them:
 * - a request reads the stored result and answers immediately;
 * - if there is none yet, it answers with `enrichment: "pending"` and starts the lookup in the
 *   background (ExecutionContext.waitUntil);
 * - a Cron Trigger (see scheduled.ts) refreshes stale and failed results.
 *
 * Without a KV binding (local tools), results fall back to the per-datacenter Cache API.
 */
import type { CandidateDetail } from "./contract";
import type { Deps } from "./env";
import { type Enrichment, cachedEnrichment, enrichKnownObject, storeEnrichment } from "./enrich";

export interface EnrichmentRecord {
  v: 1;
  /** checked: JPL answered (match or no match); failed: JPL did not answer enough visits. */
  status: "checked" | "failed";
  enrichment: Enrichment;
  attempted_utc: string;
}

type CandRef = { candidate_id: string; pipeline_version: string };

/** A failed lookup is retried after this long. */
export const FAILED_RETRY_SECONDS = 30 * 60;
/** A successful lookup is refreshed by the cron after this long (new asteroids get catalogued). */
export const REFRESH_AFTER_HOURS = 24;
/** Only one lookup per candidate at a time (KV's shortest expiry is 60 s). */
const LOCK_SECONDS = 60;

const recordKey = (c: CandRef) => `enrich:v1:${c.pipeline_version}:${c.candidate_id}`;
const lockKey = (c: CandRef) => `lock:v1:${c.pipeline_version}:${c.candidate_id}`;

export async function readRecord(deps: Deps, c: CandRef): Promise<EnrichmentRecord | null> {
  if (deps.kv) {
    try {
      const rec = (await deps.kv.get(recordKey(c), "json")) as EnrichmentRecord | null;
      return rec && rec.v === 1 ? rec : null;
    } catch {
      return null;
    }
  }
  const e = await cachedEnrichment(deps.cache, c).catch(() => null);
  return e ? { v: 1, status: "checked", enrichment: e, attempted_utc: e.known_object.query_utc ?? "" } : null;
}

export async function writeRecord(deps: Deps, c: CandRef, e: Enrichment): Promise<void> {
  const status = e.known_object.checked ? "checked" : "failed";
  if (deps.kv) {
    const rec: EnrichmentRecord = { v: 1, status, enrichment: e, attempted_utc: deps.now().toISOString() };
    await deps.kv
      .put(recordKey(c), JSON.stringify(rec), status === "failed" ? { expirationTtl: FAILED_RETRY_SECONDS } : undefined)
      .catch(() => undefined);
    return;
  }
  await storeEnrichment(deps.cache, c, e).catch(() => undefined);
}

/** True when this invocation may run the lookup (no other one started in the last minute). */
async function takeLock(deps: Deps, c: CandRef): Promise<boolean> {
  if (!deps.kv) return true;
  try {
    if (await deps.kv.get(lockKey(c), "json")) return false;
    await deps.kv.put(lockKey(c), JSON.stringify({ at: deps.now().toISOString() }), { expirationTtl: LOCK_SECONDS });
    return true;
  } catch {
    return true;
  }
}

/** Run the JPL lookup for one candidate and store the result. Returns null if another run holds the lock. */
export async function refreshRecord(deps: Deps, cand: CandidateDetail): Promise<Enrichment | null> {
  if (cand.classification === "injected") return null;
  if (!(await takeLock(deps, cand))) return null;
  const e = await enrichKnownObject(deps, cand);
  await writeRecord(deps, cand, e);
  return e;
}

/** Whether the cron should refresh this record now. */
export function isStale(rec: EnrichmentRecord | null, now: Date): boolean {
  if (!rec) return true;
  if (rec.status === "failed") return true;
  const at = Date.parse(rec.attempted_utc);
  return !Number.isFinite(at) || now.getTime() - at > REFRESH_AFTER_HOURS * 3600_000;
}
