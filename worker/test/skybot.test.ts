import { describe, expect, it } from "vitest";
import type { CandidateDetail, KnownObject } from "../src/contract";
import { crossCheckProgress, knownFromSummary, readSkybotResults, withCrossChecks, writeSkybotResult } from "../src/crosscheck";
import { notCheckedKnownObject } from "../src/enrich";
import { AU_KM, separationArcsec, topocentric } from "../src/jpl";
import { CALLS_PER_CANDIDATE, MAX_CROSS_CHECK_CALLS, refreshStale } from "../src/scheduled";
import { type CatalogResult, type SkybotObject, decideSkybot, identKeys, parseSkybot, sameObject, skybotSeparation, skybotUrl } from "../src/skybot";
import { SUBREQUEST_BUDGET } from "../src/env";
import { buildExplanation } from "../src/text";
import { sqliteD1 } from "./d1";
import { candidate, detection, list } from "./factory";
import { json, makeClient } from "./helpers";

/** The row SkyBoT returned for (764) Gedania on 2025-08-15 (recorded from the live service). */
const GEDANIA = {
  Num: 764,
  Name: "Gedania",
  "RA (hms)": "16 13 32.8525",
  "DEC (dms)": "-20 34 45.134",
  Class: "MB>Outer",
  "VMag (mag)": 15.7,
  "Err (arcsec)": 0.03,
  "d (arcsec)": 0.613,
  "dg (ua)": 2.61,
};

const NOW = "2026-10-29T12:00:00.000Z";
const jplMatch = (designation: string): KnownObject => ({
  ...notCheckedKnownObject(""),
  checked: true,
  not_checked_reason: null,
  matched: true,
  catalogs_checked: ["JPL SBIdent", "JPL Horizons"],
  designation,
  per_epoch: [{ epoch_id: "e1", predicted_ra_deg: 10, predicted_dec_deg: 1, separation_arcsec: 1.2 }],
  query_utc: "2026-10-01T00:00:00Z",
  enrichment: "pipeline",
});
const sky = (over: Partial<CatalogResult>): CatalogResult => ({
  outcome: "match",
  designation: "764 Gedania",
  separation_arcsec: 0.6,
  vmag: 15.7,
  n_visits: 3,
  checked_utc: NOW,
  detail: null,
  ...over,
});

describe("SkyBoT request and parser", () => {
  it("builds a geocentric JSON cone search", () => {
    const q = new URL(skybotUrl("2025-08-15T06:13:59.871Z", 243.386885, -20.5792041)).searchParams;
    expect(q.get("-ep")).toBe("2025-08-15T06:13:59.871Z");
    expect(q.get("-ra")).toBe("243.386885");
    expect(q.get("-dec")).toBe("-20.5792041");
    expect(q.get("-rs")).toBe("120");
    expect(q.get("-mime")).toBe("json");
    expect(q.get("-observer")).toBe("500");
    expect(q.get("-objFilter")).toBe("111");
    expect(q.get("-from")).toBe("Driftnet");
  });

  it("parses rows, an empty field and a non-answer", () => {
    const [o] = parseSkybot(JSON.stringify([GEDANIA]))!;
    expect(o!.designation).toBe("764 Gedania");
    expect(o!.ra_deg).toBeCloseTo(243.38689, 4);
    expect(o!.dec_deg).toBeCloseTo(-20.57920, 4);
    expect(o!.dg_au).toBe(2.61);
    expect(o!.vmag).toBe(15.7);
    expect(parseSkybot("[]")).toEqual([]);
    expect(parseSkybot("")).toEqual([]); // HTTP 204: nothing in the cone
    expect(parseSkybot("No solar system object was found in the requested FOV")).toEqual([]);
    expect(parseSkybot("<html>error</html>")).toBeNull();
    expect(parseSkybot(JSON.stringify([{ Num: "", Name: "2019 AB12", "RA (hms)": "1 0 0", "DEC (dms)": "+1 0 0" }]))![0]!.designation).toBe("2019 AB12");
  });

  it("compares designations across JPL's and SkyBoT's naming", () => {
    expect(sameObject("764 Gedania (A913 SF)", "764 Gedania")).toBe(true);
    expect(sameObject("(2019 AB12)", "2019 AB12")).toBe(true);
    expect(sameObject("123456 (2001 AB12)", "2001 AB12")).toBe(true);
    expect(sameObject("764 Gedania (A913 SF)", "765 Mattiaca")).toBe(false);
    expect(sameObject("2019 AB12", "2019 AB13")).toBe(false);
    expect([...identKeys("2019 AB12")]).toEqual(["d:2019 ab12"]); // a year is not an asteroid number
  });
});

