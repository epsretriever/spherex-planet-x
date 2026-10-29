import { describe, expect, it } from "vitest";
import { UPSTREAMS } from "../src/upstreams";
import { type FetchHandler, MemoryCache, json, makeClient } from "./helpers";

const files = {
  "/data/fields.json": {
    schema_version: "1.0",
    pipeline_version: "0.1.0+git.abc1234",
    build_run_id: "gh-1-1",
    fields: [{}, {}],
  },
  "/data/candidates.json": { schema_version: "1.0", pipeline_version: "0.1.0+git.abc1234", candidates: [{}, {}, {}] },
};

/** Each upstream answering its probe the way the real service does when it is up. */
const healthy: FetchHandler = (url) => {
  if (url.hostname === "irsa.ipac.caltech.edu") {
    return new Response('<vosi:availability><vosi:available>true</vosi:available></vosi:availability>');
  }
  if (url.hostname === "ssd-api.jpl.nasa.gov" || url.hostname === "ssd.jpl.nasa.gov") {
    return Response.json({ signature: { source: "NASA/JPL", version: "1.0" } });
  }
  return new Response("<ListBucketResult></ListBucketResult>");
};

describe("GET /api/health", () => {
  it("is ok when every upstream answers a valid probe with 200", async () => {
    const { get, calls } = makeClient({ files, upstream: healthy });
    const res = await get("/api/health");
    const body = await json(res);
    expect(body.status).toBe("ok");
    expect(body.pipeline_version).toBe("0.1.0+git.abc1234");
    expect(body.build_run_id).toBe("gh-1-1");
    expect(body.fields_loaded).toBe(2);
    expect(body.candidates_loaded).toBe(3);
    expect(body.upstream).toHaveLength(UPSTREAMS.length);
    for (const u of body.upstream) {
      expect(u).toMatchObject({ reachable: true, http_status: 200, detail: null, cached: false });
      expect(u.probed_utc).toBe("2026-10-29T12:00:00.000Z");
    }
    expect(calls).toHaveLength(UPSTREAMS.length);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("probes SBIdent with a valid field-of-view query, not a bare URL", () => {
    const sb = UPSTREAMS.find((u) => u.name === "JPL SBIdent")!;
    const q = new URL(sb.probe).searchParams;
    for (const p of ["obs-time", "fov-ra-center", "fov-dec-center", "fov-ra-hwidth", "fov-dec-hwidth"]) {
      expect(q.get(p)).toBeTruthy();
    }
    expect(q.has("lat") || q.has("xobs")).toBe(true);
    expect(q.has("mpc-code")).toBe(false); // SBIdent rejects mpc-code=500
  });

  it("does not count an HTTP 400 or an unexpected 200 as reachable", async () => {
    const { get } = makeClient({
      files,
      upstream: (url) => {
        if (url.hostname === "ssd-api.jpl.nasa.gov") return Response.json({ message: "bad request" }, { status: 400 });
        if (url.hostname === "ssd.jpl.nasa.gov") return new Response("<html>maintenance</html>");
        return healthy(url);
      },
    });
    const body = await json(await get("/api/health"));
    expect(body.status).toBe("degraded");
    const byName = Object.fromEntries(body.upstream.map((u: { name: string }) => [u.name, u]));
    expect(byName["JPL SBIdent"]).toMatchObject({ reachable: false, http_status: 400, detail: "HTTP 400" });
    expect(byName["JPL Horizons"]).toMatchObject({ reachable: false, http_status: 200, detail: "unexpected response to a valid probe" });
    expect(byName["IRSA TAP"].reachable).toBe(true);
  });

  it("reports unreachable and timeouts", async () => {
    const { get } = makeClient({
      files,
      upstream: (url) => {
        if (url.hostname === "ssd-api.jpl.nasa.gov") throw new TypeError("connection refused");
        return healthy(url);
      },
    });
    const body = await json(await get("/api/health"));
    const sb = body.upstream.find((u: { name: string }) => u.name === "JPL SBIdent");
    expect(sb).toMatchObject({ reachable: false, http_status: null, detail: "unreachable" });
  });

  it("reuses probe results for 10 minutes", async () => {
    const cache = new MemoryCache();
    const a = makeClient({ files, cache, upstream: healthy });
    await a.get("/api/health");
    const b = makeClient({ files, cache, upstream: healthy });
    const body = await json(await b.get("/api/health"));
    expect(b.calls).toHaveLength(0);
    expect(body.upstream.every((u: { cached: boolean }) => u.cached)).toBe(true);
    expect(body.status).toBe("ok");
    const stored = cache.store.values().next().value as Response;
    expect(stored.headers.get("cache-control")).toBe("public, max-age=600");
  });

  it("is degraded when static data is missing", async () => {
    const { get } = makeClient({ upstream: healthy });
    const body = await json(await get("/api/health"));
    expect(body.status).toBe("degraded");
    expect(body.fields_loaded).toBe(0);
    expect(body.build_run_id).toBeNull();
    expect(body.pipeline_version).toMatch(/^worker-/);
  });
});
