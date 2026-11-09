import { describe, expect, it } from "vitest";
import type { CandidateDetail, ObjectDetail, ObjectList, OrbitalElements } from "../src/contract";
import { helioDistance, horizonsElementsUrl, parseHorizonsElements } from "../src/orbit-compare";
import { candidate, horizonsBody, list, sbidentBody } from "./factory";
import { type FetchHandler, MemoryKv, json, makeClient } from "./helpers";

/** A Horizons ELEMENTS CSV table (columns JDTDB, date, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR). */
const elementsBody = (a: number, e: number, i: number, ma: number) => ({
  result: [
    "*******************************************************************************",
    " JDTDB, Calendar Date (TDB), EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR,",
    "$$SOE",
    `2460829.500000000, A.D. 2025-Jun-03 00:00:00.0000,  ${e.toExponential(16)},  ${(a * (1 - e)).toExponential(16)},  ${i.toExponential(16)},  2.833218645416519E+02,  1.762440009131339E+02,  2460500.123456789,  2.334E-01,  ${ma.toExponential(16)},  2.2E+02,  ${a.toExponential(16)},  ${(a * (1 + e)).toExponential(16)},  1.5E+03,`,
    "$$EOE",
  ].join("\n"),
});

describe("Horizons elements", () => {
  it("asks for heliocentric J2000 ecliptic elements at our epoch (TDB)", () => {
    const u = new URL(horizonsElementsUrl("2524 Budovicium (1981 QB1)", 60829.0));
    expect(u.searchParams.get("COMMAND")).toBe("'2524;'");
    expect(u.searchParams.get("EPHEM_TYPE")).toBe("ELEMENTS");
    expect(u.searchParams.get("CENTER")).toBe("'500@10'");
    expect(u.searchParams.get("REF_PLANE")).toBe("ECLIPTIC");
    expect(u.searchParams.get("TIME_TYPE")).toBe("TDB");
    expect(u.searchParams.get("TLIST")).toBe("'2460829.500000'");
  });

  it("parses the elements row and computes the distance from the Sun", () => {
    const el = parseHorizonsElements(elementsBody(2.33, 0.08, 4.1, 0))!;
    expect(el).toMatchObject({ a_au: 2.33, e: 0.08, i_deg: 4.1, mean_anomaly_deg: 0 });
    expect(helioDistance(el)).toBeCloseTo(2.33 * 0.92, 10); // perihelion
    expect(helioDistance({ ...el, mean_anomaly_deg: 180 })).toBeCloseTo(2.33 * 1.08, 10); // aphelion
    expect(parseHorizonsElements({ result: "No ephemeris for target" })).toBeNull();
  });
});

