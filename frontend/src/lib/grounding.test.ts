import { describe, expect, it } from "vitest";
import { linkNumbers, resolveGrounded, resolvePath } from "./grounding";

const doc = {
  motion: { n_detections: 4, time_span_hours: 6.2, rate_arcsec_per_hr: 31.7 },
  known_object: { per_epoch: [{ separation_arcsec: 0.45 }, { separation_arcsec: 0.6 }] },
};

describe("resolvePath", () => {
  it("resolves dotted paths and array indexes", () => {
    expect(resolvePath(doc, "motion.rate_arcsec_per_hr")).toEqual({ found: true, value: 31.7 });
    expect(resolvePath(doc, "known_object.per_epoch[1].separation_arcsec")).toEqual({ found: true, value: 0.6 });
  });

  it("reports paths that don't resolve", () => {
    expect(resolvePath(doc, "known_object.per_epoch[5].separation_arcsec").found).toBe(false);
    expect(resolvePath(doc, "motion.missing").found).toBe(false);
    expect(resolvePath(doc, "motion[0]").found).toBe(false);
    expect(resolvePath(doc, "").found).toBe(false);
    expect(resolvePath(doc, "known_object.per_epoch[x]").found).toBe(false);
  });
});

describe("resolveGrounded", () => {
  it("separates resolved values from missing paths", () => {
    const r = resolveGrounded(doc, ["motion.n_detections", "nope.nothing"]);
    expect(r.values).toEqual([{ path: "motion.n_detections", value: 4 }]);
    expect(r.missing).toEqual(["nope.nothing"]);
  });
});

describe("linkNumbers", () => {
  it("links numbers in the text to the grounded values they came from", () => {
    const { values } = resolveGrounded(doc, ["motion.n_detections", "motion.time_span_hours", "known_object.per_epoch[0].separation_arcsec"]);
    const parts = linkNumbers("Seen 4 times over 6.2 hours, within 0.45″ of the prediction, 2026.", values);
    expect(parts.filter((p) => p.ref !== undefined)).toEqual([
      { text: "4", ref: 0 },
      { text: "6.2", ref: 1 },
      { text: "0.45", ref: 2 },
    ]);
    expect(parts.map((p) => p.text).join("")).toBe("Seen 4 times over 6.2 hours, within 0.45″ of the prediction, 2026.");
  });

  it("matches after rounding to the decimals written", () => {
    const parts = linkNumbers("about 31.7″/hr or 32", [{ path: "r", value: 31.74 }]);
    expect(parts.filter((p) => p.ref !== undefined).map((p) => p.text)).toEqual(["31.7", "32"]);
  });
});
