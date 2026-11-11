import { describe, expect, it } from "vitest";
import type { CandidateDetail, ObjectDetail, ObjectList } from "../src/contract";
import { candidate, horizonsBody, list, sbidentBody } from "./factory";
import { type FetchHandler, MemoryKv, json, makeClient } from "./helpers";

const base = candidate();

function objectOf(c: CandidateDetail): ObjectDetail {
  return {
    schema_version: "1.1",
    pipeline_version: c.pipeline_version,
    object_id: `obj-${c.candidate_id}`,
    classification: c.classification,
    label_plain: c.label_plain,
    summary_plain: c.summary_plain,
    thumbnail_url: c.thumbnail_url,
    field_ids: [c.field_id],
    candidate_ids: [c.candidate_id],
    detections: c.detections.map((d) => ({ ...d, field_id: c.field_id, candidate_id: c.candidate_id })),
    motion: c.motion,
    distance_class: "unknown",
    orbit_status: "none",
    orbit: null,
    known_object: c.known_object,
    scores: c.scores,
    explanation: null,
    spectrum: null,
    history: [],
    provenance: c.provenance,
    disclaimer: c.disclaimer,
  };
}

const obj = objectOf(base);
const objList: ObjectList = {
  schema_version: "1.1",
  pipeline_version: base.pipeline_version,
  generated_utc: "2026-10-30T00:00:00Z",
  total: 1,
  objects: [
    {
      object_id: obj.object_id,
      classification: obj.classification,
      label_plain: obj.label_plain,
      summary_plain: obj.summary_plain,
      thumbnail_url: obj.thumbnail_url,
      field_ids: obj.field_ids,
      candidate_ids: obj.candidate_ids,
      n_detections: 3,
      n_visits: 3,
      first_time_utc: base.detections[0]!.time_utc,
      last_time_utc: base.detections[2]!.time_utc,
      arc_hours: 24,
      rate_arcsec_per_hr: 3,
      distance_class: "unknown",
      distance_au_estimate: null,
      orbit_status: "none",
      overall_score: 0.73,
      quality_level: "high",
      known_object_checked: false,
      known_object_matched: false,
      known_object_designation: null,
    },
  ],
};
const field = {
  schema_version: "1.0",
  pipeline_version: base.pipeline_version,
  field_id: "test-field",
  epochs: [],
  movers: [
    { candidate_id: base.candidate_id, classification: "unmatched", label_plain: "Unexplained", quality_level: "high", rate_arcsec_per_hr: 3, track: [] },
  ],
};
const survey = { schema_version: "1.1", pipeline_version: "test", tiles: [], totals: { n_tiles: 0 } };

const files = {
  "/data/candidates.json": list([base]),
  [`/data/candidates/${base.candidate_id}.json`]: base,
  "/data/objects.json": objList,
  [`/data/objects/${obj.object_id}.json`]: obj,
  "/data/fields/test-field.json": field,
  "/data/survey.json": survey,
};

