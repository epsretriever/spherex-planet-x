import { describe, expect, it } from "vitest";
import {
  decToSbident,
  horizonsCommand,
  horizonsUrl,
  parseDec,
  parseHorizons,
  parseRa,
  parseSbident,
  raToSbident,
  sbidentUrl,
  separationArcsec,
  timeToSbident,
  topocentric,
} from "../src/jpl";

describe("SBIdent request formatting", () => {
  it("formats RA, Dec and time the way SBIdent expects", () => {
    expect(raToSbident(346.52934)).toBe("23-06-07.04");
    expect(decToSbident(-6.38387)).toBe("M06-23-01.9");
    expect(decToSbident(12.5)).toBe("12-30-00.0");
    expect(timeToSbident("2025-06-02T00:05:20.481")).toBe("2025-06-02_00:05:20");
  });

  it("queries from SPHEREx's position, never the geocenter SBIdent rejects", () => {
    const u = new URL(sbidentUrl("2025-06-02T00:05:20Z", 10, -1, [6657.254, -2238.913, -211.369]));
    expect(u.origin + u.pathname).toBe("https://ssd-api.jpl.nasa.gov/sb_ident.api");
    expect(u.searchParams.get("xobs")).toBe("6657.254,-2238.913,-211.369");
    expect(u.searchParams.has("mpc-code")).toBe(false);
    expect(u.searchParams.get("two-pass")).toBe("false");
    expect(u.searchParams.get("fov-ra-hwidth")).toBe("0.1");
  });

  it("falls back to a surface point when no spacecraft position is known", () => {
    for (const xobs of [undefined, null, [0, 0, 0] as const]) {
      const u = new URL(sbidentUrl("2025-06-02T00:05:20Z", 10, -1, xobs));
      expect(u.searchParams.get("lat")).toBe("0");
      expect(u.searchParams.get("lon")).toBe("0");
      expect(u.searchParams.has("xobs")).toBe(false);
      expect(u.searchParams.has("mpc-code")).toBe(false);
    }
  });
});

describe("SBIdent response parsing", () => {
  // Shape of an SBIdent second-pass response (fields_second + data_second_pass).
  const body = {
    fields_second: [
      "Object name",
      "Astrometric RA (hh:mm:ss)",
      "Astrometric Dec (dd mm'ss\")",
      "Dist. from center RA (\")",
      "Dist. from center Dec (\")",
      "Dist. from center Norm (\")",
      "Visual magnitude (V)",
      "RA rate (\"/h)",
      "Dec rate (\"/h)",
    ],
    data_second_pass: [["99999 Testobject (2001 AA1)", "23:06:07.04", "-06 23'01.9\"", "1", "1", "1.4", "16.2", "40", "14"]],
  };

  it("finds columns by name and converts sexagesimal", () => {
    const [o] = parseSbident(body);
    expect(o!.name).toBe("99999 Testobject (2001 AA1)");
    expect(o!.ra_deg).toBeCloseTo(346.52933, 4);
    expect(o!.dec_deg).toBeCloseTo(-6.38386, 4);
    expect(o!.vmag).toBe(16.2);
  });

  it("returns nothing for empty or unexpected bodies", () => {
    expect(parseSbident({ n_second_pass: 0 })).toEqual([]);
    expect(parseSbident(null)).toEqual([]);
  });

  it("parses common angle spellings", () => {
    expect(parseRa("01 00 00")).toBeCloseTo(15, 6);
    expect(parseDec("+10:30:00")).toBeCloseTo(10.5, 6);
    expect(parseDec("M10-30-00")).toBeCloseTo(-10.5, 6);
    expect(parseDec(-3.5)).toBe(-3.5);
  });
});

describe("Horizons", () => {
  it("maps SBIdent names to Horizons commands", () => {
    expect(horizonsCommand("433 Eros (A898 PA)")).toBe("'433;'");
    expect(horizonsCommand("2019 AB12")).toBe("'DES=2019 AB12;'");
    expect(horizonsCommand("(2019 AB12)")).toBe("'DES=2019 AB12;'");
    expect(horizonsCommand("1036 Ganymed (A924 UB)")).toBe("'1036;'");
    expect(horizonsCommand("C/2020 F3 (NEOWISE)")).toBe("'DES=C/2020 F3;'");
  });

  it("requests every epoch in one call", () => {
    const u = new URL(horizonsUrl("433 Eros", [60828.0, 60829.5]));
    expect(u.searchParams.get("TLIST")).toBe("'2460828.500000' '2460830.000000'");
    expect(u.searchParams.get("CENTER")).toBe("'500@399'");
  });

  it("parses the CSV ephemeris block", () => {
    const result = [
      "header",
      "$$SOE",
      " 2460828.500000000, , , 346.5293400, -6.3838700, 1.23456789012345, -10.1234567,",
      " 2460830.000000000, , , 346.6591200, -6.3381400, 1.24000000000000, -10.0000000,",
      "$$EOE",
    ].join("\n");
    const pts = parseHorizons({ result });
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ jd: 2460828.5, ra_deg: 346.52934, dec_deg: -6.38387, delta_au: 1.23456789012345 });
  });
});

describe("geometry", () => {
  it("parallax from a 7000 km offset is about 8 arcsec at 1.2 AU", () => {
    const geo = { ra: 346.5, dec: -6.4 };
    const t = topocentric(geo.ra, geo.dec, 1.2, [-5800, 1600, 3600]);
    const sep = separationArcsec(geo.ra, geo.dec, t.ra_deg, t.dec_deg);
    expect(sep).toBeGreaterThan(1);
    expect(sep).toBeLessThan(9);
  });

  it("separation of identical points is zero", () => {
    expect(separationArcsec(10, 10, 10, 10)).toBe(0);
  });
});

describe("SBIdent sampling per visit", () => {
  it("queries one exposure per visit and caps the total", async () => {
    const { sbidentSample, MAX_SBIDENT_QUERIES } = await import("../src/enrich");
    const h = 1 / 24;
    // 4 visits of 4 exposures each, 2 minutes apart, visits ~10 hours apart (like real SPHEREx data).
    const dets = [0, 10, 20, 30].flatMap((v) => [0, 1, 2, 3].map((k) => ({ mjd: 60829 + v * h + (k * 2) / 1440 })));
    const s = sbidentSample(dets);
    expect(s).toHaveLength(4);
    expect(new Set(s.map((d) => Math.round((d.mjd - 60829) / h / 10)))).toEqual(new Set([0, 1, 2, 3]));
    // Many visits are capped, keeping the first and last.
    const many = Array.from({ length: 20 }, (_, i) => ({ mjd: 60829 + i * 5 * h }));
    const c = sbidentSample(many);
    expect(c).toHaveLength(MAX_SBIDENT_QUERIES);
    expect(c[0]).toBe(many[0]);
    expect(c.at(-1)).toBe(many.at(-1));
  });
});
