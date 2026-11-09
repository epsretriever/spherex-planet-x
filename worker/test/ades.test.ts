import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adesXml, idsFromDesignation, mjdToIso, observationsOf, trkSubFor } from "../src/ades";
import type { ObjectDetail, ObjectList, ObjectSummary } from "../src/contract";
import { makeClient } from "./helpers";

// A real published object (recorded from the live API).
const obj = JSON.parse(readFileSync(new URL("../../shared/fixtures/object_detail.json", import.meta.url), "utf8")) as ObjectDetail;
const summary = (o: ObjectDetail, status: ObjectSummary["reporting_status"]): ObjectSummary =>
  ({
    object_id: o.object_id,
    classification: o.classification,
    label_plain: o.label_plain,
    summary_plain: o.summary_plain,
    thumbnail_url: o.thumbnail_url,
    field_ids: o.field_ids,
    candidate_ids: o.candidate_ids,
    n_detections: o.detections.length,
    n_visits: 3,
    first_time_utc: o.detections[0]!.time_utc,
    last_time_utc: o.detections.at(-1)!.time_utc,
    arc_hours: 20,
    rate_arcsec_per_hr: o.motion.rate_arcsec_per_hr,
    distance_class: o.distance_class,
    distance_au_estimate: null,
    orbit_status: o.orbit_status,
    overall_score: o.scores.overall,
    quality_level: o.scores.quality_level,
    known_object_checked: false,
    known_object_matched: false,
    known_object_designation: null,
    reporting_status: status,
    reporting_measurements_passed: status !== "not_ready",
  }) as ObjectSummary;

/** Every element closed in order (a minimal check; the export uses no attributes but on <ades>). */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9]*)[^>]*>/g)) {
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]!);
  }
  return stack.length === 0;
}
const optical = (xml: string) => [...xml.matchAll(/<optical>(.*?)<\/optical>/g)].map((m) => m[1]!);
const tag = (s: string, t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(s)?.[1];

describe("ADES export", () => {
  it("writes one observation per exposure time, from the measured positions", () => {
    const xml = adesXml(obj, { generatedUtc: "2026-11-02T00:00:00Z" });
    const obs = optical(xml);
    const kept = observationsOf(obj.detections);
    expect(obs).toHaveLength(kept.length);
    expect(kept.length).toBe(new Set(obj.detections.map((d) => Math.round(d.mjd * 86400))).size);
    obs.forEach((o, i) => {
      const d = kept[i]!;
      expect(Number(tag(o, "ra"))).toBeCloseTo(d.ra_deg, 6);
      expect(Number(tag(o, "dec"))).toBeCloseTo(d.dec_deg, 6);
      expect(tag(o, "obsTime")).toBe(mjdToIso(d.mjd));
      expect(Number(tag(o, "pos1"))).toBeCloseTo(d.spacecraft_geocentric_km[0], 2);
      expect(tag(o, "sys")).toBe("ICRF_KM");
      expect(tag(o, "trkSub")).toBe(trkSubFor(obj.object_id));
      expect(tag(o, "stn")).toBe("XXX");
    });
    // well formed: every opened element is closed
    expect(wellFormed(xml)).toBe(true);
    expect(xml).toContain("DRAFT for team review; not submitted.");
    expect(xml).toContain("not valid for submission");
  });

  it("keeps the brightest of simultaneous detectors", () => {
    const d = obj.detections[0]!;
    const kept = observationsOf([d, { ...d, snr: d.snr + 5, band_index: (d.band_index ?? 0) + 1, mjd: d.mjd + 0.1 / 86400 }]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.snr).toBe(d.snr + 5);
  });

  it("uses the configured station code and the JPL designation of a known object", () => {
    const known: ObjectDetail = {
      ...obj,
      classification: "known_object",
      known_object: { ...obj.known_object, checked: true, matched: true, designation: "101 Helena (A868 PA)" },
    };
    const xml = adesXml(known, { stationCode: "C99", submitter: "A. Person", generatedUtc: "2026-11-02T00:00:00Z" });
    expect(tag(optical(xml)[0]!, "stn")).toBe("C99");
    expect(tag(optical(xml)[0]!, "permID")).toBe("101");
    expect(xml).not.toContain("not valid for submission");
  });

  it("parses JPL designations", () => {
    expect(idsFromDesignation("101 Helena (A868 PA)")).toEqual({ permID: "101" });
    expect(idsFromDesignation("40724 (1999 SY8)")).toEqual({ permID: "40724", provID: "1999 SY8" });
    expect(idsFromDesignation("(2025 OJ736)")).toEqual({ provID: "2025 OJ736" });
    expect(idsFromDesignation("C/2023 A3 (Tsuchinshan-ATLAS)")).toEqual({});
    expect(idsFromDesignation(null)).toEqual({});
    expect(trkSubFor("obj-x")).toMatch(/^SPX[0-9A-Z]{5}$/);
  });

  it("is served as XML and never for injected objects", async () => {
    const injected = { ...obj, object_id: "obj-inj-c01", classification: "injected" as const };
    const c = makeClient({
      files: { [`/data/objects/${obj.object_id}.json`]: obj, "/data/objects/obj-inj-c01.json": injected },
    });
    const r = await c.get(`/api/objects/${obj.object_id}/ades.xml`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/xml");
    expect(r.headers.get("x-ades-status")).toContain("station code not configured");
    expect(await r.text()).toContain('<ades version="2022">');
    expect((await c.get("/api/objects/obj-inj-c01/ades.xml")).status).toBe(404);
    expect((await c.get("/api/objects/obj-missing/ades.xml")).status).toBe(404);
  });
});

describe("candidates for reporting list", () => {
  const list = (objects: ObjectSummary[]): ObjectList =>
    ({ schema_version: "1.1", pipeline_version: "test", generated_utc: "2026-11-02T00:00:00Z", total: objects.length, objects }) as ObjectList;
  const a = summary({ ...obj, object_id: "obj-a" }, "ready");
  const b = summary({ ...obj, object_id: "obj-b" }, "incomplete");
  const n = summary({ ...obj, object_id: "obj-n" }, "not_ready");

  it("lists only ready objects, with counts and how submission works", async () => {
    const c = makeClient({ files: { "/data/objects.json": list([a, b, n]) } });
    const body = (await (await c.get("/api/reporting")).json()) as Record<string, unknown>;
    expect(body.counts).toEqual({ ready: 1, incomplete: 1, not_ready: 1, not_evaluated: 0 });
    expect((body.objects as ObjectSummary[]).map((o) => o.object_id)).toEqual(["obj-a"]);
    expect(body.ades_urls).toEqual({ "obj-a": "/api/objects/obj-a/ades.xml" });
    expect(body.submission).toMatchObject({ automatic: false, station_code_configured: false });
  });

  it("filters the object list by reporting_status", async () => {
    const c = makeClient({ files: { "/data/objects.json": list([a, b, n]) } });
    const r = (await (await c.get("/api/objects?reporting_status=ready&reporting_status=incomplete")).json()) as ObjectList;
    expect(r.objects.map((o) => o.object_id)).toEqual(["obj-a", "obj-b"]);
    expect((await c.get("/api/objects?reporting_status=new")).status).toBe(400);
  });
});
