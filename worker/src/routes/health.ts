import { Hono } from "hono";
import type { AppEnv } from "../app";
import type { CandidateList, FieldList, Health, UpstreamStatusEntry } from "../contract";
import type { Deps } from "../env";
import { readStaticJson } from "../static-data";
import { UPSTREAM_TIMEOUT_MS } from "../upstream";
import { UPSTREAMS, type Upstream } from "../upstreams";
import { SCHEMA_VERSION, USER_AGENT, workerVersion } from "../version";

export const health = new Hono<AppEnv>();

/** Probe results are reused for 10 minutes so health checks don't hammer NASA and JPL. */
export const PROBE_TTL_S = 600;
const PROBE_ORIGIN = "https://health.spherex-planet-x.internal/probe/";

const probeKey = (u: Upstream) => new Request(PROBE_ORIGIN + encodeURIComponent(u.name));

async function cachedProbe(deps: Deps, u: Upstream): Promise<UpstreamStatusEntry | null> {
  if (!deps.cache) return null;
  try {
    const hit = await deps.cache.match(probeKey(u));
    return hit ? { ...((await hit.json()) as UpstreamStatusEntry), cached: true } : null;
  } catch {
    return null; // a cache failure must never fail the health check
  }
}

async function storeProbe(deps: Deps, u: Upstream, entry: UpstreamStatusEntry): Promise<void> {
  if (!deps.cache) return;
  try {
    await deps.cache.put(
      probeKey(u),
      new Response(JSON.stringify(entry), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${PROBE_TTL_S}` },
      }),
    );
  } catch {
    // ignore
  }
}

export async function probe(deps: Deps, u: Upstream): Promise<UpstreamStatusEntry> {
  const cached = await cachedProbe(deps, u);
  if (cached) return cached;
  const started = Date.now();
  const base = { name: u.name, url: u.url, probed_utc: deps.now().toISOString(), cached: false };
  let entry: UpstreamStatusEntry;
  if (deps.budget.remaining <= 0) {
    return { ...base, reachable: false, http_status: null, latency_ms: null, detail: "not probed: request budget used up" };
  }
  deps.budget.remaining -= 1;
  try {
    const res = await deps.fetch(u.probe, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const body = await res.text();
    const ok = res.status === 200 && u.accept(body);
    entry = {
      ...base,
      reachable: ok,
      http_status: res.status,
      latency_ms: Date.now() - started,
      detail: ok ? null : res.status === 200 ? "unexpected response to a valid probe" : `HTTP ${res.status}`,
    };
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    entry = {
      ...base,
      reachable: false,
      http_status: null,
      latency_ms: Date.now() - started,
      detail: timeout ? "timeout" : "unreachable",
    };
  }
  await storeProbe(deps, u, entry);
  return entry;
}

health.get("/", async (c) => {
  const deps = c.get("deps");
  const [upstream, fields, candidates] = await Promise.all([
    Promise.all(UPSTREAMS.map((u) => probe(deps, u))),
    readStaticJson<FieldList>(c.env, "fields.json").catch(() => null),
    readStaticJson<CandidateList>(c.env, "candidates.json").catch(() => null),
  ]);
  const body: Health = {
    schema_version: SCHEMA_VERSION,
    pipeline_version: fields?.pipeline_version ?? workerVersion(),
    build_run_id: fields?.build_run_id ?? null,
    status: upstream.every((u) => u.reachable) && fields !== null ? "ok" : "degraded",
    checked_utc: deps.now().toISOString(),
    fields_loaded: fields?.fields.length ?? 0,
    candidates_loaded: candidates?.candidates.length ?? 0,
    upstream,
  };
  c.header("Cache-Control", "no-store");
  return c.json(body);
});