const jpl: FetchHandler = (url) => {
  if (url.hostname === "ssd-api.jpl.nasa.gov") {
    const t = url.searchParams.get("obs-time")!;
    const d = base.detections.find((x) => x.time_utc.startsWith(t.replace("_", "T")))!;
    return Response.json(sbidentBody("99999 Testobject (2001 AA1)", d.ra_deg, d.dec_deg));
  }
  const jds = url.searchParams.get("TLIST")!.split(" ").map((s) => Number(s.replace(/'/g, "")));
  return Response.json(
    horizonsBody(jds.map((jd, i) => ({ jd, ra: base.detections[i]!.ra_deg, dec: base.detections[i]!.dec_deg, delta: 1.5 }))),
  );
};

describe("objects", () => {
  it("answers an object at once with a pending check, then with JPL's match", async () => {
    const client = makeClient({ files, upstream: jpl, kv: new MemoryKv() });
    const first = await json(await client.get(`/api/objects/${obj.object_id}`));
    expect(first.known_object.enrichment).toBe("pending");
    expect(first.summary_plain).toContain("being checked now");
    await client.settle();
    const o = await json(await client.get(`/api/objects/${obj.object_id}`));
    expect(o.classification).toBe("known_object");
    expect(o.label_plain).toBe("Known asteroid");
    expect(o.known_object.designation).toBe("99999 Testobject (2001 AA1)");
    expect(o.explanation.numeric_check).toBe("passed");
  });

  it("folds stored results into the object list, summary included", async () => {
    const kv = new MemoryKv();
    const a = makeClient({ files, upstream: jpl, kv });
    await a.get(`/api/objects/${obj.object_id}`);
    await a.settle();
    const b = makeClient({ files, kv });
    const body = await json(await b.get("/api/objects"));
    expect(b.calls).toHaveLength(0);
    expect(body.objects[0]).toMatchObject({
      classification: "known_object",
      known_object_matched: true,
      known_object_designation: "99999 Testobject (2001 AA1)",
    });
    expect(body.objects[0].summary_plain).toContain("matches the known asteroid");
  });

  it("has no prediction before an orbit exists", async () => {
    const { get } = makeClient({ files });
    const p = await get(`/api/objects/${obj.object_id}/prediction`);
    expect(p.status).toBe(404);
    expect((await json(p)).detail).toContain("no orbit yet");
    expect((await get("/api/objects/obj-missing")).status).toBe(404);
  });

  it("serves the survey", async () => {
    const { get } = makeClient({ files });
    expect(await json(await get("/api/survey"))).toEqual({ ...survey, totals: { ...survey.totals, n_known_objects: 0 } });
  });

  it("adds the published Planet Nine region to the survey", async () => {
    const region = {
      citation: "Brown & Batygin 2021, AJ 162, 219: Planet Nine reference population (CaltechDATA)",
      url: "https://data.caltech.edu/records/8fjad-x7y61",
      epoch_utc: "2018-06-01T12:00:00Z",
      cell_deg: 5,
      population: "Synthetic Planet Nine orbits not detectable by the ZTF, DES or Pan-STARRS searches",
      n_population: 100000,
      n_remaining: 2,
      cells: [{ ra_deg: 12.5, dec_deg: -12.5, fraction: 1 }],
    };
    const { get } = makeClient({ files: { ...files, "/data/survey/planet_nine.json": region } });
    const body = (await json(await get("/api/survey"))) as { planet_nine: unknown };
    expect(body.planet_nine).toEqual(region);
  });
});

describe("JPL results stay consistent across endpoints", () => {
  it("the candidate list updates summary_plain, and field movers update their label", async () => {
    const kv = new MemoryKv();
    const a = makeClient({ files, upstream: jpl, kv });
    await a.get(`/api/candidates/${base.candidate_id}`);
    await a.settle();
    const b = makeClient({ files, kv });
    const listed = (await json(await b.get("/api/candidates"))).candidates[0];
    expect(listed.classification).toBe("known_object");
    expect(listed.summary_plain).toContain("matches the known asteroid");
    expect(listed.summary_plain).not.toContain("Not yet checked");
    const f = await json(await b.get("/api/fields/test-field"));
    expect(f.movers[0]).toMatchObject({ classification: "known_object", label_plain: "Known asteroid" });
    expect(b.calls).toHaveLength(0);
  });
});

describe("most unusual first", () => {
  it("sorts by anomaly rank and rejects unknown sorts", async () => {
    const row = (id: string, rank: number | null) => ({ ...objList.objects[0]!, object_id: id, anomaly_rank: rank, known_object_matched: false });
    const files = { "/data/objects.json": { ...objList, objects: [row("obj-a", 3), row("obj-b", null), row("obj-c", 1)] } };
    const { get } = makeClient({ files });
    const r = (await json(await get("/api/objects?sort=anomaly"))) as ObjectList;
    expect(r.objects.map((o) => o.object_id)).toEqual(["obj-c", "obj-a", "obj-b"]);
    expect((await get("/api/objects?sort=weird")).status).toBe(400);
  });
});
