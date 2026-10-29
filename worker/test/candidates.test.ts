import { describe, expect, it } from "vitest";
import { MATCH_RADIUS_ARCSEC } from "../src/enrich";
import { candidate, horizonsBody, list, sbidentBody } from "./factory";
import { type FetchHandler, MemoryCache, json, makeClient } from "./helpers";

const injected = candidate({
  candidate_id: "test-inj-1",
  classification: "injected",
  label_plain: "SIMULATED",
  injection: { study_id: "test-study" },
  known_object: { ...candidate().known_object, not_checked_reason: "Simulated object." },
});
const artifact = candidate({ candidate_id: "test-art-1", classification: "likely_artifact", scores: { ...candidate().scores, overall: 0.1, quality_level: "low" } });
const base = candidate();

const files = {
  "/data/candidates.json": list([base, injected, artifact]),
  [`/data/candidates/${base.candidate_id}.json`]: base,
  [`/data/candidates/${injected.candidate_id}.json`]: injected,
};

/** JPL answers: SBIdent always lists one object at the detection; Horizons agrees. */
function jpl(offsetArcsec: number, name = "99999 Testobject (2001 AA1)"): FetchHandler {
  return (url) => {
    if (url.hostname === "ssd-api.jpl.nasa.gov") {
      // find which detection this is by the obs-time
      const t = url.searchParams.get("obs-time")!;
      const d = base.detections.find((x) => x.time_utc.startsWith(t.replace("_", "T")))!;
      return Response.json(sbidentBody(name, d.ra_deg, d.dec_deg));
    }
    if (url.hostname === "ssd.jpl.nasa.gov") {
      const jds = url.searchParams.get("TLIST")!.split(" ").map((s) => Number(s.replace(/'/g, "")));
      return Response.json(
        horizonsBody(
          jds.map((jd, i) => ({
            jd,
            ra: base.detections[i]!.ra_deg + offsetArcsec / 3600,
            dec: base.detections[i]!.dec_deg,
            delta: 1.5,
          })),
        ),
      );
    }
    return new Response("unexpected", { status: 500 });
  };
}

describe("GET /api/candidates", () => {
  it("hides injected candidates unless asked", async () => {
    const { get } = makeClient({ files });
    const body = await json(await get("/api/candidates"));
    expect(body.candidates.map((c: { candidate_id: string }) => c.candidate_id)).toEqual(["test-cand-1", "test-art-1"]);
    expect(body.total).toBe(2);
    const all = await json(await get("/api/candidates?include_injected=true"));
    expect(all.total).toBe(3);
    const only = await json(await get("/api/candidates?classification=injected"));
    expect(only.candidates.map((c: { classification: string }) => c.classification)).toEqual(["injected"]);
  });

  it("filters by min_score, field and classification", async () => {
    const { get } = makeClient({ files });
    expect((await json(await get("/api/candidates?min_score=0.5"))).total).toBe(1);
    expect((await json(await get("/api/candidates?field_id=other"))).total).toBe(0);
    expect((await json(await get("/api/candidates?classification=likely_artifact&classification=unmatched"))).total).toBe(2);
  });

  it("validates parameters", async () => {
    const { get } = makeClient({ files });
    expect((await get("/api/candidates?classification=new_planet")).status).toBe(400);
    expect((await get("/api/candidates?min_score=2")).status).toBe(400);
  });

  it("uses cached enrichment in the list without calling JPL", async () => {
    const cache = new MemoryCache();
    const first = makeClient({ files, cache, upstream: jpl(2) });
    await first.get(`/api/candidates/${base.candidate_id}`);
    const second = makeClient({ files, cache });
    const body = await json(await second.get("/api/candidates"));
    expect(body.candidates[0]).toMatchObject({
      classification: "known_object",
      label_plain: "Known asteroid",
      known_object_checked: true,
      known_object_matched: true,
      known_object_designation: "99999 Testobject (2001 AA1)",
    });
    expect(second.calls).toHaveLength(0);
  });
});

describe("GET /api/candidates/:id enrichment", () => {
  it("labels a candidate known_object when JPL predicts it at every epoch", async () => {
    const { get, calls } = makeClient({ files, upstream: jpl(2) });
    const c = await json(await get(`/api/candidates/${base.candidate_id}`));
    expect(c.classification).toBe("known_object");
    expect(c.label_plain).toBe("Known asteroid");
    expect(c.known_object).toMatchObject({
      checked: true,
      matched: true,
      catalogs_checked: ["JPL SBIdent", "JPL Horizons"],
      search_radius_arcsec: MATCH_RADIUS_ARCSEC,
      designation: "99999 Testobject (2001 AA1)",
      enrichment: "live",
    });
    expect(c.known_object.per_epoch).toHaveLength(3);
    expect(c.known_object.per_epoch[0].separation_arcsec).toBeCloseTo(2, 0);
    // one SBIdent call per epoch + one Horizons call
    expect(calls.filter((u) => u.includes("sb_ident")).length).toBe(3);
    expect(calls.filter((u) => u.includes("horizons")).length).toBe(1);
    expect(c.explanation.numeric_check).toBe("passed");
    expect(c.explanation.text).toContain("99999 Testobject (2001 AA1)");
    expect(c.error_sources.find((e: { id: string }) => e.id === "catalog_gap").status).toBe("ruled_out");
    expect(c.vetting.find((v: { check: string }) => v.check === "known_object_match").value).toBe(true);
  });

  it("keeps an unmatched candidate unmatched and reports the nearest object", async () => {
    const { get } = makeClient({ files, upstream: jpl(60) });
    const c = await json(await get(`/api/candidates/${base.candidate_id}`));
    expect(c.classification).toBe("unmatched");
    expect(c.known_object.checked).toBe(true);
    expect(c.known_object.matched).toBe(false);
    expect(c.known_object.nearest.designation).toBe("99999 Testobject (2001 AA1)");
    expect(c.known_object.nearest.separation_arcsec).toBeCloseTo(60, 0);
    expect(c.summary_plain).toContain("does not match any known object");
    expect(c.explanation.numeric_check).toBe("passed");
    expect(c.error_sources.find((e: { id: string }) => e.id === "catalog_gap").status).toBe("unknown");
  });

  it("returns the report with checked=false when JPL is down", async () => {
    const { get } = makeClient({ files, upstream: () => new Response("down", { status: 503 }) });
    const res = await get(`/api/candidates/${base.candidate_id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const c = await json(res);
    expect(c.classification).toBe("unmatched");
    expect(c.known_object.checked).toBe(false);
    expect(c.known_object.catalogs_checked).toEqual([]);
    expect(c.known_object.not_checked_reason).toContain("503");
    expect(c.summary_plain).toContain("Not yet checked");
  });

  it("serves the second request from the enrichment cache", async () => {
    const cache = new MemoryCache();
    const a = makeClient({ files, cache, upstream: jpl(2) });
    await a.get(`/api/candidates/${base.candidate_id}`);
    const b = makeClient({ files, cache });
    const c = await json(await b.get(`/api/candidates/${base.candidate_id}`));
    expect(b.calls).toHaveLength(0);
    expect(c.known_object.enrichment).toBe("cached");
    expect(c.classification).toBe("known_object");
  });

  it("never sends injected candidates to JPL or relabels them", async () => {
    const { get, calls } = makeClient({ files, upstream: jpl(0) });
    const c = await json(await get(`/api/candidates/${injected.candidate_id}`));
    expect(calls).toHaveLength(0);
    expect(c.classification).toBe("injected");
    expect(c.label_plain).toBe("SIMULATED");
    expect(c.known_object.checked).toBe(false);
  });

  it("404s unknown candidates", async () => {
    const { get } = makeClient({ files });
    expect((await get("/api/candidates/test-missing")).status).toBe(404);
  });
});
