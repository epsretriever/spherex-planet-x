import { describe, expect, it } from "vitest";
import { candidateHref, fieldHref, movedTo, objectHref, queryRouteFor } from "./routes";

describe("routes", () => {
  it("builds prerendered object paths", () => {
    expect(fieldHref("aquarius-a")).toBe("/explore/aquarius-a/");
    expect(candidateHref("aquarius-a-c01")).toBe("/objects/obj-aquarius-a-c01/");
    expect(objectHref("obj-aquarius-a-c01")).toBe("/objects/obj-aquarius-a-c01/");
  });

  it("forwards unknown object paths to the ?id= routes", () => {
    expect(queryRouteFor("/explore/run-123/")).toBe("/explore/field/?id=run-123");
    expect(queryRouteFor("/detective/run-123-c02")).toBe("/objects/object/?id=obj-run-123-c02");
    expect(queryRouteFor("/objects/obj-run-1/")).toBe("/objects/object/?id=obj-run-1");
  });

  it("leaves other paths alone", () => {
    expect(queryRouteFor("/explore/field/")).toBeNull();
    expect(queryRouteFor("/detective/candidate/")).toBeNull();
    expect(queryRouteFor("/objects/object/")).toBeNull();
    expect(queryRouteFor("/nope/")).toBeNull();
    expect(queryRouteFor("/explore/a/b/")).toBeNull();
    expect(queryRouteFor("/explore/Bad Id/")).toBeNull();
  });
});

describe("movedTo", () => {
  it("sends every old page to its new home, keeping the query", () => {
    expect(movedTo("/detective/", "?class=unmatched&q=fast")).toBe("/objects/?class=unmatched&q=fast");
    expect(movedTo("/leads/")).toBe("/objects/?view=leads");
    expect(movedTo("/explore/", "")).toBe("/objects/?view=patches");
    expect(movedTo("/detective/aquarius-a-c01/")).toBe("/objects/obj-aquarius-a-c01/");
    expect(movedTo("/detective/candidate/", "?id=x-c01&utm=a")).toBe("/objects/object/?utm=a&id=obj-x-c01");
  });
  it("leaves pages that didn't move", () => {
    expect(movedTo("/explore/aquarius-a/")).toBeNull();
    expect(movedTo("/objects/")).toBeNull();
    expect(movedTo("/sky/")).toBeNull();
  });
});
