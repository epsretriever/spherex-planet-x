import { describe, expect, it } from "vitest";
import { candidateHref, fieldHref, queryRouteFor } from "./routes";

describe("routes", () => {
  it("builds prerendered object paths", () => {
    expect(fieldHref("aquarius-a")).toBe("/explore/aquarius-a/");
    expect(candidateHref("aquarius-a-c01")).toBe("/detective/aquarius-a-c01/");
  });

  it("forwards unknown object paths to the ?id= routes", () => {
    expect(queryRouteFor("/explore/run-123/")).toBe("/explore/field/?id=run-123");
    expect(queryRouteFor("/detective/run-123-c02")).toBe("/detective/candidate/?id=run-123-c02");
  });

  it("leaves other paths alone", () => {
    expect(queryRouteFor("/explore/field/")).toBeNull();
    expect(queryRouteFor("/detective/candidate/")).toBeNull();
    expect(queryRouteFor("/nope/")).toBeNull();
    expect(queryRouteFor("/explore/a/b/")).toBeNull();
    expect(queryRouteFor("/explore/Bad Id/")).toBeNull();
  });
});
