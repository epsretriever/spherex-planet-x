import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adesXml, idsFromDesignation, mjdToIso, observationsOf, trkSubFor } from "../src/ades";
import type { ObjectDetail } from "../src/contract";
import { makeClient } from "./helpers";

// A real published object (recorded from the live API).
const obj = JSON.parse(readFileSync(new URL("../../shared/fixtures/object_detail.json", import.meta.url), "utf8")) as ObjectDetail;

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
    expect(kept.length).toBeGreaterThan(0);
    expect(obs).toHaveLength(kept.length);
    obs.forEach((o, i) => {
      const d = kept[i]!;
      expect(Number(tag(o, "ra"))).toBeCloseTo(d.ra_deg, 6);
      expect(Number(tag(o, "dec"))).toBeCloseTo(d.dec_deg, 6);
      expect(tag(o, "obsTime")).toBe(mjdToIso(d.mjd));
      expect(Number(tag(o, "pos1"))).toBeCloseTo(d.spacecraft_geocentric_km[0]!, 2);
      expect(tag(o, "sys")).toBe("ICRF_KM");
      expect(tag(o, "trkSub")).toBe(trkSubFor(obj.object_id));
      expect(tag(o, "stn")).toBe("XXX");
    });
    expect(wellFormed(xml)).toBe(true);
    expect(xml).toContain("DRAFT for review; not submitted");
    expect(xml).toContain("not valid for submission");
    // The integrity rule: an export never claims anything about the object.
    expect(xml).not.toMatch(/\b(new|discover(y|ed|ies)?)\b/i);
  });

  it("keeps the brightest of simultaneous detectors", () => {
    const d = obj.detections[0]!;
    const kept = observationsOf([d, { ...d, snr: d.snr + 5, mjd: d.mjd + 0.1 / 86400 }]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.snr).toBe(d.snr + 5);
  });

  it("uses the configured station code and the JPL designation of a known object", () => {
    const known: ObjectDetail = {
      ...obj,
      classification: "known_object",
      known_object: { ...obj.known_object, checked: true, matched: true, designation: "101 Helena (A868 PA)" },
    };
    const xml = adesXml(known, { stationCode: "C99", submitter: "A. Person & co <x>", generatedUtc: "2026-11-02T00:00:00Z" });
    expect(tag(optical(xml)[0]!, "stn")).toBe("C99");
    expect(tag(optical(xml)[0]!, "permID")).toBe("101");
    expect(xml).not.toContain("not valid for submission");
    expect(xml).toContain("A. Person &amp; co &lt;x&gt;");
    expect(wellFormed(xml)).toBe(true);
  });

  it("parses JPL designations and makes a stable temporary one", () => {
    expect(idsFromDesignation("101 Helena (A868 PA)")).toEqual({ permID: "101" });
    expect(idsFromDesignation("40724 (1999 SY8)")).toEqual({ permID: "40724", provID: "1999 SY8" });
    expect(idsFromDesignation("(2025 OJ736)")).toEqual({ provID: "2025 OJ736" });
    expect(idsFromDesignation("C/2023 A3 (Tsuchinshan-ATLAS)")).toEqual({});
    expect(idsFromDesignation(null)).toEqual({});
    expect(trkSubFor("obj-x")).toMatch(/^SP[0-9A-Z]{5}$/);
    expect(trkSubFor("obj-x")).toBe(trkSubFor("obj-x"));
  });

  it("never exports an injected object", () => {
    expect(() => adesXml({ ...obj, classification: "injected" }, { generatedUtc: "2026-11-02T00:00:00Z" })).toThrow();
  });

  it("is served as XML, and not for injected, empty or unknown objects", async () => {
    const injected = { ...obj, object_id: "obj-inj-c01", classification: "injected" as const };
    const empty = { ...obj, object_id: "obj-empty-c01", detections: [] };
    const c = makeClient({
      files: {
        [`/data/objects/${obj.object_id}.json`]: obj,
        "/data/objects/obj-inj-c01.json": injected,
        "/data/objects/obj-empty-c01.json": empty,
      },
    });
    const r = await c.get(`/api/objects/${obj.object_id}/ades.xml`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/xml");
    expect(r.headers.get("x-ades-status")).toContain("station code not configured");
    expect(await r.text()).toContain('<ades version="2022">');
    expect((await c.get("/api/objects/obj-inj-c01/ades.xml")).status).toBe(404);
    expect((await c.get("/api/objects/obj-empty-c01/ades.xml")).status).toBe(404);
    expect((await c.get("/api/objects/obj-missing/ades.xml")).status).toBe(404);
  });
});
