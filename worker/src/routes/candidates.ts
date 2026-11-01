import { Hono } from "hono";
import type { AppEnv } from "../app";
import type { Deps, Env } from "../env";
import { CLASSIFICATIONS, type CandidateDetail, type CandidateList, type CandidateSummary, type Classification } from "../contract";
import { type Enrichment, notCheckedKnownObject } from "../enrich";
import { badRequest } from "../errors";
import { ID_RE, orbitOfCandidate, requireStaticJson } from "../static-data";
import { pageParams, paginate } from "../paging";
import { readRecord, readRecords, refreshRecord, usableRecord } from "../store";
import { applyKnownObject, labelPlain, summaryPlainFrom } from "../text";

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

  const paging = pageParams((n) => c.req.query(n));

  const list = await requireStaticJson<CandidateList>(c.env, "candidates.json", "candidate list");
  const deps = c.get("deps");
  // Fold in stored JPL results (one store query; no upstream calls from the list view).
  const real = list.candidates.filter((s) => s.classification !== "injected");
  const recs = await readRecords(deps, list.pipeline_version, real.map((s) => s.candidate_id));
  const missing = real.find((s) => !recs.has(s.candidate_id) && !s.known_object_checked);
  if (missing) {
    // Start one background lookup so the list fills in even before the cron runs.
    deps.waitUntil(
      requireStaticJson<CandidateDetail>(c.env, `candidates/${missing.candidate_id}.json`, "candidate")
        .then(async (cand) => refreshRecord(deps, cand, await orbitOfCandidate(c.env, cand.candidate_id)))
        .catch((err) => console.error(`background JPL lookup for ${missing.candidate_id}:`, err)),
    );
  }
  const enriched = list.candidates.map((s) => {
    const rec = s.classification === "injected" ? null : usableRecord(recs.get(s.candidate_id), s.known_object_checked);
    return rec ? applyToSummary(s, rec.enrichment) : s;
  });
  const filtered = enriched.filter(
    (s) =>
      (fieldId === undefined || s.field_id === fieldId) &&
      (classes.length === 0 || classes.includes(s.classification)) &&
      (minScore === null || s.overall_score >= minScore) &&
      (includeInjected || s.classification !== "injected"),
  );
  const page = paginate(filtered, paging);
  const body: CandidateList = {
    ...list,
    total: page.total,
    offset: page.offset,
    limit: page.limit,
    next_offset: page.next_offset,
    candidates: page.items,
  };
  c.header("Cache-Control", "public, max-age=60");
  return c.json(body);
});

candidates.get("/:candidateId", async (c) => {
  const id = c.req.param("candidateId");
  if (!ID_RE.test(id)) throw badRequest("invalid candidate_id");
  const { detail, cacheControl } = await loadCandidate(c.env, c.get("deps"), id);
  c.header("Cache-Control", cacheControl);
  return c.json(detail);
});

/**
 * A candidate report with the stored JPL result applied, as the detail route serves it. When no
 * result is stored yet, starts the lookup in the background and reports it as pending.
 */
export async function loadCandidate(
  env: Env,
  deps: Deps,
  id: string,
): Promise<{ detail: CandidateDetail; cacheControl: string; pending: boolean }> {
  const cand = await requireStaticJson<CandidateDetail>(env, `candidates/${id}.json`, `candidate '${id}'`);
  const now = deps.now().toISOString();
  if (cand.classification === "injected") {
    return { detail: applyKnownObject(cand, cand.known_object, false, now), cacheControl: "public, max-age=300", pending: false };
  }
  const rec = usableRecord(await readRecord(deps, cand), cand.known_object.checked);
  if (rec) {
    const e: Enrichment = { ...rec.enrichment, known_object: { ...rec.enrichment.known_object, enrichment: "cached" } };
    return {
      detail: applyKnownObject(cand, e.known_object, e.matched, now),
      cacheControl: rec.status === "checked" ? "public, max-age=300" : "no-store",
      pending: false,
    };
  }
  // Checked when the data was published (scripts/jpl-check.ts): serve that result.
  if (cand.known_object.checked) {
    return {
      detail: applyKnownObject(cand, cand.known_object, cand.known_object.matched, now),
      cacheControl: "public, max-age=300",
      pending: false,
    };
  }
  // Nothing stored yet: answer now and look JPL up in the background. The client polls.
  deps.waitUntil(
    orbitOfCandidate(env, id)
      .then((orbit) => refreshRecord(deps, cand, orbit))
      .catch((err) => console.error(`background JPL lookup for ${id}:`, err)),
  );
  const pending = {
    ...notCheckedKnownObject("Checking JPL's catalog of known asteroids and comets now. This takes up to a minute the first time.", cand.known_object),
    enrichment: "pending" as const,
  };
  return { detail: applyKnownObject(cand, pending, false, now), cacheControl: "no-store", pending: true };
}

export function applyToSummary(s: CandidateSummary, e: Enrichment): CandidateSummary {
  const classification: Classification = e.matched ? "known_object" : s.classification;
  return {
    ...s,
    classification,
    label_plain: labelPlain({ classification, known_object: e.known_object }),
    summary_plain: summaryPlainFrom({
      classification,
      known_object: e.known_object,
      rate_arcsec_per_hr: s.rate_arcsec_per_hr,
      n_detections: s.detection_count,
      time_span_hours: s.time_span_hours,
    }),
    known_object_checked: e.known_object.checked,
    known_object_matched: e.known_object.matched,
    known_object_designation: e.known_object.designation,
  };
}
