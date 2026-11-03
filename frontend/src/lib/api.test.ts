import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateList, CandidateSummary } from "./contract";
import { DataError, assetUrl, filterCandidates, findInjectionStudyId, getField, getFields } from "./api";

const summary = (id: string, classification: CandidateSummary["classification"], overall: number, field = "f1"): CandidateSummary => ({
  candidate_id: id,
  field_id: field,
  classification,
  label_plain: "",
  summary_plain: "",
  thumbnail_url: "",
  detection_count: 3,
  time_span_hours: 1,
  first_time_utc: "2025-01-01T00:00:00Z",
  rate_arcsec_per_hr: 1,
  position_angle_deg: 0,
  mean_snr: 5,
  overall_score: overall,
  quality_level: "medium",
  known_object_matched: false,
  known_object_designation: null,
});

describe("filterCandidates", () => {
  const list: CandidateList = {
    pipeline_version: "t",
    generated_utc: "",
    total: 4,
    candidates: [summary("a", "unmatched", 0.5), summary("b", "known_object", 0.9), summary("c", "injected", 0.8), summary("d", "unmatched", 0.2, "f2")],
  };

  it("hides injected candidates unless asked", () => {
    expect(filterCandidates(list, {}).candidates.map((c) => c.candidate_id)).toEqual(["a", "b", "d"]);
    expect(filterCandidates(list, { include_injected: true }).total).toBe(4);
    expect(filterCandidates(list, { classification: ["injected"] }).candidates.map((c) => c.candidate_id)).toEqual(["c"]);
  });

  it("filters by field, classification and minimum score", () => {
    expect(filterCandidates(list, { field_id: "f2" }).candidates.map((c) => c.candidate_id)).toEqual(["d"]);
    expect(filterCandidates(list, { classification: ["unmatched"], min_score: 0.3 }).candidates.map((c) => c.candidate_id)).toEqual(["a"]);
  });
});

describe("assetUrl", () => {
  it("keeps API-relative URLs on this origin", () => {
    expect(assetUrl("/static/x.webp")).toBe("/static/x.webp");
    expect(assetUrl("static/x.webp")).toBe("/static/x.webp");
    expect(assetUrl("https://cdn.example/x.webp")).toBe("https://cdn.example/x.webp");
    expect(assetUrl(null)).toBe("");
  });
});

describe("fetchers", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const respond = (status: number, body: unknown) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("fetches relative /api URLs", async () => {
    respond(200, { pipeline_version: "t", generated_utc: "", fields: [] });
    await getFields();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/fields");
  });

  it("maps HTTP failures to friendly error reasons", async () => {
    respond(404, { detail: "nope" });
    await expect(getField("x")).rejects.toMatchObject({ reason: "not_found" });
    respond(503, { detail: "down" });
    await expect(getFields()).rejects.toMatchObject({ reason: "unavailable" });
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    await expect(getFields()).rejects.toBeInstanceOf(DataError);
  });

  it("rejects responses that are missing required arrays", async () => {
    respond(200, { pipeline_version: "t" });
    await expect(getFields()).rejects.toMatchObject({ reason: "invalid" });
  });

  it("treats a field with another ID as not found", async () => {
    respond(200, { field_id: "other", epochs: [], pipeline_version: "t" });
    await expect(getField("x")).rejects.toMatchObject({ reason: "not_found" });
  });

  it("finds the newest injection study from the index", async () => {
    respond(200, {
      pipeline_version: "t",
      studies: [
        { study_id: "old", generated_utc: "2026-01-01T00:00:00Z", field_ids: [], n_injected: 1 },
        { study_id: "new", generated_utc: "2026-11-01T00:00:00Z", field_ids: [], n_injected: 1 },
      ],
    });
    await expect(findInjectionStudyId()).resolves.toBe("new");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/injection");
  });

  it("reports no study when neither the index nor injected candidates exist", async () => {
    respond(404, { detail: "missing" });
    respond(200, { pipeline_version: "t", generated_utc: "", total: 0, candidates: [] });
    await expect(findInjectionStudyId()).rejects.toMatchObject({ reason: "not_found" });
  });
});
