import { describe, expect, it } from "vitest";
import type { KnownObject } from "./contract";
import { jplLinks, jplSearchString } from "./jpl";

const known = (over: Partial<KnownObject>): KnownObject => ({
  checked: true,
  matched: true,
  catalogs_checked: ["JPL SBIdent"],
  search_radius_arcsec: 15,
  designation: "433 Eros (A898 PA)",
  ...over,
});

describe("JPL links", () => {
  it("searches JPL by number, or by provisional designation", () => {
    expect(jplSearchString("433 Eros (A898 PA)")).toBe("433");
    expect(jplSearchString("(2019 AB12)")).toBe("2019 AB12");
    expect(jplSearchString("2019 AB12")).toBe("2019 AB12");
  });

  it("uses the pipeline's links, builds them for Worker matches, and has none when unmatched", () => {
    const given = { sbdb_url: "https://ssd.jpl.nasa.gov/x", horizons_url: "https://ssd.jpl.nasa.gov/y" };
    expect(jplLinks(known({ jpl_links: given }))).toEqual(given);
    expect(jplLinks(known({}))?.sbdb_url).toBe("https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=433");
    expect(jplLinks(known({ designation: "(2019 AB12)" }))?.horizons_url).toContain("sstr=2019%20AB12");
    expect(jplLinks(known({ matched: false }))).toBeNull();
  });
});
