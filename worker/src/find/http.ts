/**
 * Upstream requests for the precovery search. Like ../upstream.ts (same User-Agent, call
 * budget and Cache API storage) but it also sends POST forms (IRSA TAP queries are too long
 * for a URL) and lets the caller accept non-2xx answers that carry meaning (SBDB answers
 * HTTP 300 for an ambiguous name).
 */
import type { Deps } from "../env";
import { UpstreamError } from "../errors";
import { USER_AGENT } from "../version";

export interface FetchResult {
  status: number;
  body: string;
  cached: boolean;
}

/** Cache key for a POST: a synthetic GET URL holding a hash of the form. */
async function cacheKey(url: string, form: URLSearchParams | undefined): Promise<Request> {
  if (!form) return new Request(url, { method: "GET" });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.toString()));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request(`${url}/__post/${hex}`, { method: "GET" });
}

export async function upstreamText(
  deps: Deps,
  name: string,
  url: string,
  opts: { form?: URLSearchParams; timeoutMs: number; ttlSeconds: number; okStatuses?: number[] },
): Promise<FetchResult> {
  const ok = new Set(opts.okStatuses ?? [200]);
  const key = await cacheKey(url, opts.form);
  if (deps.cache) {
    try {
      const hit = await deps.cache.match(key);
      if (hit) return { status: Number(hit.headers.get("x-upstream-status") ?? 200), body: await hit.text(), cached: true };
    } catch {
      // a cache failure must never fail the request
    }
  }
  if (deps.budget.remaining <= 0) {
    throw new UpstreamError(name, "budget", `${name} skipped: this request already made its allowed number of upstream calls`);
  }
  deps.budget.remaining -= 1;
  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: opts.form ? "POST" : "GET",
      headers: {
        "User-Agent": USER_AGENT,
        ...(opts.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: opts.form?.toString(),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new UpstreamError(name, timeout ? "timeout" : "unreachable");
  }
  const body = await res.text();
  if (!ok.has(res.status)) throw new UpstreamError(name, res.status);
  if (deps.cache) {
    const stored = new Response(body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "text/plain",
        "Cache-Control": `public, max-age=${opts.ttlSeconds}`,
        "x-upstream-status": String(res.status),
      },
    });
    try {
      await deps.cache.put(key, stored);
    } catch {
      // best effort
    }
  }
  return { status: res.status, body, cached: false };
}
