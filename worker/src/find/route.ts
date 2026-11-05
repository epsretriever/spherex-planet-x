/** GET /api/find?q=... and GET /api/find/suggest?q=... (the precovery search). */
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { rateLimit, sha256 } from "../ai/core";
import { ApiError, UpstreamError } from "../errors";
import { enrichedObjects } from "../routes/objects";
import { SCHEMA_VERSION, workerVersion } from "../version";
import type { FindResult, FindSuggestion, FindSuggestions } from "./contract";
import { SBDB, sbdbLookup } from "./sbdb";
import { normalizeQuery, runFind } from "./search";

export const find = new Hono<AppEnv>();

/** Live searches (cache misses) per IP address per hour. */
export const FIND_PER_IP_PER_HOUR = 20;
export const SUGGEST_PER_IP_PER_HOUR = 300;
export const RESULT_TTL_S = 24 * 3600;
export const EMPTY_RESULT_TTL_S = 3600;
const CACHE_VERSION = "v1";

const resultKey = (q: string) => `find:${CACHE_VERSION}:${q.toLowerCase()}`;

async function limited(c: { env: AppEnv["Bindings"]; req: { header(n: string): string | undefined } }, prefix: string, limit: number, now: Date) {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const key = `${prefix}:${(await sha256(`${c.env.HASH_SALT ?? ""}\n${ip}`)).slice(0, 32)}`;
  return !(await rateLimit(c.env.DB, key, limit, 3600, now));
}

/** Clearer words for the upstream failures a visitor can meet. */
function explain(err: UpstreamError): ApiError {
  if (err.upstream === SBDB && err.upstreamStatus === 502) {
    return new UpstreamError(
      SBDB,
      502,
      "JPL's Small-Body Database could not answer. It also answers this way for names it doesn't know, so check the spelling or try the number or designation.",
    );
  }
  if (err.upstreamStatus === "timeout") {
    return new UpstreamError(err.upstream ?? "upstream", "timeout", `${err.upstream} took too long to answer. Please try again in a minute.`);
  }
  if (err.upstreamStatus === "budget") {
    return new UpstreamError(err.upstream ?? "upstream", "budget", "This search needed more calls to NASA's services than one request may make. Please try again: finished parts are cached.");
  }
  return err;
}

find.get("/", async (c) => {
  const deps = c.get("deps");
  const q = normalizeQuery(c.req.query("q"));
  const now = deps.now();
  const key = resultKey(q);
  if (deps.kv) {
    try {
      const hit = (await deps.kv.get(key, "json")) as FindResult | null;
      if (hit && hit.schema_version) {
        c.header("Cache-Control", "public, max-age=600");
        return c.json({ ...hit, cached: true });
      }
    } catch {
      // a cache failure must never fail the request
    }
  }
  if (await limited(c, "find-ip", FIND_PER_IP_PER_HOUR, now)) {
    c.header("Retry-After", String(3600 - (Math.floor(now.getTime() / 1000) % 3600)));
    throw new ApiError(429, "Too many new searches from here this hour. Searches someone already ran still load; please try again later.");
  }
  let result: FindResult;
  try {
    result = await runFind(c.env, deps, q);
  } catch (err) {
    if (err instanceof UpstreamError) throw explain(err);
    throw err;
  }
  if (deps.kv && (result.search?.complete ?? true)) {
    const ttl = result.status === "found" && result.n_frames > 0 ? RESULT_TTL_S : EMPTY_RESULT_TTL_S;
    try {
      await deps.kv.put(key, JSON.stringify(result), { expirationTtl: ttl });
    } catch {
      // best effort
    }
  }
  c.header("Cache-Control", "no-store");
  return c.json(result);
});

find.get("/suggest", async (c) => {
  const deps = c.get("deps");
  const raw = (c.req.query("q") ?? "").trim();
  const out: FindSuggestion[] = [];
  const body = (): FindSuggestions => ({ schema_version: SCHEMA_VERSION, pipeline_version: workerVersion(), query: raw, suggestions: out.slice(0, 10) });
  if (raw.length < 2) return c.json(body());
  const q = normalizeQuery(raw);
  const needle = q.toLowerCase();
  // Bodies already in our catalog first (no upstream call).
  try {
    const { objects } = await enrichedObjects(c.env, deps);
    const seen = new Set<string>();
    for (const o of objects) {
      const d = o.known_object_matched ? o.known_object_designation : null;
      if (!d || o.classification === "injected") continue;
      const label = d.replace(/^\((.*)\)$/, "$1").trim();
      if (seen.has(label.toLowerCase()) || !label.toLowerCase().includes(needle)) continue;
      seen.add(label.toLowerCase());
      out.push({ label: `${label} · in our catalog`, query: label, source: "catalog" });
    }
  } catch {
    // the catalog is optional here
  }
  if (q.length >= 3 && !(await limited(c, "find-suggest-ip", SUGGEST_PER_IP_PER_HOUR, deps.now()))) {
    try {
      const look = await sbdbLookup(deps, q);
      if (look.status === "found") out.unshift({ label: look.object.full_name, query: look.object.designation, source: "sbdb" });
      if (look.status === "ambiguous") for (const m of look.matches.slice(0, 8)) out.push({ label: m.name, query: m.designation, source: "sbdb" });
    } catch {
      // suggestions are best effort
    }
  }
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(body());
});