describe("SkyBoT matching", () => {
  // A nearby object (0.05 au) seen from a spacecraft 7,000 km from Earth's center: the geocentric
  // position is about 190″ from where SPHEREx sees it.
  const sc = [0, 7000, 0];
  const geo = { ra_deg: 10, dec_deg: 1 };
  const seen = topocentric(geo.ra_deg, geo.dec_deg, 0.05, sc);
  const det = (i: number, mjd: number) => ({ ...detection(i, seen.ra_deg, seen.dec_deg, mjd), spacecraft_geocentric_km: sc });
  const obj = (over: Partial<SkybotObject> = {}): SkybotObject => ({ designation: "99942 Apophis", ...geo, dg_au: 0.05, vmag: 16, ...over });

  it("applies the parallax correction before the 15″ test", () => {
    expect(separationArcsec(seen.ra_deg, seen.dec_deg, geo.ra_deg, geo.dec_deg)).toBeGreaterThan(100);
    expect((7000 / (0.05 * AU_KM)) * 206265).toBeGreaterThan(100);
    expect(skybotSeparation(det(1, 60000), obj())).toBeLessThan(0.01);
    const r = decideSkybot([{ d: det(1, 60000), objects: [obj()] }, { d: det(2, 60000.5), objects: [obj()] }], NOW);
    expect(r).toMatchObject({ outcome: "match", designation: "99942 Apophis", n_visits: 2 });
    // Without a distance the uncorrected position is used, and it is too far away.
    expect(decideSkybot([{ d: det(1, 60000), objects: [obj({ dg_au: null })] }], NOW).outcome).toBe("none");
  });

  it("needs the same object at every answered visit, and enough answers", () => {
    const d1 = det(1, 60000);
    const d2 = det(2, 60000.5);
    expect(decideSkybot([{ d: d1, objects: [obj()] }, { d: d2, objects: [] }], NOW).outcome).toBe("none");
    expect(decideSkybot([{ d: d1, objects: [obj()] }, { d: d2, objects: null }], NOW).outcome).toBe("failed");
    expect(decideSkybot([{ d: d1, objects: [obj()] }, { d: d2, objects: [obj()] }, { d: det(3, 60001), objects: null }], NOW)).toMatchObject({
      outcome: "match",
      n_visits: 2,
    });
  });
});

describe("combining JPL and SkyBoT", () => {
  it("counts two agreeing catalogs", () => {
    const { known_object: k, matched } = withCrossChecks(jplMatch("764 Gedania (A913 SF)"), sky({}));
    expect(matched).toBe(true);
    expect(k.cross_checks!.map((c) => [c.catalog, c.status])).toEqual([["JPL", "agrees"], ["IMCCE SkyBoT", "agrees"]]);
    expect(k).toMatchObject({ agreeing_catalogs: 2, checked_catalogs: 2, catalogs_disagree: false, designation: "764 Gedania (A913 SF)" });
    expect(k.catalogs_checked).toEqual(["JPL SBIdent", "JPL Horizons", "IMCCE SkyBoT"]);
  });

  it("stores and surfaces a disagreement", () => {
    const other = withCrossChecks(jplMatch("764 Gedania (A913 SF)"), sky({ designation: "765 Mattiaca" })).known_object;
    expect(other.cross_checks![1]).toMatchObject({ status: "different_object", designation: "765 Mattiaca" });
    expect(other).toMatchObject({ matched: true, agreeing_catalogs: 1, checked_catalogs: 2, catalogs_disagree: true });
    const c = candidate({ classification: "known_object", known_object: other });
    const text = buildExplanation(c, NOW);
    expect(text.text).toContain("Catalogs disagree: IMCCE SkyBoT identifies it as 765 Mattiaca instead.");
    expect(text.numeric_check).toBe("passed");
    const none = withCrossChecks(jplMatch("764 Gedania (A913 SF)"), sky({ outcome: "none", designation: null, separation_arcsec: null })).known_object;
    expect(none).toMatchObject({ matched: true, agreeing_catalogs: 1, catalogs_disagree: true });
    expect(none.cross_checks![1]!.status).toBe("nothing_found");
  });

  it("identifies a candidate JPL never answered for, and keeps unanswered catalogs honest", () => {
    const unanswered: KnownObject = { ...notCheckedKnownObject("JPL SBIdent did not answer for 3 of 3 visits (timeout)."), query_utc: NOW, enrichment: "cached" };
    const { known_object: k, matched } = withCrossChecks(unanswered, sky({}));
    expect(matched).toBe(true);
    expect(k).toMatchObject({ checked: true, designation: "764 Gedania", catalogs_checked: ["IMCCE SkyBoT"], agreeing_catalogs: 1, checked_catalogs: 1, catalogs_disagree: false });
    expect(k.cross_checks![0]!.status).toBe("failed");
    const text = buildExplanation(candidate({ classification: "known_object", known_object: k }), NOW);
    expect(text.text).toContain("IMCCE SkyBoT's prediction for 764 Gedania");
    expect(text.numeric_check).toBe("passed");
    // SkyBoT answered "nothing": checked, still unexplained. SkyBoT silent: nothing changes.
    expect(withCrossChecks(unanswered, sky({ outcome: "none", designation: null })).known_object).toMatchObject({ checked: true, matched: false, agreeing_catalogs: 0 });
    const silent = withCrossChecks(unanswered, sky({ outcome: "failed", designation: null })).known_object;
    expect(silent).toMatchObject({ checked: false, catalogs_checked: [], checked_catalogs: 0 });
    expect(withCrossChecks(unanswered, null).known_object.cross_checks![1]!.status).toBe("not_checked_yet");
  });

  it("reports progress from stored results", () => {
    const a = withCrossChecks(jplMatch("764 Gedania"), sky({})).known_object;
    const b = withCrossChecks(jplMatch("1 Ceres"), null).known_object;
    const c = withCrossChecks(jplMatch("2 Pallas"), sky({ outcome: "none", designation: null })).known_object;
    const p = crossCheckProgress([a, b, c], [sky({}), null, sky({ outcome: "none" })], new Date(NOW));
    expect(p).toMatchObject({ known_total: 3, cross_checked: 2, agreeing_2plus: 1, disagreements: 1 });
    expect(Date.parse(p.next_full_pass_estimate_utc!)).toBeGreaterThan(Date.parse(NOW));
  });
});

