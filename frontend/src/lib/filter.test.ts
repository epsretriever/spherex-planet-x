import { describe, expect, it } from "vitest";
import type { CandidateSummary } from "./contract";
import { EMPTY_FILTER, applyFilter, filterChips, filterFromParams, filterToParams, normalizeFilter } from "./filter";

const c = (id: string, over: Partial<CandidateSummary>): CandidateSummary => ({
  candidate_id: id,
  field_id: "f1",
  classification: "unmatched",
  label_plain: "",
  summary_plain: "",
  thumbnail_url: "",
  detection_count: 3,
  time_span_hours: 5,
  first_time_utc: "2025-06-01T00:00:00Z",
  rate_arcsec_per_hr: 10,
  position_angle_deg: null,
  mean_snr: 8,
  overall_score: 0.5,
  quality_level: "medium",
  known_object_matched: false,
  known_object_designation: null,
  ...over,
});

const LIST = [
  c("a", { overall_score: 0.9, rate_arcsec_per_hr: 40, first_time_utc: "2025-06-01T00:00:00Z" }),
  c("b", { classification: "known_object", overall_score: 0.7, rate_arcsec_per_hr: 5, field_id: "f2", first_time_utc: "2025-06-03T00:00:00Z" }),
  c("c", { classification: "injected", overall_score: 0.8, rate_arcsec_per_hr: 2 }),
  c("d", { overall_score: 0.2, rate_arcsec_per_hr: null, first_time_utc: "2025-06-02T00:00:00Z" }),
];

describe("URL round trip", () => {
  it("reads and writes every part", () => {
    const f = {
      ...EMPTY_FILTER,
      classification: ["unmatched" as const],
      rate_min_arcsec_per_hr: 1,
      rate_max_arcsec_per_hr: 20,
      distance_class: ["tno" as const],
      field_id: ["f1", "f2"],
      min_score: 0.3,
      include_injected: true,
      sort: "newest" as const,
    };
    const p = filterToParams(f, new URLSearchParams("keep=1"));
    expect(p.get("keep")).toBe("1");
    expect(filterFromParams(p)).toEqual(f);
  });

  it("ignores junk and keeps old links working", () => {
    const f = filterFromParams(new URLSearchParams("class=bogus&class=unmatched&min=abc&rmin=-3&dist=moon&sort=x&field=aquarius-a"));
    expect(f).toEqual({ ...EMPTY_FILTER, classification: ["unmatched"], field_id: ["aquarius-a"] });
  });

  it("leaves the defaults out of the URL", () => {
    expect(filterToParams(EMPTY_FILTER).toString()).toBe("");
  });
});

describe("normalizeFilter", () => {
  it("cleans an AI filter", () => {
    const f = normalizeFilter({
      classification: ["unmatched", "planet" as never, "unmatched"],
      rate_min_arcsec_per_hr: 30,
      rate_max_arcsec_per_hr: 2,
      min_score: 4,
      sort: "weird" as never,
    });
    expect(f.classification).toEqual(["unmatched"]);
    expect([f.rate_min_arcsec_per_hr, f.rate_max_arcsec_per_hr]).toEqual([2, 30]);
    expect(f.min_score).toBe(1);
    expect(f.sort).toBe("score");
    expect(normalizeFilter(null)).toEqual(EMPTY_FILTER);
  });
});

describe("applyFilter", () => {
  const ids = (xs: CandidateSummary[]) => xs.map((x) => x.candidate_id);

  // Unexplained first whatever the sort, then known objects, then simulated ones.
  it("hides SIMULATED objects unless asked, and sorts by score", () => {
    expect(ids(applyFilter(LIST, EMPTY_FILTER))).toEqual(["a", "d", "b"]);
    expect(ids(applyFilter(LIST, { ...EMPTY_FILTER, include_injected: true }))).toEqual(["a", "d", "b", "c"]);
  });

  it("keeps SIMULATED objects alongside a type filter when included", () => {
    expect(ids(applyFilter(LIST, { ...EMPTY_FILTER, classification: ["known_object"], include_injected: true }))).toEqual(["b", "c"]);
  });

  it("filters by speed, excluding unmeasured speeds", () => {
    expect(ids(applyFilter(LIST, { ...EMPTY_FILTER, rate_max_arcsec_per_hr: 10 }))).toEqual(["b"]);
    expect(ids(applyFilter(LIST, { ...EMPTY_FILTER, rate_min_arcsec_per_hr: 10 }))).toEqual(["a"]);
  });

  it("filters by field, score and distance", () => {
    expect(ids(applyFilter(LIST, { ...EMPTY_FILTER, field_id: ["f2"] }))).toEqual(["b"]);
    expect(ids(applyFilter(LIST, { ...EMPTY_FILTER, min_score: 0.6 }))).toEqual(["a", "b"]);
    const dist = (id: string) => (id === "b" ? ("main_belt" as const) : undefined);
    expect(ids(applyFilter(LIST, { ...EMPTY_FILTER, distance_class: ["main_belt"] }, dist))).toEqual(["b"]);
    expect(ids(applyFilter(LIST, { ...EMPTY_FILTER, distance_class: ["unknown"] }, dist))).toEqual(["a", "d"]);
  });

  it("sorts by speed and date", () => {
    expect(ids(applyFilter(LIST, { ...EMPTY_FILTER, sort: "rate" }))).toEqual(["a", "d", "b"]);
    expect(ids(applyFilter(LIST, { ...EMPTY_FILTER, sort: "newest" }))).toEqual(["d", "a", "b"]);
    expect(ids(applyFilter(LIST, { ...EMPTY_FILTER, sort: "unusual" }))).toEqual(["a", "d", "b"]);
    const scored = LIST.map((c) => ({ ...c, anomaly_score: c.candidate_id === "d" ? 0.9 : c.candidate_id === "b" ? 0.4 : null }));
    expect(ids(applyFilter(scored, { ...EMPTY_FILTER, sort: "unusual" }))).toEqual(["d", "a", "b"]);
  });
});

describe("filterChips", () => {
  it("gives one removable chip per part", () => {
    const f = { ...EMPTY_FILTER, classification: ["unmatched" as const], rate_max_arcsec_per_hr: 5, field_id: ["f1"], sort: "unusual" as const };
    const chips = filterChips(f, (id) => `Field ${id}`);
    expect(chips.map((x) => x.label)).toEqual(["Unexplained", "Slower than 5″/hr", "In Field f1", "Most unusual: not ranked yet, sorted by score"]);
    expect(chips[1]!.without.rate_max_arcsec_per_hr).toBeNull();
    expect(chips[0]!.without.classification).toEqual([]);
  });

  it("names the unusual sort once anomaly scores exist", () => {
    expect(filterChips({ ...EMPTY_FILTER, sort: "unusual" }, undefined, true).map((x) => x.label)).toEqual(["Sorted: most unusual"]);
  });

  it("is empty for the default filter", () => {
    expect(filterChips(EMPTY_FILTER)).toEqual([]);
  });
});
