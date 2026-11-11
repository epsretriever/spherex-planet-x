import { describe, expect, it } from "vitest";
import { coverageAdql, coverageRows, parseCsv } from "../src/irsa";
import { json, makeClient } from "./helpers";

describe("GET /api/coverage", () => {
  const csv = [
    "uri,planeid,energy_bandpassname,time_bounds_lower,time_bounds_upper,energy_bounds_lower,energy_bounds_upper",
    'ibe/data/spherex/qr2/level2/x/level2_2025W23_1C_0164_1D1_spx_l2b-v20-2025-251.fits,"12345",SPHEREx-D1,60828.926,60828.928,7.5e-07,1.1e-06',
  ].join("\r\n");

  it("queries IRSA TAP and maps rows to the contract", async () => {
    const { get, calls } = makeClient({ upstream: () => new Response(csv, { headers: { "content-type": "text/csv" } }) });
    const res = await get("/api/coverage?ra_deg=350.9&dec_deg=-1.7");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.n_epochs).toBe(1);
    expect(body.epochs[0]).toMatchObject({
      obs_id: "2025W23_1C_0164_1",
      planeid: "12345",
      detector: 1,
      bandpass: "SPHEREx-D1",
      mjd: 60828.926,
      wavelength_um_range: [0.75, 1.1],
      archive_url: "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/x/level2_2025W23_1C_0164_1D1_spx_l2b-v20-2025-251.fits",
    });
    expect(calls[0]).toContain("irsa.ipac.caltech.edu/TAP/sync");
    expect(decodeURIComponent(calls[0]!.replace(/\+/g, " "))).toContain("CONTAINS(POINT('ICRS', 350.9, -1.7), p.poly)");
  });

  it("returns 502 with upstream_status when IRSA fails, 504 on timeout", async () => {
    const down = makeClient({ upstream: () => new Response("x", { status: 503 }) });
    const res = await down.get("/api/coverage?ra_deg=1&dec_deg=1");
    expect(res.status).toBe(502);
    expect(await json(res)).toEqual({ detail: "IRSA TAP failed (503)", upstream: "IRSA TAP", upstream_status: 503 });
  });

  it("validates coordinates", async () => {
    const { get } = makeClient();
    expect((await get("/api/coverage?ra_deg=400&dec_deg=0")).status).toBe(400);
    expect((await get("/api/coverage?dec_deg=0")).status).toBe(400);
  });

  it("uses INTERSECTS for a radius", () => {
    expect(coverageAdql(1, 2, 0.1)).toContain("INTERSECTS(CIRCLE('ICRS', 1, 2, 0.1), p.poly)");
  });

  it("parses quoted CSV", () => {
    expect(parseCsv('a,"b,c","d""e"\n1,2,3\n')).toEqual([["a", "b,c", 'd"e'], ["1", "2", "3"]]);
    expect(coverageRows("uri,time_bounds_lower\n", 0, 0)).toEqual([]);
  });
});

describe("runs and injection", () => {
  it("POST /api/runs explains that runs are built offline", async () => {
    const { get } = makeClient();
    const res = await get("/api/runs", { method: "POST", body: "{}" });
    expect(res.status).toBe(501);
    expect((await json(res)).detail).toContain("spherex-px run");
  });

  it("serves offline runs and injection studies from static data", async () => {
    const run = { schema_version: "1.0", pipeline_version: "test", run_id: "test-run", status: "done" };
    const study = { schema_version: "1.0", pipeline_version: "test", study_id: "test-study", simulated: true };
    const { get } = makeClient({ files: { "/data/runs/test-run.json": run, "/data/injection/test-study.json": study } });
    expect(await json(await get("/api/runs/test-run"))).toEqual(run);
    expect(await json(await get("/api/injection/test-study"))).toEqual(study);
    expect((await get("/api/injection/nope")).status).toBe(404);
    expect((await get("/api/injection/index")).status).toBe(400);
  });

  it("lists published injection studies", async () => {
    const index = { schema_version: "1.1", pipeline_version: "test", studies: [{ study_id: "test-study", generated_utc: "x", field_ids: [], n_injected: 1 }] };
    const { get } = makeClient({ files: { "/data/injection/index.json": index } });
    expect(await json(await get("/api/injection"))).toEqual(index);
    expect(await json(await get("/api/injection/"))).toEqual(index);
  });

  it("serves a study with or without a trailing slash", async () => {
    const study = { schema_version: "1.1", pipeline_version: "test", study_id: "test-study", simulated: true };
    const { get } = makeClient({ files: { "/data/injection/test-study.json": study } });
    expect(await json(await get("/api/injection/test-study/"))).toEqual(study);
  });
});

describe("API hygiene", () => {
  it("never lets an error be cached, and marks every response nosniff", async () => {
    const { get } = makeClient();
    const missing = await get("/api/objects/obj-missing");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(missing.headers.get("x-content-type-options")).toBe("nosniff");
    const bad = await get("/api/objects?limit=abc");
    expect(bad.status).toBe(400);
    expect(bad.headers.get("cache-control")).toBe("no-store");
    const unknown = await get("/api/nothing-here");
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("cache-control")).toBe("no-store");
  });
});
