import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CandidateDetail, ObjectSummary } from "./contract";
import { buildLead, confidence, countVisits, formatDec, formatRa, rankLeads, whyNot, whyReal } from "./leads";

const strong = { n_visits: 4, min_snr: 30, fit_rms_arcsec: 0.5, checks: [{ label: "a", passed: true }], real_bogus: null };

describe("confidence", () => {
  it("scores a well-measured multi-visit object as a strong lead, rescaled without the classifier", () => {
    const c = confidence(strong);
    expect(c.score).toBe(100);
    expect(c.level).toBe("strong");
    expect(c.parts.map((p) => p.key)).toEqual(["visits", "snr", "fit", "artifacts"]);
  });
  it("counts the classifier when it has scored the object", () => {
    const c = confidence({ ...strong, real_bogus: 0 });
    expect(c.parts.at(-1)!.key).toBe("real_bogus");
    expect(c.score).toBe(85);
  });
  it("marks two weak visits with a loose fit and a failed check as weak", () => {
    const c = confidence({ n_visits: 2, min_snr: 5, fit_rms_arcsec: 5, checks: [{ label: "a", passed: false }, { label: "b", passed: true }], real_bogus: null });
    expect(c.level).toBe("weak");
  });
});

describe("helpers", () => {
  it("groups detections an hour or more apart into visits", () => {
    expect(countVisits(["2025-01-01T00:00:00Z", "2025-01-01T00:05:00Z", "2025-01-01T03:00:00Z"])).toBe(2);
  });
  it("formats sexagesimal coordinates", () => {
    expect(formatRa(243.386885)).toBe("16h 13m 32.9s");
    expect(formatDec(-20.5792041)).toBe("−20° 34′ 45″");
  });
});

describe("buildLead on published data", () => {
  const dir = path.join(process.cwd(), "public", "data");
  const objects = JSON.parse(readFileSync(path.join(dir, "objects.json"), "utf8")) as { objects: ObjectSummary[] };
  const obj = objects.objects.find((o) => o.classification === "unmatched")!;
  const cand = JSON.parse(readFileSync(path.join(dir, "candidates", `${obj.candidate_ids[0]}.json`), "utf8")) as CandidateDetail;
  const lead = buildLead(obj, cand, "Test", null, null);
  it("takes its numbers from the report", () => {
    expect(lead.n_detections).toBe(cand.detections.length);
    expect(lead.min_snr).toBe(Math.min(...cand.detections.map((d) => d.snr)));
    expect(lead.checks.length).toBeGreaterThan(0);
  });
  it("always says unexplained is not new", () => {
    expect(whyNot(lead).some((t) => t.startsWith("Unexplained is not new"))).toBe(true);
    expect(whyReal(lead).join(" ")).not.toMatch(/discover/i);
  });
  it("ranks by score", () => {
    const r = rankLeads([lead, { ...lead, object_id: "z", n_visits: 1 }]);
    expect(r[0]!.confidence.score).toBeGreaterThanOrEqual(r[1]!.confidence.score);
  });
});

describe("JPL notes", () => {
  it("drops request URLs from pipeline errors", async () => {
    const { cleanReason } = await import("./leads");
    const r = cleanReason("JPL SBIdent did not answer for 3 of 3 visits (GET https://ssd-api.jpl.nasa.gov/sb_ident.api?x=1 failed -> HTTP 429).");
    expect(r).not.toMatch(/https?:/);
    expect(r).toMatch(/limiting/);
  });
});
