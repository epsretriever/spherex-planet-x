import { describe, expect, it } from "vitest";
import type { ObjectDetail } from "./contract";
import { groupVisits } from "./objects";

type D = ObjectDetail["detections"][number];
const d = (mjd: number, field = "f1", cand = "c1") => ({ mjd, time_utc: new Date((mjd - 40587) * 86400000).toISOString(), field_id: field, candidate_id: cand }) as D;

describe("groupVisits", () => {
  it("splits at gaps of more than 30 minutes, in time order", () => {
    const min = 1 / 1440;
    const v = groupVisits([d(100 + 45 * min), d(100), d(100 + 10 * min), d(100 + 80 * min, "f2", "c2"), d(101)]);
    expect(v.map((x) => x.detections.length)).toEqual([2, 1, 1, 1]);
    expect(v[0]!.start_mjd).toBe(100);
    expect(v[2]!.field_ids).toEqual(["f2"]);
    expect(v[2]!.candidate_ids).toEqual(["c2"]);
  });

  it("keeps a 30-minute gap inside one visit", () => {
    expect(groupVisits([d(0), d(30 / 1440)])).toHaveLength(1);
    expect(groupVisits([])).toEqual([]);
  });
});
