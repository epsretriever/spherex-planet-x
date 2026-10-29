import type { Deps } from "./env";
import { UpstreamError } from "./errors";
import { USER_AGENT } from "./version";

export const UPSTREAM_TIMEOUT_MS = 15_000;
export const UPSTREAM_CACHE_TTL_S = 24 * 60 * 60;

export interface UpstreamResult<T> {
  data: T;
  cached: boolean;
  status: number;
}

/**
 * GET an upstream URL with a 15 s timeout and a descriptive User-Agent. Successful responses
 * are stored in the Cache API for 24 hours, keyed by URL.
 */
export async function fetchUpstream<T = unknown>(
  deps: Deps,
  name: string,
  url: string,
  opts: { as?: "json" | "text"; ttlSeconds?: number; timeoutMs?: number } = {},
): Promise<UpstreamResult<T>> {
  const as = opts.as ?? "json";
  const key = new Request(url, { method: "GET" });
  if (deps.cache) {
    let hit: Response | undefined;
    try {
      hit = await deps.cache.match(key);
    } catch {
      hit = undefined; // a cache failure must never fail the request
    }
    if (hit) return { data: (await parse(hit, as, name)) as T, cached: true, status: hit.status };
  }
  let res: Response;
  try {
    res = await deps.fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: as === "json" ? "application/json" : "*/*" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    // Anything else, including the Workers subrequest limit, means we could not reach it.
    throw new UpstreamError(name, timeout ? "timeout" : "unreachable");
  }
  if (!res.ok) throw new UpstreamError(name, res.status);
  const body = await res.text();
  const data = (await parse(new Response(body), as, name)) as T;
  if (deps.cache) {
    const stored = new Response(body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": `public, max-age=${opts.ttlSeconds ?? UPSTREAM_CACHE_TTL_S}`,
      },
    });
    try {
      await deps.cache.put(key, stored);
    } catch {
      // Caching is best-effort.
    }
  }
  return { data, cached: false, status: res.status };
}

async function parse(res: Response, as: "json" | "text", name: string): Promise<unknown> {
  if (as === "text") return res.text();
  try {
    return await res.json();
  } catch {
    throw new UpstreamError(name, "invalid_response", `${name} returned a response that is not JSON`);
  }
}
