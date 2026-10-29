import { describe, expect, it } from "vitest";
import { UPSTREAMS } from "../src/upstreams";
import { json, makeClient } from "./helpers";

const files = {
  "/data/fields.json": { schema_version: "1.0", pipeline_version: "0.1.0+git.abc", fields: [{}, {}] },
  "/data/candidates.json": { schema_version: "1.0", pipeline_version: "0.1.0+git.abc", candidates: [{}, {}, {}] },
};

describe("GET /api/health", () => {
  it("reports ok when every upstream answers and data is loaded", async () => {
    const { get, calls } = makeClient({ files, upstream: () => new Response("{}", { status: 400 }) });
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.status).toBe("ok");
    expect(body.schema_version).toBe("1.0");
    expect(body.pipeline_version).toBe("0.1.0+git.abc");
    expect(body.fields_loaded).toBe(2);
    expect(body.candidates_loaded).toBe(3);
    expect(body.upstream).toHaveLength(UPSTREAMS.length);
    expect(body.upstream.every((u: { reachable: boolean; http_status: number }) => u.reachable && u.http_status === 400)).toBe(true);
    expect(calls).toHaveLength(UPSTREAMS.length);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reports degraded and names the failing upstream", async () => {
    const { get } = makeClient({
      files,
      upstream: (url) => {
        if (url.hostname === "ssd-api.jpl.nasa.gov") throw new TypeError("connection refused");
        if (url.hostname === "ssd.jpl.nasa.gov") return new Response("down", { status: 503 });
        return new Response("ok");
      },
    });
    const body = await json(await get("/api/health"));
    expect(body.status).toBe("degraded");
    const byName = Object.fromEntries(body.upstream.map((u: { name: string }) => [u.name, u]));
    expect(byName["JPL SBIdent"]).toMatchObject({ reachable: false, detail: "unreachable", http_status: null });
    expect(byName["JPL Horizons"]).toMatchObject({ reachable: false, http_status: 503 });
    expect(byName["IRSA TAP"].reachable).toBe(true);
  });

  it("is degraded when static data is missing", async () => {
    const { get } = makeClient({ upstream: () => new Response("ok") });
    const body = await json(await get("/api/health"));
    expect(body.status).toBe("degraded");
    expect(body.fields_loaded).toBe(0);
    expect(body.pipeline_version).toMatch(/^worker-/);
  });
});
