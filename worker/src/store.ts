/**
 * Known-object results, stored globally in D1 (binding DB, table `enrichment`).
 *
 * JPL lookups take 10-30 s, so they never run inside a request that waits for them:
 * - a request reads the stored result and answers immediately;
 * - if there is none yet, it answers with `enrichment: "pending"` and starts the lookup in the
 *   background (ExecutionContext.waitUntil);
 * - a Cron Trigger (see scheduled.ts) refreshes stale and failed results.
 *
 * List views read every result of a data version in one query (readRecords), so they scale to
 * hundreds of candidates. Records written to Workers KV before D1 held them are still read, and
 * copied into D1, until they expire. Without D1, results are kept in KV; without either (local
 * tools), in the per-datacenter Cache API.
 */
import type { CandidateDetail, JplOrbitComparison, KnownObject, OrbitalElements } from "./contract";
import { ensureSchema } from "./db";
import type { Deps } from "./env";
import { type Enrichment, cachedEnrichment, enrichKnownObject, storeEnrichment } from "./enrich";
import { compareOrbit } from "./orbit-compare";

export interface EnrichmentRecord {
  v: 1;
  /** checked: JPL answered (match or no match); failed: JPL did not answer enough visits. */
  status: "checked" | "failed";
  enrichment: Enrichment;
  attempted_utc: string;
  /** Our orbit versus JPL's, when JPL identified the object and it has an orbit (orbit-compare.ts). */
  orbit_comparison?: JplOrbitComparison | null;
}

export type CandRef = { candidate_id: string; pipeline_version: string };

/** A failed lookup is retried after this long. */
export const FAILED_RETRY_SECONDS = 30 * 60;
/** A successful lookup is refreshed by the cron after this long (new asteroids get catalogued). */
export const REFRESH_AFTER_HOURS = 24;
/** Only one lookup per candidate at a time. */
const LOCK_SECONDS = 60;

const recordKey = (c: CandRef) => `enrich:v1:${c.pipeline_version}:${c.candidate_id}`;
const lockKey = (c: CandRef) => `lock:v1:${c.pipeline_version}:${c.candidate_id}`;

/** D1 when bound and its schema is in place; null otherwise (then KV or the Cache API is used). */
async function d1(deps: Deps): Promise<D1Database | null> {
  if (!deps.db) return null;
  try {
    await ensureSchema(deps.db);
    return deps.db;
  } catch (err) {
    console.error("D1 unavailable for JPL results:", err);
    return null;
  }
}

const parse = (text: string): EnrichmentRecord | null => {
  try {
    const rec = JSON.parse(text) as EnrichmentRecord;
    return rec && rec.v === 1 ? rec : null;
  } catch {
    return null;
  }
};

async function upsert(db: D1Database, c: CandRef, rec: EnrichmentRecord): Promise<void> {
  const k = rec.enrichment.known_object;
  await db
    .prepare(
      "INSERT INTO enrichment (pipeline_version, candidate_id, status, matched, designation, attempted_utc, record) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (pipeline_version, candidate_id) DO UPDATE SET " +
        "status = excluded.status, matched = excluded.matched, designation = excluded.designation, " +
        "attempted_utc = excluded.attempted_utc, record = excluded.record",
    )
    .bind(c.pipeline_version, c.candidate_id, rec.status, rec.enrichment.matched ? 1 : 0, k.designation, rec.attempted_utc, JSON.stringify(rec))
    .run();
}

async function readKv(deps: Deps, c: CandRef): Promise<EnrichmentRecord | null> {
  if (!deps.kv) return null;
  try {
    const rec = (await deps.kv.get(recordKey(c), "json")) as EnrichmentRecord | null;
    return rec && rec.v === 1 ? rec : null;
  } catch {
    return null;
  }
}

export async function readRecord(deps: Deps, c: CandRef): Promise<EnrichmentRecord | null> {
  const db = await d1(deps);
  if (db) {
    try {
      const row = await db
        .prepare("SELECT record FROM enrichment WHERE pipeline_version = ? AND candidate_id = ?")
        .bind(c.pipeline_version, c.candidate_id)
        .first<{ record: string }>();
      if (row) return parse(row.record);
    } catch (err) {
      console.error("D1 read of a JPL result failed:", err);
    }
  }
  const rec = await readKv(deps, c);
  if (rec) {
    if (db) await upsert(db, c, rec).catch(() => undefined); // copy the KV record into D1
    return rec;
  }
  if (db || deps.kv) return null;
  const e = await cachedEnrichment(deps.cache, c).catch(() => null);
  return e ? { v: 1, status: "checked", enrichment: e, attempted_utc: e.known_object.query_utc ?? "" } : null;
}

/**
 * The JPL result the survey pipeline wrote into the static file (spherex-px triage, enrichment
 * "pipeline"), as a record; null when the pipeline has not checked the candidate.
 */
export function pipelineRecord(k: KnownObject | null | undefined): EnrichmentRecord | null {
  if (!k || k.enrichment !== "pipeline") return null;
  return {
    v: 1,
    status: k.checked ? "checked" : "failed",
    enrichment: { known_object: k, matched: k.matched },
    attempted_utc: k.query_utc ?? "",
  };
}

/** A pipeline match is final: JPL identified the object, so the Worker never asks JPL again. */
export const isFinalMatch = (k: KnownObject | null | undefined): boolean =>
  !!k && k.enrichment === "pipeline" && k.checked && k.matched;

