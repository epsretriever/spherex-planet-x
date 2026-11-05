import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { json, makeClient } from "./helpers";

// The real published file, so the route is tested on what the site serves.
const published = JSON.parse(readFileSync(new URL("../../frontend/public/data/survey/exclusion.json", import.meta.url), "utf8"));

describe("GET /api/exclusion", () => {
  it("serves the published exclusion map", async () => {
    const { get } = makeClient({ files: { "/data/survey/exclusion.json": published } });
    const res = await get("/api/exclusion");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    const body = (await json(res)) as typeof published;
    expect(body).toEqual(published);
    expect(body.completeness.simulated).toBe(true);
    expect(body.survey.n_patches_searched).toBeGreaterThan(0);
  });

  it("answers 404 before the pipeline has published it", async () => {
    const { get } = makeClient({ files: {} });
    const res = await get("/api/exclusion/");
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ detail: "exclusion map not found" });
  });
});
