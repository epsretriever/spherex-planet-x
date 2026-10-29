import { describe, expect, it } from "vitest";
import { json, makeClient } from "./helpers";

// Minimal shapes for routing tests; real recorded data lives in shared/fixtures.
const fieldList = {
  schema_version: "1.0",
  pipeline_version: "test",
  generated_utc: "2026-10-29T00:00:00Z",
  fields: [{ field_id: "test-field" }],
};
const fieldDetail = { schema_version: "1.0", pipeline_version: "test", field_id: "test-field", epochs: [] };

describe("GET /api/fields", () => {
  it("serves the static field list", async () => {
    const { get } = makeClient({ files: { "/data/fields.json": fieldList } });
    const res = await get("/api/fields");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual(fieldList);
    expect(res.headers.get("cache-control")).toContain("max-age");
  });

  it("returns 503 with a JSON error when static data is missing", async () => {
    const { get } = makeClient();
    const res = await get("/api/fields");
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({
      detail: "Static data has not been built: data/fields.json is missing",
      upstream: null,
      upstream_status: null,
    });
  });
});

describe("GET /api/fields/:fieldId", () => {
  it("serves a field", async () => {
    const { get } = makeClient({ files: { "/data/fields/test-field.json": fieldDetail } });
    const res = await get("/api/fields/test-field");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual(fieldDetail);
  });

  it("404s on unknown ids even though assets fall back to index.html", async () => {
    const { get } = makeClient();
    const res = await get("/api/fields/nope");
    expect(res.status).toBe(404);
    expect((await json(res)).detail).toBe("field 'nope' not found");
  });

  it("rejects ids that could escape the data directory", async () => {
    const { get } = makeClient();
    const res = await get("/api/fields/..%2Fsecret");
    expect(res.status).toBe(400);
  });
});

describe("unknown API routes", () => {
  it("answer JSON 404", async () => {
    const { get } = makeClient();
    const res = await get("/api/nothing-here");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
