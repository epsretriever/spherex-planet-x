import { Hono } from "hono";
import type { AppEnv } from "../app";
import { CLASSIFICATIONS, type CandidateDetail, type CandidateList, type CandidateSummary, type Classification } from "../contract";
import { type Enrichment, cachedEnrichment, enrichKnownObject, storeEnrichment } from "../enrich";
import { badRequest } from "../errors";
import { ID_RE, requireStaticJson } from "../static-data";
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
  // Fold in enrichment results that are already cached (no upstream calls from the list view).
  const enriched = await Promise.all(
    list.candidates.map(async (s): Promise<CandidateSummary> => {
      if (s.classification === "injected") return s;
      const e = await cachedEnrichment(deps.cache, { candidate_id: s.candidate_id, pipeline_version: list.pipeline_version });
      return e ? applyToSummary(s, e) : s;
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
  let e: Enrichment | null = await cachedEnrichment(deps.cache, cand);
  if (e) {
    e = { ...e, known_object: { ...e.known_object, enrichment: "cached" } };
  } else {
    e = await enrichKnownObject(deps, cand);
    await storeEnrichment(deps.cache, cand, e);
  }
  c.header("Cache-Control", e.known_object.checked ? "public, max-age=300" : "no-store");
  return c.json(applyKnownObject(cand, e.known_object, e.matched, now));
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
