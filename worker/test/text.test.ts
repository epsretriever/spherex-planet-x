import { describe, expect, it } from "vitest";
import { buildExplanation, checkNumbers, resolvePath } from "../src/text";
import { candidate } from "./factory";

describe("grounded explanations", () => {
  it("resolves indexed paths", () => {
    expect(resolvePath({ a: [{ b: 3 }] }, "a[0].b")).toBe(3);
    expect(resolvePath({ a: [] }, "a[1].b")).toBeUndefined();
  });

  it("only passes when every number is grounded", () => {
    const doc = { motion: { rate: 31.66 }, name: "2019 AB12" };
    expect(checkNumbers("moves 31.7 arcsec/hr", ["motion.rate"], doc)).toBe(true);
    expect(checkNumbers("moves 31.7 arcsec/hr, 2019 AB12", ["motion.rate", "name"], doc)).toBe(true);
    expect(checkNumbers("moves 31.7 arcsec/hr over 5 days", ["motion.rate"], doc)).toBe(false);
    expect(checkNumbers("x", ["missing.path"], doc)).toBe(false);
  });

  it("builds a checked explanation for an unchecked candidate", () => {
    const e = buildExplanation(candidate(), "2026-10-29T00:00:00Z");
    expect(e.numeric_check).toBe("passed");
    expect(e.generator).toBe("template_v1");
    expect(e.text).toContain("not been checked against JPL");
    expect(e.text).not.toMatch(/discover|new planet|planet x/i);
    for (const f of e.grounded_fields) expect(resolvePath(candidate(), f)).not.toBeUndefined();
  });
});
