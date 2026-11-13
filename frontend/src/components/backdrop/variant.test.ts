import { describe, expect, it } from "vitest";
import { backdropFor } from "./variant";

describe("backdropFor", () => {
  it("gives home no backdrop (it has its own)", () => {
    expect(backdropFor("/")).toBeNull();
    expect(backdropFor("")).toBeNull();
    expect(backdropFor(null)).toBeNull();
  });

  it("matches each section to its scene", () => {
    expect(backdropFor("/objects/")).toBe("belt");
    expect(backdropFor("/objects/obj-sv-1/")).toBe("belt");
    expect(backdropFor("/leads/")).toBe("belt");
    expect(backdropFor("/detective/x/")).toBe("belt");
    expect(backdropFor("/explore/aquarius-a/")).toBe("field");
    expect(backdropFor("/sky/")).toBe("field");
    expect(backdropFor("/about/")).toBe("orbits");
    expect(backdropFor("/limits/")).toBe("orbits");
    expect(backdropFor("/missing-page/")).toBe("orbits");
  });

  it("doesn't match on a prefix alone", () => {
    expect(backdropFor("/objectsx/")).toBe("orbits");
  });
});
