import { describe, expect, it } from "vitest";
import { tourSteps } from "./tour";

describe("tourSteps", () => {
  it("has six stops in order, with fallback captions when nothing loaded", () => {
    const s = tourSteps({ survey: null, objects: null, leads: null, study: null });
    expect(s.map((x) => x.href)).toEqual(["/", "/explore/", "/detective/", "/leads/", "/limits/", "/sky/"]);
    for (const x of s) expect(x.caption.length).toBeGreaterThan(20);
  });
  it("never calls anything a discovery", () => {
    const text = tourSteps({ survey: null, objects: null, leads: null, study: null }).map((x) => x.caption).join(" ");
    expect(text).not.toMatch(/discover/i);
  });
});
