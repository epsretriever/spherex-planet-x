import { describe, expect, it } from "vitest";
import { pageMeta, SITE_URL } from "./meta";

describe("pageMeta", () => {
  it("gives every page a full share card with the page's own title", () => {
    const m = pageMeta("Sky map", "Where we searched.", "/sky/");
    expect(m.title).toBe("Sky map");
    expect(m.openGraph?.title).toBe("Sky map · Driftnet");
    expect(m.openGraph?.description).toBe("Where we searched.");
    expect((m.openGraph as { images: { url: string }[] }).images[0]!.url).toBe("/og.png");
    expect((m.twitter as { card: string }).card).toBe("summary_large_image");
  });
  it("defaults to the deployed origin", () => {
    expect(SITE_URL).toMatch(/^https:\/\//);
  });
});
