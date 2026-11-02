import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FORBIDDEN } from "../src/ai/core";
import { digestFacts, templateDigest } from "../src/ai/digest";
import type { Digest, Survey } from "../src/contract";
import { checkNumbers } from "../src/text";
import { sqliteD1 } from "./d1";
import { makeClient } from "./helpers";

// The real published survey ledger.
const survey = JSON.parse(readFileSync(new URL("../../frontend/public/data/survey.json", import.meta.url), "utf8")) as Survey;

function fakeAi(...responses: unknown[]) {
  return {
    async run() {
      const r = responses.shift();
      return { response: typeof r === "string" ? r : JSON.stringify(r) };
    },
  };
}

async function client(ai?: ReturnType<typeof fakeAi>) {
  const c = makeClient({ files: { "/data/survey.json": survey, "/data/objects.json": { ...survey, objects: [] } } });
  if (ai) c.env.AI = ai;
  c.env.DB = (await sqliteD1()).d1;
  return c;
}

describe("daily digest", () => {
  it("has a template whose every number is a cited fact from the ledger", () => {
    const f = digestFacts(survey, 61, "2026-11-02");
    const d = templateDigest(f, survey.pipeline_version, "2026-11-02T00:00:00Z");
    expect(d.text).toContain(`searched ${survey.last_run!.n_tiles_processed} patches`);
    expect(checkNumbers(d.text, d.grounded_fields, f)).toBe(true);
    expect(FORBIDDEN.test(d.text)).toBe(false);
    expect(d.text).not.toMatch(/\bnew\b/i);
    expect(d.run_id).toBe(survey.last_run!.run_id);
  });

  it("serves AI text that passes every check", async () => {
    const ok = {
      text: `The latest run searched ${survey.last_run!.n_tiles_processed} patches of sky. ${survey.totals.n_objects} moving objects are tracked.`,
      grounded_fields: ["last_run.n_tiles_processed", "totals.n_objects"],
    };
    const c = await client(fakeAi(ok));
    const body = (await (await c.get("/api/digest")).json()) as Digest & { source: string };
    expect(body).toMatchObject({ source: "ai", text: ok.text, numeric_check: "passed" });
  });

  it.each([
    ["an invented number", { text: "The run searched 9999 patches.", grounded_fields: [] }],
    ["calling objects new", { text: "We found new objects today.", grounded_fields: [] }],
    ["a discovery claim", { text: "We discovered asteroids.", grounded_fields: [] }],
    ["the wrong shape", ["not", "an", "object"]],
  ])("falls back to the template on %s", async (_name, response) => {
    const c = await client(fakeAi(response));
    const body = (await (await c.get("/api/digest")).json()) as Digest & { source: string };
    expect(body.source).toBe("template");
    expect(body.model).toBeNull();
  });

  it("works without the AI binding", async () => {
    const body = (await (await (await client()).get("/api/digest")).json()) as Digest & { source: string };
    expect(body.source).toBe("template");
    expect(body.text.length).toBeGreaterThan(20);
  });
});
