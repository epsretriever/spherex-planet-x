import { describe, expect, it } from "vitest";
import type { Deps } from "../src/env";
import { UpstreamError } from "../src/errors";
import { fetchUpstream } from "../src/upstream";
import { USER_AGENT } from "../src/version";
import { MemoryCache } from "./helpers";

function deps(handler: (url: string, init?: RequestInit) => Promise<Response>): Deps & { cache: MemoryCache } {
  return { fetch: handler as typeof fetch, cache: new MemoryCache(), now: () => new Date() };
}

describe("fetchUpstream", () => {
  it("sends a User-Agent, caches for 24 h and serves the second call from cache", async () => {
    let n = 0;
    let ua: string | null = null;
    const d = deps(async (_url, init) => {
      n++;
      ua = new Headers(init?.headers).get("User-Agent");
      return new Response(JSON.stringify({ ok: 1 }), { headers: { "content-type": "application/json" } });
    });
    const a = await fetchUpstream(d, "JPL SBIdent", "https://example.test/a");
    const b = await fetchUpstream(d, "JPL SBIdent", "https://example.test/a");
    expect(a).toEqual({ data: { ok: 1 }, cached: false, status: 200 });
    expect(b.cached).toBe(true);
    expect(b.data).toEqual({ ok: 1 });
    expect(n).toBe(1);
    expect(ua).toBe(USER_AGENT);
    expect(d.cache.store.get("https://example.test/a")?.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("does not cache failures and reports the upstream status", async () => {
    const d = deps(async () => new Response("err", { status: 503 }));
    const err = await fetchUpstream(d, "IRSA TAP", "https://example.test/b").catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.status).toBe(502);
    expect(err.toJSON()).toEqual({ detail: "IRSA TAP failed (503)", upstream: "IRSA TAP", upstream_status: 503 });
    expect(d.cache.store.size).toBe(0);
  });

  it("maps timeouts to 504", async () => {
    const d = deps(
      (_url, init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
        ),
    );
    const err = await fetchUpstream(d, "JPL Horizons", "https://example.test/c", { timeoutMs: 20 }).catch((e) => e);
    expect(err.status).toBe(504);
    expect(err.upstreamStatus).toBe("timeout");
  });

  it("rejects non-JSON bodies when JSON is expected", async () => {
    const d = deps(async () => new Response("<html>"));
    const err = await fetchUpstream(d, "JPL SBIdent", "https://example.test/d").catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.upstreamStatus).toBe("invalid_response");
  });
});
