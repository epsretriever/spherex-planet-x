import { describe, expect, it } from "vitest";
import { citationName, resolveCitations, sectionForPath, showValue } from "./citations";

describe("citations", () => {
  it("maps paths to report sections", () => {
    expect(sectionForPath("motion.rate_arcsec_per_hr")).toBe("motion");
    expect(sectionForPath("detections[2].snr")).toBe("measurements");
    expect(sectionForPath("known_object.per_epoch[0].separation_arcsec")).toBe("known");
    expect(sectionForPath("vetting.checks[1].passed")).toBe("errors");
    expect(sectionForPath("mystery.value")).toBeNull();
  });

  it("names common values, numbering sightings from 1", () => {
    expect(citationName("motion.rate_arcsec_per_hr")).toBe("Speed (″/hr)");
    expect(citationName("detections[0].snr")).toBe("Sighting 1 signal-to-noise");
    expect(citationName("detections[0].x_pix")).toBeNull();
  });

  it("resolves values and keeps unknown paths marked", () => {
    const doc = { motion: { rate_arcsec_per_hr: 31.7 }, detections: [{ snr: 9 }] };
    const r = resolveCitations(doc, ["motion.rate_arcsec_per_hr", "detections[0].snr", "detections[4].snr", "motion.rate_arcsec_per_hr"]);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ found: true, value: 31.7, section: "motion" });
    expect(r[2]).toMatchObject({ found: false, section: "measurements" });
  });

  it("formats values", () => {
    expect(showValue(31.700000001)).toBe("31.7");
    expect(showValue(null)).toBe("null");
    expect(showValue(true)).toBe("true");
  });
});
