import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FORBIDDEN } from "../src/ai/core";
import type { CandidateDetail, KnownObject, Reporting } from "../src/contract";
import { REPORTING_LABELS, applyReporting, jplCriteria, statusOf, summaryStatus } from "../src/reporting";
import { writeRecord } from "../src/store";
import { candidate, list } from "./factory";
import { json, makeClient } from "./helpers";

type Case = { name: string; known_object: KnownObject; passed: (boolean | null)[]; status: string };
const cases = (
  JSON.parse(readFileSync(new URL("../../shared/fixtures/reporting_jpl_cases.json", import.meta.url), "utf8")) as { cases: Case[] }
).cases;

const published: Reporting = {
  status: "incomplete",
  label_plain: REPORTING_LABELS.incomplete,
  summary_plain: "",
  measurements_passed: true,
  criteria: [
    { id: "visits", label: "Seen in at least 3 separate visits", passed: true, value: 4, threshold: 3, source: "pipeline" },
    { id: "jpl_no_match", label: "No known asteroid or comet at its position", passed: null, value: null, threshold: false, source: "jpl" },
  ],
  definition: "",
};

describe("candidates for reporting", () => {
  it("apply the same JPL rules as the pipeline", () => {
    for (const c of cases) {
      const got = jplCriteria(c.known_object);
      expect(got.map((x) => x.passed), c.name).toEqual(c.passed);
      expect(statusOf([{ passed: true }, ...got]), c.name).toBe(c.status);
      expect(summaryStatus(true, c.known_object), c.name).toBe(c.status);
      expect(summaryStatus(false, c.known_object), c.name).toBe("not_ready");
    }
  });

  it("never use discovery language", () => {
    const texts: string[] = Object.values(REPORTING_LABELS);
    for (const c of cases) {
      const r = applyReporting(published, c.known_object)!;
      texts.push(r.label_plain, r.summary_plain, ...r.criteria.map((x) => x.label));
    }
    for (const t of texts) expect(FORBIDDEN.test(t), t).toBe(false);
    expect(texts.join(" ")).not.toMatch(/\bnew (object|asteroid|comet)\b/i);
  });

  it("are filled in from the catalog check a report is served with", async () => {
    const ready = cases.find((c) => c.status === "ready")!.known_object;
    const cand: CandidateDetail = { ...candidate({ candidate_id: "tile-c02", classification: "unmatched", known_object: ready }), reporting: published };
    const c = makeClient({ files: { "/data/candidates.json": list([cand]), "/data/candidates/tile-c02.json": cand } });
    const pending = (await json(await c.get("/api/candidates/tile-c02"))) as CandidateDetail;
    expect(pending.reporting!.status).toBe("incomplete"); // never "ready" while the lookup runs
    await c.settle(); // the background lookup (network disabled) stores a failed result first
    await writeRecord(c.deps, cand, { known_object: { ...ready, enrichment: "live" }, matched: false });
    const body = (await json(await c.get("/api/candidates/tile-c02"))) as CandidateDetail;
    expect(body.reporting).toMatchObject({ status: "ready", label_plain: "Not in any catalog we checked — candidate for reporting" });
    expect(body.reporting!.criteria.filter((x) => x.source === "jpl")).toHaveLength(3);
    expect(body.reporting!.criteria.find((x) => x.id === "visits")!.passed).toBe(true);
  });

  it("are never given to injected candidates", async () => {
    const cand: CandidateDetail = { ...candidate({ candidate_id: "tile-c03", classification: "injected" }), reporting: null };
    const c = makeClient({ files: { "/data/candidates.json": list([cand]), "/data/candidates/tile-c03.json": cand } });
    const body = (await json(await c.get("/api/candidates/tile-c03"))) as CandidateDetail;
    expect(body.reporting).toBeNull();
  });
});
