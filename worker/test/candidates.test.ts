import { describe, expect, it } from "vitest";
import { MATCH_RADIUS_ARCSEC } from "../src/enrich";
import { candidate, horizonsBody, list, sbidentBody } from "./factory";
import { refreshStale } from "../src/scheduled";
import { type FetchHandler, MemoryKv, json, makeClient } from "./helpers";

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
  [`/data/candidates/${artifact.candidate_id}.json`]: artifact,
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

type Client = ReturnType<typeof makeClient>;

/** First request answers "pending" and starts the JPL lookup; the next one reads the stored result. */
async function lookUp(client: Client, id = base.candidate_id) {
  const first = await json(await client.get(`/api/candidates/${id}`));
  await client.settle();
  const res = await client.get(`/api/candidates/${id}`);
  return { first, res, c: await json(res) };
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

  it("uses stored enrichment in the list without calling JPL", async () => {
    const kv = new MemoryKv();
    const first = makeClient({ files, kv, upstream: jpl(2) });
    await lookUp(first);
    await lookUp(first, artifact.candidate_id);
    const second = makeClient({ files, kv });
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

  it("starts one background lookup when a listed candidate has no stored result", async () => {
    const client = makeClient({ files, upstream: jpl(2) });
    const body = await json(await client.get("/api/candidates"));
    expect(body.candidates[0].known_object_checked).toBe(false);
    await client.settle();
    const again = await json(await client.get("/api/candidates"));
    const first = again.candidates.find((x: { candidate_id: string }) => x.candidate_id === body.candidates[0].candidate_id);
    expect(first).toMatchObject({ classification: "known_object", known_object_checked: true });
    // Known objects are listed after unexplained ones.
    expect(again.candidates.at(-1).classification).toBe("known_object");
  });
});

describe("GET /api/candidates/:id enrichment", () => {
  it("answers at once with a pending check, then serves the stored JPL result", async () => {
    const client = makeClient({ files, upstream: jpl(2) });
    const res = await client.get(`/api/candidates/${base.candidate_id}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const p = await json(res);
    expect(p.known_object).toMatchObject({ checked: false, enrichment: "pending" });
    expect(p.summary_plain).toContain("being checked now");
    await client.settle();
    expect(client.calls.length).toBeGreaterThan(0);
    const c = await json(await client.get(`/api/candidates/${base.candidate_id}`));
    expect(c.known_object).toMatchObject({ checked: true, enrichment: "cached" });
  });

  it("labels a candidate known_object when JPL predicts it at every epoch", async () => {
    const client = makeClient({ files, upstream: jpl(2) });
    const { c } = await lookUp(client);
    const calls = client.calls;
    expect(c.classification).toBe("known_object");
    expect(c.label_plain).toBe("Known asteroid");
    expect(c.known_object).toMatchObject({
      checked: true,
      matched: true,
      catalogs_checked: ["JPL SBIdent", "JPL Horizons"],
      search_radius_arcsec: MATCH_RADIUS_ARCSEC,
      designation: "99999 Testobject (2001 AA1)",
      enrichment: "cached",
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
    const { c } = await lookUp(makeClient({ files, upstream: jpl(60) }));
    expect(c.classification).toBe("unmatched");
    expect(c.known_object.checked).toBe(true);
    expect(c.known_object.matched).toBe(false);
    expect(c.known_object.nearest.designation).toBe("99999 Testobject (2001 AA1)");
    expect(c.known_object.nearest.separation_arcsec).toBeCloseTo(60, 0);
    expect(c.summary_plain).toContain("does not match any known object");
    expect(c.explanation.numeric_check).toBe("passed");
    expect(c.error_sources.find((e: { id: string }) => e.id === "catalog_gap").status).toBe("unknown");
  });

  it("never calls a candidate unmatched when Horizons could not refine a nearby object", async () => {
    const sbOnly: FetchHandler = (url, init) =>
      url.hostname === "ssd.jpl.nasa.gov" ? new Response("busy", { status: 503 }) : jpl(2)(url, init);
    const { c } = await lookUp(makeClient({ files, upstream: sbOnly }));
    expect(c.known_object.checked).toBe(false);
    expect(c.known_object.not_checked_reason).toContain("JPL Horizons did not answer");
    expect(c.summary_plain).not.toContain("does not match any known object");
  });

  it("returns the report with checked=false when JPL is down, and retries later", async () => {
    const kv = new MemoryKv();
    const { res, c } = await lookUp(makeClient({ files, kv, upstream: () => new Response("down", { status: 503 }) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(c.classification).toBe("unmatched");
    expect(c.known_object.checked).toBe(false);
    expect(c.known_object.catalogs_checked).toEqual([]);
    expect(c.known_object.not_checked_reason).toContain("503");
    expect(c.summary_plain).toContain("couldn't be reached; the check is retried automatically");
    // The failure is stored with an expiry so it is retried, never kept forever.
    const failed = [...kv.store.entries()].find(([k]) => k.startsWith("enrich:"))!;
    expect(failed[1].ttl).toBeGreaterThan(0);
  });

  it("serves later requests from the global store without calling JPL", async () => {
    const kv = new MemoryKv();
    await lookUp(makeClient({ files, kv, upstream: jpl(2) }));
    const b = makeClient({ files, kv });
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

  it("the cron refreshes missing results within the subrequest budget", async () => {
    const client = makeClient({ files, upstream: jpl(2) });
    const report = await refreshStale(client.env, { ...client.deps, budget: { remaining: 40 } });
    expect(report).toMatchObject({ considered: 2, stale: 2, skipped_for_budget: 0 });
    expect(report.refreshed).toContain(base.candidate_id);
    const c = await json(await client.get(`/api/candidates/${base.candidate_id}`));
    expect(c.known_object.checked).toBe(true);
    // A second run finds nothing stale.
    const again = await refreshStale(client.env, { ...client.deps, budget: { remaining: 40 } });
    expect(again.stale).toBe(0);
  });

  it("the cron leaves candidates for the next run when the budget runs out", async () => {
    const client = makeClient({ files, upstream: jpl(2) });
    const report = await refreshStale(client.env, { ...client.deps, budget: { remaining: 5 } });
    expect(report.refreshed).toEqual([]);
    expect(report.skipped_for_budget).toBe(2);
  });

  it("404s unknown candidates", async () => {
    const { get } = makeClient({ files });
    expect((await get("/api/candidates/test-missing")).status).toBe(404);
  });
});

describe("JPL results from the survey pipeline (spherex-px triage)", () => {
  const knownByPipeline = {
    ...base.known_object,
    checked: true,
    matched: true,
    designation: "433 Eros (A898 PA)",
    catalogs_checked: ["JPL SBIdent" as const, "JPL Horizons" as const],
    query_utc: "2026-11-03T00:00:00Z",
    enrichment: "pipeline" as const,
    jpl_links: {
      sbdb_url: "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=433",
      horizons_url: "https://ssd.jpl.nasa.gov/horizons/app.html#/?sstr=433",
    },
  };
  const known = candidate({
    candidate_id: "test-cand-known",
    classification: "known_object",
    known_object: knownByPipeline,
    record_level: "minimal",
  });
  const unexplained = candidate({ candidate_id: "test-cand-new" });
  const pfiles = {
    "/data/candidates.json": list([known, unexplained]),
    [`/data/candidates/${known.candidate_id}.json`]: known,
    [`/data/candidates/${unexplained.candidate_id}.json`]: unexplained,
  };

  it("serves a pipeline match as final, without asking JPL", async () => {
    const client = makeClient({ files: pfiles, upstream: jpl(2) });
    const res = await client.get(`/api/candidates/${known.candidate_id}`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const c = await json(res);
    expect(c.classification).toBe("known_object");
    expect(c.known_object).toMatchObject({ matched: true, enrichment: "pipeline" });
    expect(c.known_object.jpl_links.sbdb_url).toContain("sbdb_lookup");
    await client.settle();
    expect(client.calls).toHaveLength(0);
  });

  it("lists unexplained first and never refreshes pipeline matches in the cron", async () => {
    const client = makeClient({ files: pfiles, upstream: jpl(2), kv: new MemoryKv() });
    const l = await json(await client.get("/api/candidates"));
    expect(l.candidates.map((x: { candidate_id: string }) => x.candidate_id)).toEqual([
      unexplained.candidate_id,
      known.candidate_id,
    ]);
    await client.settle();
    const report = await refreshStale(client.env, { ...client.deps, budget: { remaining: 40 } });
    expect(report.refreshed).not.toContain(known.candidate_id);
    expect(report.considered).toBe(1);
  });
});
