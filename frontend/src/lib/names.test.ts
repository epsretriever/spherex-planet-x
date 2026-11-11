import { describe, expect, it } from "vitest";
import type { CandidateSummary, FieldSummary } from "./contract";
import { buildNames, letterFor, toNameInput, toNameSeed, type NameInput } from "./names";

const fields = [
  { field_id: "aqr-a", center: { ra_deg: 346.53, dec_deg: -6.38 } },
  { field_id: "aqr-b", center: { ra_deg: 346.72, dec_deg: -5.45 } },
  { field_id: "ori", center: { ra_deg: 83.6, dec_deg: -5.4 } },
];
const c = (id: string, field_id: string, first: string, extra: Partial<NameInput> = {}): NameInput => ({
  candidate_id: id,
  field_id,
  classification: "unmatched",
  first_time_utc: first,
  known_object_designation: null,
  ...extra,
});

describe("letterFor", () => {
  it("counts A..Z then AA", () => {
    expect([0, 1, 25, 26, 27, 701, 702].map(letterFor)).toEqual(["A", "B", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
});

describe("buildNames", () => {
  it("letters objects across fields in the same constellation by first sighting", () => {
    const names = buildNames(
      [c("aqr-b-c01", "aqr-b", "2025-06-02T00:00:00Z"), c("aqr-a-c01", "aqr-a", "2025-06-03T00:00:00Z"), c("ori-c01", "ori", "2025-01-01T00:00:00Z")],
      fields,
    );
    expect(names.get("aqr-b-c01")?.title).toBe("Moving object A in Aquarius");
    expect(names.get("aqr-a-c01")?.title).toBe("Moving object B in Aquarius");
    expect(names.get("ori-c01")?.title).toBe("Moving object A in Orion");
    expect(names.get("aqr-a-c01")?.id).toBe("aqr-a-c01");
  });

  it("uses the JPL designation for matched objects without shifting other letters", () => {
    const names = buildNames(
      [
        c("k", "aqr-a", "2025-06-01T00:00:00Z", { classification: "known_object", known_object_designation: "2524 Budovicium (1981 QB1)" }),
        c("u", "aqr-a", "2025-06-02T00:00:00Z"),
      ],
      fields,
    );
    expect(names.get("k")?.title).toBe("2524 Budovicium (1981 QB1)");
    expect(names.get("u")?.title).toBe("Moving object B in Aquarius");
  });

  it("letters simulated objects separately", () => {
    const names = buildNames(
      [c("sim", "aqr-a", "2025-01-01T00:00:00Z", { classification: "injected" }), c("real", "aqr-a", "2025-06-01T00:00:00Z")],
      fields,
    );
    expect(names.get("sim")?.title).toBe("Simulated object A in Aquarius");
    expect(names.get("real")?.title).toBe("Moving object A in Aquarius");
  });

  it("drops the constellation when the field is unknown", () => {
    expect(buildNames([c("x", "nowhere", "2025-01-01T00:00:00Z")], fields).get("x")?.title).toBe("Moving object A");
  });
});

describe("toNameSeed", () => {
  const full = (n: NameInput): CandidateSummary =>
    ({ ...n, label_plain: "x".repeat(200), summary_plain: "y".repeat(500), thumbnail_url: "/t.png", detection_count: 9 }) as unknown as CandidateSummary;
  const cands = [c("a1", "aqr-a", "2025-01-02"), c("a2", "aqr-b", "2025-01-01"), c("o1", "ori", "2025-01-03", { classification: "injected" })];
  const fullFields = fields.map((f) => ({ ...f, name: "long name", tile_count: 3, notes_plain: "z".repeat(300) })) as unknown as FieldSummary[];

  it("keeps only what buildNames reads", () => {
    const seed = toNameSeed(cands.map(full), fullFields);
    expect(Object.keys(seed.candidates[0]!).sort()).toEqual(Object.keys(toNameInput(full(cands[0]!))).sort());
    expect(Object.keys(seed.fields[0]!).sort()).toEqual(["center", "field_id"]);
    expect(JSON.stringify(seed)).not.toContain("yyyy");
  });

  it("gives the same names as the full lists", () => {
    const seed = toNameSeed(cands.map(full), fullFields);
    expect([...buildNames(seed.candidates, seed.fields)]).toEqual([...buildNames(cands.map(full).map(toNameInput), fullFields)]);
  });
});
