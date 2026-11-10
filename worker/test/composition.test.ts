import { describe, expect, it } from "vitest";
import { json, makeClient } from "./helpers";

describe("composition routes", () => {
  const doc = { schema_version: "1.2", pipeline_version: "0.1.0+git.abc1234", object_id: "obj-a-c01", indicative_only: true, status: "classified" };

  it("serves an object's composition from the static data", async () => {
    const { get } = makeClient({ files: { "/data/objects/obj-a-c01/composition.json": doc } });
    const res = await get("/api/objects/obj-a-c01/composition");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual(doc);
  });

  it("answers 404 when the object has no composition and 400 for bad ids", async () => {
    const { get } = makeClient();
    expect((await get("/api/objects/obj-missing/composition")).status).toBe(404);
    expect((await get("/api/objects/BAD%20ID/composition")).status).toBe(400);
  });

  it("serves the composition validation before the validation catch-all", async () => {
    const v = { schema_version: "1.2", pipeline_version: "x", n_compared: 0, simulated_recovery: [] };
    const { get } = makeClient({ files: { "/data/validation/composition.json": v } });
    const res = await get("/api/validation/composition");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual(v);
    expect((await makeClient().get("/api/validation/composition")).status).toBe(404);
  });
});
