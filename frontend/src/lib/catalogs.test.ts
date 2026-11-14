import { describe, expect, it } from "vitest";
import type { CrossCheck, KnownObject } from "./contract";
import { agreeingCount, catalogChips, catalogVerdict, crossCheckRows, crossCheckTotals, ssoCardName } from "./catalogs";

const known = (over: Partial<KnownObject> = {}): KnownObject => ({
  checked: true,
  matched: true,
  catalogs_checked: ["JPL SBIdent", "JPL Horizons"],
  search_radius_arcsec: 15,
  designation: "433 Eros (A898 PA)",
  query_utc: "2026-11-01T00:00:00Z",
  per_epoch: [
    { epoch_id: "a", predicted_ra_deg: 1, predicted_dec_deg: 2, separation_arcsec: 1.2 },
    { epoch_id: "b", predicted_ra_deg: 1, predicted_dec_deg: 2, separation_arcsec: 3.4 },
  ],
  ...over,
});
const sky = (over: Partial<CrossCheck> = {}): CrossCheck => ({
  catalog: "IMCCE SkyBoT",
  status: "agrees",
  designation: "Eros",
  separation_arcsec: 2.1,
  checked_utc: "2026-11-02T00:00:00Z",
  ...over,
});
const verdictOf = (k: KnownObject) => catalogVerdict(crossCheckRows(k)!, k.designation);

describe("catalog chips", () => {
  it("counts each catalog once, JPL first", () => {
    expect(catalogChips(["IMCCE SkyBoT", "JPL Horizons", "JPL SBIdent"])).toEqual(["JPL", "SkyBoT"]);
    expect(agreeingCount(["JPL SBIdent", "JPL Horizons"])).toBe(1);
  });
  it("has nothing to say when the data doesn't list catalogs", () => {
    expect(catalogChips(undefined)).toEqual([]);
    expect(agreeingCount(undefined)).toBeNull();
  });
  it("keeps the name of a catalog it doesn't know", () => {
    expect(catalogChips(["Some Catalog"])).toEqual(["Some Catalog"]);
  });
});

describe("cross-check rows", () => {
  it("has none for data without cross-checks", () => {
    expect(crossCheckRows(known())).toBeNull();
    expect(crossCheckRows(known({ cross_checks: [] }))).toBeNull();
  });
  it("adds JPL's own row when the list leaves it out", () => {
    const rows = crossCheckRows(known({ cross_checks: [sky()] }))!;
    expect(rows.map((r) => [r.short, r.status])).toEqual([
      ["JPL", "agrees"],
      ["SkyBoT", "agrees"],
    ]);
    expect(rows[0]!.separation_arcsec).toBe(3.4);
    expect(rows[0]!.link?.href).toContain("sbdb_lookup.html#/?sstr=433");
    expect(rows[1]!.link?.href).toBe("https://ssp.imcce.fr/forms/ssocard/Eros");
  });
  it("uses the list's JPL row when it has one, and links only rows that name an object", () => {
    const rows = crossCheckRows(known({ cross_checks: [sky({ status: "nothing_found", designation: null }), { catalog: "JPL SBIdent", status: "agrees" }] }))!;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.designation).toBe("433 Eros (A898 PA)");
    expect(rows[1]!.link).toBeNull();
  });
  it("builds ssoCard names", () => {
    expect(ssoCardName("433 Eros (A898 PA)")).toBe("Eros");
    expect(ssoCardName("(2019 AB12)")).toBe("2019_AB12");
  });
});

describe("catalog verdict", () => {
  it("confirms only with two independent catalogs", () => {
    const v = verdictOf(known({ cross_checks: [sky()] }));
    expect(v.kind).toBe("confirmed");
    expect(v.headline).toBe("Confirmed by 2 independent catalogs");
  });
  it("says so when only JPL has answered", () => {
    for (const status of ["not_checked_yet", "failed"] as const) {
      const v = verdictOf(known({ cross_checks: [sky({ status, designation: null })] }));
      expect(v.kind).toBe("single_waiting");
      expect(v.headline).toBe("Only JPL has answered so far: re-checking");
    }
  });
  it("reports a disagreement, naming both objects", () => {
    const v = verdictOf(known({ cross_checks: [sky({ status: "different_object", designation: "Vesta" })] }));
    expect(v.headline).toBe("Catalogs disagree");
    expect(v.detail).toContain("SkyBoT places Vesta here");
    expect(v.tone).toBe("warn");
  });
  it("does not call a single catalog confirmation when another found nothing", () => {
    const v = verdictOf(known({ cross_checks: [sky({ status: "nothing_found", designation: null })] }));
    expect(v.kind).toBe("single_alone");
  });
  it("never implies a discovery when no catalog matches", () => {
    const v = verdictOf(known({ matched: false, designation: null, cross_checks: [sky({ status: "nothing_found", designation: null })] }));
    expect(v.kind).toBe("none_found");
    expect(v.detail).toContain("does not make it new");
  });
});

describe("cross-check totals", () => {
  it("passes complete totals and hides incomplete or impossible ones", () => {
    expect(crossCheckTotals({ known_total: 374, cross_checked: 300, agreeing_2plus: 210, disagreements: 2 })?.agreeing_2plus).toBe(210);
    expect(crossCheckTotals(undefined)).toBeNull();
    expect(crossCheckTotals({ known_total: 374 } as never)).toBeNull();
    expect(crossCheckTotals({ known_total: 10, cross_checked: 10, agreeing_2plus: 11, disagreements: 0 })).toBeNull();
  });
});
