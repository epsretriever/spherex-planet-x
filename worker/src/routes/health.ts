import { Hono } from "hono";
import type { CandidateList, FieldList, Health, UpstreamStatusEntry } from "../contract";
import type { AppEnv } from "../app";
import { readStaticJson } from "../static-data";
import { UPSTREAM_TIMEOUT_MS } from "../upstream";
import { UPSTREAMS } from "../upstreams";
import { SCHEMA_VERSION, USER_AGENT, workerVersion } from "../version";

export const health = new Hono<AppEnv>();

health.get("/", async (c) => {
  const deps = c.get("deps");
  const probes = UPSTREAMS.map(async (u): Promise<UpstreamStatusEntry> => {
    const started = Date.now();
    try {
      const res = await deps.fetch(u.probe, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      // Read and discard the body so the connection is released.
      await res.arrayBuffer();
      return {
        name: u.name,
        url: u.url,
        reachable: res.status < 500,
        http_status: res.status,
        latency_ms: Date.now() - started,
        detail: res.status < 500 ? null : `HTTP ${res.status}`,
      };
    } catch (err) {
      const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return {
        name: u.name,
        url: u.url,
        reachable: false,
        http_status: null,
        latency_ms: Date.now() - started,
        detail: timeout ? "timeout" : "unreachable",
      };
    }
  });
  const [upstream, fields, candidates] = await Promise.all([
    Promise.all(probes),
    readStaticJson<FieldList>(c.env, "fields.json").catch(() => null),
    readStaticJson<CandidateList>(c.env, "candidates.json").catch(() => null),
  ]);
  const body: Health = {
    schema_version: SCHEMA_VERSION,
    pipeline_version: fields?.pipeline_version ?? workerVersion(),
    status: upstream.every((u) => u.reachable) && fields !== null ? "ok" : "degraded",
    checked_utc: deps.now().toISOString(),
    fields_loaded: fields?.fields.length ?? 0,
    candidates_loaded: candidates?.candidates.length ?? 0,
    upstream,
  };
  c.header("Cache-Control", "no-store");
  return c.json(body);
});
