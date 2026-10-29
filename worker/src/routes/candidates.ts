import { Hono } from "hono";
import type { AppEnv } from "../app";
import { CLASSIFICATIONS, type CandidateDetail, type CandidateList, type CandidateSummary, type Classification } from "../contract";
import { type Enrichment, notCheckedKnownObject } from "../enrich";
import { badRequest } from "../errors";
import { ID_RE, requireStaticJson } from "../static-data";
import { readRecord, refreshRecord } from "../store";
import { applyKnownObject, labelPlain } from "../text";

export const candidates = new Hono<AppEnv>();

candidates.get("/", async (c) => {
  const q = c.req.queries();
  const fieldId = c.req.query("field_id");
  const classes = (q.classification ?? []).flatMap((v) => v.split(",")).filter(Boolean);
  for (const cl of classes) {
    if (!CLASSIFICATIONS.includes(cl as Classification)) throw badRequest(`unknown classification '${cl}'`);
  }
  const minScoreRaw = c.req.query("min_score");
  const minScore = minScoreRaw === undefined ? null : Number(minScoreRaw);
  if (minScore !== null && !(Number.isFinite(minScore) && minScore >= 0 && minScore <= 1)) {
    throw badRequest("min_score must be a number between 0 and 1");
  }
  const includeInjected = c.req.query("include_injected") === "true" || classes.includes("injected");

  const list = await requireStaticJson<CandidateList>(c.env, "candidates.json", "candidate list");
  const deps = c.get("deps");
  // Fold in stored JPL results (no upstream calls from the list view).
  let warming = false;
  const enriched = await Promise.all(
    list.candidates.map(async (s): Promise<CandidateSummary> => {
      if (s.classification === "injected") return s;
      const ref = { candidate_id: s.candidate_id, pipeline_version: list.pipeline_version };
      const rec = await readRecord(deps, ref);
      if (!rec && !warming) {
        // Start one background lookup so the list fills in even before the cron runs.
        warming = true;
        deps.waitUntil(
          requireStaticJson<CandidateDetail>(c.env, `candidates/${s.candidate_id}.json`, "candidate")
            .then((cand) => refreshRecord(deps, cand))
            .catch((err) => console.error(`background JPL lookup for ${s.candidate_id}:`, err)),
        );
      }
      return rec ? applyToSummary(s, rec.enrichment) : s;
    }),
  );
  const filtered = enriched.filter(
    (s) =>
      (fieldId === undefined || s.field_id === fieldId) &&
      (classes.length === 0 || classes.includes(s.classification)) &&
      (minScore === null || s.overall_score >= minScore) &&
      (includeInjected || s.classification !== "injected"),
  );
  const body: CandidateList = { ...list, total: filtered.length, candidates: filtered };
  c.header("Cache-Control", "public, max-age=60");
  return c.json(body);
});

candidates.get("/:candidateId", async (c) => {
  const id = c.req.param("candidateId");
  if (!ID_RE.test(id)) throw badRequest("invalid candidate_id");
  const cand = await requireStaticJson<CandidateDetail>(c.env, `candidates/${id}.json`, `candidate '${id}'`);
  const deps = c.get("deps");
  const now = deps.now().toISOString();
  if (cand.classification === "injected") {
    c.header("Cache-Control", "public, max-age=300");
    return c.json(applyKnownObject(cand, cand.known_object, false, now));
  }
  const rec = await readRecord(deps, cand);
  if (rec) {
    const e: Enrichment = { ...rec.enrichment, known_object: { ...rec.enrichment.known_object, enrichment: "cached" } };
    c.header("Cache-Control", rec.status === "checked" ? "public, max-age=300" : "no-store");
    return c.json(applyKnownObject(cand, e.known_object, e.matched, now));
  }
  // Nothing stored yet: answer now and look JPL up in the background. The client polls.
  deps.waitUntil(
    refreshRecord(deps, cand).catch((err) => console.error(`background JPL lookup for ${id}:`, err)),
  );
  const pending = {
    ...notCheckedKnownObject("Checking JPL's catalog of known asteroids and comets now. This takes up to a minute the first time.", cand.known_object),
    enrichment: "pending" as const,
  };
  c.header("Cache-Control", "no-store");
  return c.json(applyKnownObject(cand, pending, false, now));
});

function applyToSummary(s: CandidateSummary, e: Enrichment): CandidateSummary {
  const classification: Classification = e.matched ? "known_object" : s.classification;
  return {
    ...s,
    classification,
    label_plain: labelPlain({ classification, known_object: e.known_object }),
    known_object_checked: e.known_object.checked,
    known_object_matched: e.known_object.matched,
    known_object_designation: e.known_object.designation,
  };
}