describe("our orbit versus JPL's", () => {
  const cand: CandidateDetail = candidate();
  const orbit: OrbitalElements = {
    epoch_mjd: 60000.0008,
    a_au: 2.5,
    e: 0.05,
    i_deg: 4.0,
    node_deg: 283,
    peri_deg: 176,
    mean_anomaly_deg: 10,
    q_au: 2.375,
    method: "ranging",
    rms_arcsec: 0.7,
    n_detections: 3,
    arc_hours: 24,
    covariance: null,
    n_clones: 100,
    clones_url: "/data/objects/obj-test-cand-1/clones.json",
    jpl_comparison: null,
    helio_distance_au: { best: 2.4, lo: 2.1, hi: 2.8 },
    n_ranging_orbits: 300,
    reported_orbit: "most circular",
    check_30d: {
      time_utc: "2023-03-27T00:00:00Z",
      mjd: 60030,
      ra_deg: 10.02,
      dec_deg: 1.0,
      sigma_major_arcsec: 400,
      sigma_minor_arcsec: 50,
      sigma_pa_deg: 70,
      vmag_estimate: null,
    },
  };
  const obj = {
    ...cand,
    schema_version: "1.1",
    object_id: "obj-test-cand-1",
    field_ids: [cand.field_id],
    candidate_ids: [cand.candidate_id],
    detections: cand.detections.map((d) => ({ ...d, field_id: cand.field_id, candidate_id: cand.candidate_id })),
    distance_class: "main_belt",
    orbit_status: "preliminary",
    orbit,
    history: [],
  } as unknown as ObjectDetail;
  const objList = { schema_version: "1.1", pipeline_version: "test", generated_utc: "x", total: 1, objects: [
      {
        object_id: obj.object_id,
        classification: "unmatched",
        label_plain: "Unexplained",
        summary_plain: "x",
        thumbnail_url: "/t.webp",
        field_ids: [cand.field_id],
        candidate_ids: [cand.candidate_id],
        n_detections: 3,
        n_visits: 3,
        first_time_utc: cand.detections[0]!.time_utc,
        last_time_utc: cand.detections[2]!.time_utc,
        arc_hours: 24,
        rate_arcsec_per_hr: 3,
        distance_class: "main_belt",
        distance_au_estimate: null,
        orbit_status: "preliminary",
        overall_score: 0.73,
        quality_level: "high",
        known_object_checked: false,
        known_object_matched: false,
        known_object_designation: null,
      },
    ] } as unknown as ObjectList;
  const files = {
    "/data/candidates.json": list([cand]),
    [`/data/candidates/${cand.candidate_id}.json`]: cand,
    [`/data/objects/${obj.object_id}.json`]: obj,
    "/data/objects.json": objList,
  };
  const calls: string[] = [];
  const jpl: FetchHandler = (url) => {
    calls.push(url.searchParams.get("EPHEM_TYPE") ?? "SBIDENT");
    if (url.hostname === "ssd-api.jpl.nasa.gov") {
      const t = url.searchParams.get("obs-time")!;
      const d = cand.detections.find((x) => x.time_utc.startsWith(t.replace("_", "T")))!;
      return Response.json(sbidentBody("2524 Budovicium (1981 QB1)", d.ra_deg, d.dec_deg));
    }
    if (url.searchParams.get("EPHEM_TYPE") === "ELEMENTS") return Response.json(elementsBody(2.33, 0.08, 4.1, 0));
    const jds = url.searchParams.get("TLIST")!.split(" ").map((s) => Number(s.replace(/'/g, "")));
    if (jds.length === 1 && Math.abs(jds[0]! - 2460030.5) < 1e-3) {
      // JPL's position at our 30-day check point: 0.05 degrees from our prediction.
      return Response.json(horizonsBody([{ jd: jds[0]!, ra: 10.07, dec: 1.0, delta: 1.5 }]));
    }
    return Response.json(
      horizonsBody(jds.map((jd, i) => ({ jd, ra: cand.detections[i]!.ra_deg, dec: cand.detections[i]!.dec_deg, delta: 1.5 }))),
    );
  };

  it("compares when JPL identifies the object, and summarizes all comparisons", async () => {
    const kv = new MemoryKv();
    const a = makeClient({ files, upstream: jpl, kv });
    await a.get(`/api/objects/${obj.object_id}`);
    await a.settle();
    expect(calls).toContain("ELEMENTS");
    const b = makeClient({ files, kv });
    const o = (await json(await b.get(`/api/objects/${obj.object_id}`))) as ObjectDetail;
    const cmp = o.orbit!.jpl_comparison!;
    expect(cmp).toMatchObject({
      designation: "2524 Budovicium (1981 QB1)",
      delta_a_au: 0.17,
      delta_e: -0.03,
      delta_i_deg: -0.1,
      jpl_a_au: 2.33,
      jpl_helio_distance_au: 2.1436,
      distance_in_interval: true,
      inside_3sigma_30d: true,
    });
    expect(cmp.position_error_arcsec_30d).toBeCloseTo(180, 0);
    const v = await json(await b.get("/api/validation/jpl-orbits"));
    expect(v).toMatchObject({ n_identified: 1, n_compared: 1, distance_in_interval: 1, inside_3sigma_30d: 1, delta_a_au_abs_median: 0.17 });
    expect(v.rows[0].object_id).toBe(obj.object_id);
    expect(b.calls).toHaveLength(0);
  });

  it("serves the simulated-asteroid validation and rejects unknown names", async () => {
    const doc = { schema_version: "1.1", simulated: true, rows: [] };
    const { get } = makeClient({ files: { "/data/validation/orbits.json": doc } });
    expect(await json(await get("/api/validation/orbits"))).toEqual(doc);
    expect((await get("/api/validation/secrets")).status).toBe(404);
  });

  it("serves the linking validation, and 404 before it has been run", async () => {
    const doc = { schema_version: "1.1", n_tracks: 15, n_eligible: 6, rows: [] };
    const { get } = makeClient({ files: { "/data/validation/linking.json": doc } });
    const r = await get("/api/validation/linking");
    expect(await json(r)).toEqual(doc);
    expect(r.headers.get("cache-control")).toContain("max-age");
    expect((await makeClient().get("/api/validation/linking")).status).toBe(404);
  });
});
