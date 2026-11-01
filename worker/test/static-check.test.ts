import { describe, expect, it } from "vitest";
import type { CandidateDetail, CandidateList } from "../src/contract";
import { notCheckedKnownObject } from "../src/enrich";
import { writeRecord } from "../src/store";
import { candidate, list } from "./factory";
import { json, makeClient } from "./helpers";

const checked = candidate({
  candidate_id: "tile-c01",
  known_object: {
    ...candidate().known_object,
    checked: true,
    not_checked_reason: null,
    matched: true,
    catalogs_checked: ["JPL SBIdent", "JPL Horizons"],
    designation: "5193 Tanakawataru (1992 ET)",
    predicted_vmag: 17.4,
    query_utc: "2026-11-01T19:40:00Z",
    enrichment: "static",
  },
});
const files = { "/data/candidates.json": list([checked]), "/data/candidates/tile-c01.json": checked };

describe("results checked when the data was published", () => {
  it("are served at once, without asking JPL again", async () => {
    const c = makeClient({ files, upstream: () => new Response("unexpected", { status: 500 }) });
    const r = await c.get("/api/candidates/tile-c01");
    const body = (await json(r)) as CandidateDetail;
    await c.settle();
    expect(c.calls).toHaveLength(0);
    expect(body.classification).toBe("known_object");
    expect(body.known_object).toMatchObject({ checked: true, enrichment: "static", designation: "5193 Tanakawataru (1992 ET)" });
    expect(r.headers.get("cache-control")).toContain("max-age");
  });

  it("are not hidden by a later lookup that JPL did not answer", async () => {
    const c = makeClient({ files });
    const failed = { ...notCheckedKnownObject("JPL SBIdent timed out.", checked.known_object), enrichment: "live" as const };
    await writeRecord(c.deps, checked, { known_object: failed, matched: false });
    const detail = (await json(await c.get("/api/candidates/tile-c01"))) as CandidateDetail;
    expect(detail.known_object).toMatchObject({ checked: true, matched: true, designation: "5193 Tanakawataru (1992 ET)" });
    const listed = (await json(await c.get("/api/candidates"))) as CandidateList;
    expect(listed.candidates[0]).toMatchObject({ known_object_checked: true, known_object_matched: true });
    await c.settle();
    expect(c.calls).toHaveLength(0);
  });
});
