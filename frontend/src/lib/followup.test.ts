import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CandidateDetail, ObjectPrediction, ObjectSummary } from "./contract";
import { adesPsv, decDms, ephemerisCsv, mpc80, mpcDate, raHms, trackSubId } from "./followup";

const dir = path.join(process.cwd(), "public", "data");
const objects = JSON.parse(readFileSync(path.join(dir, "objects.json"), "utf8")) as { objects: ObjectSummary[] };
const obj = objects.objects.find((o) => o.classification === "unmatched")!;
const cand = JSON.parse(readFileSync(path.join(dir, "candidates", `${obj.candidate_ids[0]}.json`), "utf8")) as CandidateDetail;

describe("formats", () => {
  it("writes sexagesimal and MPC dates", () => {
    expect(raHms(243.386885)).toBe("16 13 32.852");
    expect(decDms(-20.5792041)).toBe("-20 34 45.13");
    expect(decDms(0.5)).toBe("+00 30 00.00");
    expect(mpcDate("2025-08-15T12:00:00Z")).toBe("2025 08 15.500000");
    expect(trackSubId("x")).toHaveLength(7);
  });
});

describe("follow-up files", () => {
  it("MPC 80-column lines are exactly 80 characters, S and s pairs", () => {
    const lines = mpc80(obj.object_id, cand).trimEnd().split("\n");
    expect(lines.length).toBe(cand.detections.length * 2);
    for (const l of lines) expect(l).toHaveLength(80);
    expect(lines[0]![14]).toBe("S");
    expect(lines[1]![14]).toBe("s");
  });
  it("ADES PSV has one row per detection and says it is a draft", () => {
    const psv = adesPsv(obj.object_id, cand);
    expect(psv).toContain("NOT AN MPC SUBMISSION");
    const rows = psv.split("\n").filter((l) => l.includes("|"));
    expect(rows.length).toBe(cand.detections.length + 1);
    expect(rows[1]!.split("|")).toHaveLength(rows[0]!.split("|").length);
  });
  it("ephemeris covers 14 nights from the prediction and is labeled approximate", () => {
    const pred = JSON.parse(readFileSync(path.join(dir, "objects", obj.object_id, "prediction.json"), "utf8")) as ObjectPrediction;
    const csv = ephemerisCsv(obj.object_id, pred, new Date(pred.points[0]!.time_utc), 14);
    expect(csv).toMatch(/^# APPROXIMATE/);
    expect(csv.split("\n").filter((l) => /^\d{4}-/.test(l))).toHaveLength(15);
  });
});