describe("cron rotation", () => {
  const known = (id: string): CandidateDetail =>
    candidate({ candidate_id: id, classification: "known_object", known_object: jplMatch("764 Gedania (A913 SF)") });
  const unexplained = (id: string): CandidateDetail =>
    candidate({ candidate_id: id, known_object: { ...jplMatch(""), matched: false, designation: null, per_epoch: [] } });

  it("caps SkyBoT calls per run and leaves room for a JPL lookup", async () => {
    expect(MAX_CROSS_CHECK_CALLS + CALLS_PER_CANDIDATE).toBeLessThanOrEqual(SUBREQUEST_BUDGET);
    const cands = [...Array.from({ length: 8 }, (_, i) => known(`known-${i}`)), ...Array.from({ length: 8 }, (_, i) => unexplained(`unx-${i}`))];
    const files: Record<string, unknown> = { "/data/candidates.json": list(cands) };
    for (const c of cands) files[`/data/candidates/${c.candidate_id}.json`] = c;
    const { d1 } = await sqliteD1();
    const { env, deps, calls } = makeClient({
      files,
      db: d1,
      kv: null,
      upstream: (url) => (url.hostname === "ssp.imcce.fr" ? Response.json([]) : new Response("down", { status: 503 })),
    });
    const report = await refreshStale(env, { ...deps, budget: { remaining: SUBREQUEST_BUDGET } });
    const skybotCalls = calls.filter((u) => u.includes("ssp.imcce.fr"));
    expect(skybotCalls.length).toBeLessThanOrEqual(MAX_CROSS_CHECK_CALLS);
    expect(report.cross_checked.filter((id) => id.startsWith("known-"))).toHaveLength(2);
    expect(report.cross_checked.filter((id) => id.startsWith("unx-"))).toHaveLength(3);
    expect(report.cross_checks_due).toBe(16);
    expect(calls.length).toBeLessThanOrEqual(SUBREQUEST_BUDGET);
    // The next run moves on to candidates not checked yet.
    const again = await refreshStale(env, { ...deps, budget: { remaining: SUBREQUEST_BUDGET } });
    expect(again.cross_checked.some((id) => report.cross_checked.includes(id))).toBe(false);
    expect(again.cross_checks_due).toBe(11);
    expect((await readSkybotResults(deps)).size).toBe(10);
  });

  it("serves stored cross-checks on lists and details without new lookups", async () => {
    const c = known("known-0");
    const { d1 } = await sqliteD1();
    const { get, deps, calls } = makeClient({
      files: { "/data/candidates.json": list([c]), "/data/candidates/known-0.json": c },
      db: d1,
      kv: null,
    });
    await writeSkybotResult(deps, "known-0", sky({}), null);
    // A failed retry keeps the stored answer.
    await writeSkybotResult(deps, "known-0", sky({ outcome: "failed", designation: null }), sky({}));
    const row = (await json(await get("/api/candidates"))).candidates[0];
    expect(row.known_object_catalogs_agreeing).toEqual(["JPL", "IMCCE SkyBoT"]);
    expect(row.known_object_catalogs_disagree).toBe(false);
    const detail = await json(await get("/api/candidates/known-0"));
    expect(detail.known_object).toMatchObject({ agreeing_catalogs: 2, checked_catalogs: 2, catalogs_disagree: false });
    expect(detail.summary_plain).toContain("JPL and IMCCE SkyBoT both give this identification.");
    expect(calls).toHaveLength(0);
    expect(knownFromSummary(row).matched).toBe(true);
  });
});
