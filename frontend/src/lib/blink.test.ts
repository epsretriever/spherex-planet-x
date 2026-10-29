import { describe, expect, it } from "vitest";
import { testEpoch, testPair, testSource } from "@/test/factories";
import { buildSequences, canRender, formatGap, hasSource } from "./blink";

describe("hasSource", () => {
  it("requires a file and an observation ID", () => {
    expect(hasSource(testSource())).toBe(true);
    expect(hasSource(null)).toBe(false);
    expect(hasSource({ ...testSource(), file: "" })).toBe(false);
    expect(hasSource({ ...testSource(), obs_id: "" })).toBe(false);
  });
});

describe("canRender", () => {
  it("refuses an epoch whose image has no source", () => {
    const e = testEpoch("e1", 60000);
    expect(canRender(e)).toBe(true);
    expect(canRender({ ...e, image: { ...e.image, source: null as never } })).toBe(false);
    expect(canRender({ ...e, image: { ...e.image, url: "" } })).toBe(false);
  });
});

describe("buildSequences", () => {
  const epochs = [testEpoch("c", 60003), testEpoch("a", 60001), testEpoch("b", 60002)];

  it("puts wavelength-matched pairs first", () => {
    const seqs = buildSequences(epochs, [testPair("a", "c", false), testPair("b", "a", true)]);
    expect(seqs.map((s) => s.key)).toEqual(["pair:a:b", "pair:a:c", "all"]);
    expect(seqs[0]!.lambdaMatched).toBe(true);
    expect(seqs[1]!.lambdaMatched).toBe(false);
  });

  it("orders each pair by time and the all-dates sequence by MJD", () => {
    const seqs = buildSequences(epochs, [testPair("c", "a", true)]);
    expect(seqs[0]!.epochs.map((e) => e.epoch_id)).toEqual(["a", "c"]);
    expect(seqs.at(-1)!.epochs.map((e) => e.epoch_id)).toEqual(["a", "b", "c"]);
  });

  it("drops pairs that reference unknown or identical epochs, and duplicates", () => {
    const seqs = buildSequences(epochs, [testPair("a", "zzz", true), testPair("a", "a", true), testPair("a", "b", true), testPair("b", "a", true)]);
    expect(seqs.map((s) => s.key)).toEqual(["pair:a:b", "all"]);
  });

  it("falls back to all dates when there are no pairs", () => {
    expect(buildSequences(epochs, []).map((s) => s.key)).toEqual(["all"]);
    expect(buildSequences([testEpoch("x", 1)], [])[0]!.label).toBe("1 date");
    expect(buildSequences([], [])).toEqual([]);
  });

  it("keeps the backend's ranking and opens on its default pair", () => {
    const ranked = [
      { ...testPair("a", "b", false), displacement_arcsec: 120 },
      { ...testPair("a", "c", false), displacement_arcsec: 480, default: true },
      { ...testPair("b", "c", true) },
    ];
    const seqs = buildSequences(epochs, ranked);
    expect(seqs.map((s) => s.key)).toEqual(["pair:a:c", "pair:a:b", "pair:b:c", "all"]);
    expect(seqs[0]!.displacementArcsec).toBe(480);
    expect(seqs[0]!.label).toMatch(/2.0 days apart · moves 480″$/);
    expect(seqs[2]!.displacementArcsec).toBeNull();
  });

  it("formats the gap between images", () => {
    expect(formatGap(0.25)).toBe("15 minutes apart");
    expect(formatGap(13.17)).toBe("13 hours apart");
    expect(formatGap(50.6)).toBe("2.1 days apart");
  });

  it("adds times to the label when both dates fall on the same day", () => {
    const same = [testEpoch("a", 60000.1), testEpoch("b", 60000.3)];
    expect(buildSequences(same, [testPair("a", "b", true)])[0]!.label).toMatch(/UTC · 5 hours apart$/);
  });
});