/** The newer of a stored (Worker) result and the pipeline's, preferring a checked one. */
export function newestRecord(a: EnrichmentRecord | null, b: EnrichmentRecord | null): EnrichmentRecord | null {
  if (!a || !b) return a ?? b;
  if (a.status !== b.status) return a.status === "checked" ? a : b;
  return (Date.parse(a.attempted_utc) || 0) >= (Date.parse(b.attempted_utc) || 0) ? a : b;
}

/**
 * Stored results for candidates built by possibly different pipeline commits (incremental
 * survey runs): one D1 query per distinct version, usually one or two.
 */
export async function readRecordsFor(deps: Deps, refs: CandRef[]): Promise<Map<string, EnrichmentRecord>> {
  const byVersion = new Map<string, string[]>();
  for (const r of refs) byVersion.set(r.pipeline_version, [...(byVersion.get(r.pipeline_version) ?? []), r.candidate_id]);
  const out = new Map<string, EnrichmentRecord>();
  for (const [version, ids] of byVersion) {
    for (const [id, rec] of await readRecords(deps, version, ids)) out.set(id, rec);
  }
  return out;
}

/**
 * Every stored result for these candidates in one D1 query. Records still only in KV are copied
 * into D1 by the cron (scheduled.ts) and by detail views, not here, so a list costs one query
 * however long it is. Without D1, one KV (or cache) read per candidate.
 */
export async function readRecords(
  deps: Deps,
  pipelineVersion: string,
  candidateIds: string[],
): Promise<Map<string, EnrichmentRecord>> {
  const out = new Map<string, EnrichmentRecord>();
  const db = await d1(deps);
  if (db) {
    try {
      const { results } = await db
        .prepare("SELECT candidate_id, record FROM enrichment WHERE pipeline_version = ?")
        .bind(pipelineVersion)
        .all<{ candidate_id: string; record: string }>();
      const wanted = new Set(candidateIds);
      for (const r of results) {
        const rec = wanted.has(r.candidate_id) ? parse(r.record) : null;
        if (rec) out.set(r.candidate_id, rec);
      }
    } catch (err) {
      console.error("D1 read of JPL results failed:", err);
    }
  }
  if (db) return out;
  const missing = candidateIds;
  if (missing.length > 0) {
    const recs = await Promise.all(missing.map((id) => readRecord(deps, { candidate_id: id, pipeline_version: pipelineVersion })));
    missing.forEach((id, i) => {
      const rec = recs[i];
      if (rec) out.set(id, rec);
    });
  }
  return out;
}

export async function writeRecord(
  deps: Deps,
  c: CandRef,
  e: Enrichment,
  orbitComparison: JplOrbitComparison | null = null,
): Promise<void> {
  const status = e.known_object.checked ? "checked" : "failed";
  const rec: EnrichmentRecord = {
    v: 1,
    status,
    enrichment: e,
    attempted_utc: deps.now().toISOString(),
    ...(orbitComparison ? { orbit_comparison: orbitComparison } : {}),
  };
  const db = await d1(deps);
  if (db) {
    try {
      await upsert(db, c, rec);
      return;
    } catch (err) {
      console.error("D1 write of a JPL result failed:", err);
    }
  }
  if (deps.kv) {
    await deps.kv
      .put(recordKey(c), JSON.stringify(rec), status === "failed" ? { expirationTtl: FAILED_RETRY_SECONDS } : undefined)
      .catch(() => undefined);
    return;
  }
  await storeEnrichment(deps.cache, c, e).catch(() => undefined);
}

/** True when this invocation may run the lookup (no other one started in the last minute). */
async function takeLock(deps: Deps, c: CandRef): Promise<boolean> {
  const db = await d1(deps);
  if (db) {
    const now = Math.floor(deps.now().getTime() / 1000);
    try {
      const row = await db
        .prepare(
          "INSERT INTO locks (key, expires_at) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET expires_at = excluded.expires_at " +
            "WHERE locks.expires_at <= ? RETURNING key",
        )
        .bind(lockKey(c), now + LOCK_SECONDS, now)
        .first<{ key: string }>();
      return row !== null;
    } catch {
      return true;
    }
  }
  if (!deps.kv) return true;
  try {
    if (await deps.kv.get(lockKey(c), "json")) return false;
    await deps.kv.put(lockKey(c), JSON.stringify({ at: deps.now().toISOString() }), { expirationTtl: LOCK_SECONDS });
    return true;
  } catch {
    return true;
  }
}

/**
 * Run the JPL lookup for one candidate and store the result. When JPL identifies it and its
 * object has an orbit, also compare that orbit with JPL's. Returns null if another run holds
 * the lock.
 */
export async function refreshRecord(
  deps: Deps,
  cand: CandidateDetail,
  orbit: OrbitalElements | null = null,
): Promise<Enrichment | null> {
  if (cand.classification === "injected") return null;
  if (!(await takeLock(deps, cand))) return null;
  const e = await enrichKnownObject(deps, cand);
  let comparison: JplOrbitComparison | null = null;
  if (e.matched && e.known_object.designation && orbit) {
    comparison = await compareOrbit(deps, e.known_object.designation, orbit).catch((err) => {
      console.error(`orbit comparison for ${cand.candidate_id}:`, err);
      return null;
    });
  }
  await writeRecord(deps, cand, e, comparison);
  return e;
}

/** Whether the cron should refresh this record now. Failed lookups wait FAILED_RETRY_SECONDS. */
export function isStale(rec: EnrichmentRecord | null, now: Date): boolean {
  if (!rec) return true;
  const at = Date.parse(rec.attempted_utc);
  if (!Number.isFinite(at)) return true;
  const age = now.getTime() - at;
  return rec.status === "failed" ? age >= FAILED_RETRY_SECONDS * 1000 : age > REFRESH_AFTER_HOURS * 3600_000;
}
