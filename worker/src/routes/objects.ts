import { Hono } from "hono";
import type { AppEnv } from "../app";
import type {
  CandidateDetail,
  Classification,
  ObjectDetail,
  ObjectList,
  ObjectPrediction,
  ObjectSummary,
  Survey,
} from "../contract";
import { notCheckedKnownObject } from "../enrich";
import { ApiError, badRequest } from "../errors";
import { ID_RE, requireStaticJson } from "../static-data";
import { readRecord, refreshRecord } from "../store";
import { buildExplanation, labelPlain, summaryPlain, summaryPlainFrom } from "../text";

export const objects = new Hono<AppEnv>();

/** Objects reuse the JPL result of the candidate they were linked from. */
const refOf = (o: { candidate_ids: string[] }, pipelineVersion: string) => ({
  candidate_id: o.candidate_ids[0] ?? "",
  pipeline_version: pipelineVersion,
});

objects.get("/", async (c) => {
  const list = await requireStaticJson<ObjectList>(c.env, "objects.json", "object list");
  const deps = c.get("deps");
  const out = await Promise.all(
    list.objects.map(async (s): Promise<ObjectSummary> => {
      if (s.classification === "injected" || s.candidate_ids.length === 0) return s;
      const rec = await readRecord(deps, refOf(s, list.pipeline_version));
      if (!rec) return s;
      const k = rec.enrichment.known_object;
      const classification: Classification = rec.enrichment.matched ? "known_object" : s.classification;
      return {
        ...s,
        classification,
        label_plain: labelPlain({ classification, known_object: k }),
        summary_plain: summaryPlainFrom({
          classification,
          known_object: k,
          rate_arcsec_per_hr: s.rate_arcsec_per_hr,
          n_detections: s.n_detections,
          time_span_hours: s.arc_hours,
        }),
        known_object_checked: k.checked,
        known_object_matched: k.matched,
        known_object_designation: k.designation,
      };
    }),
  );
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ ...list, objects: out });
});

objects.get("/:objectId", async (c) => {
  const id = c.req.param("objectId");
  if (!ID_RE.test(id)) throw badRequest("invalid object_id");
  const obj = await requireStaticJson<ObjectDetail>(c.env, `objects/${id}.json`, `object '${id}'`);
  const deps = c.get("deps");
  const now = deps.now().toISOString();
  let known = obj.known_object;
  let matched = false;
  let cacheable = true;
  if (obj.classification !== "injected" && obj.candidate_ids.length > 0) {
    const rec = await readRecord(deps, refOf(obj, obj.pipeline_version));
    if (rec) {
      known = { ...rec.enrichment.known_object, enrichment: "cached" };
      matched = rec.enrichment.matched;
      cacheable = rec.status === "checked";
    } else {
      const candId = obj.candidate_ids[0]!;
      deps.waitUntil(
        requireStaticJson<CandidateDetail>(c.env, `candidates/${candId}.json`, "candidate")
          .then((cand) => refreshRecord(deps, cand))
          .catch((err) => console.error(`background JPL lookup for ${candId}:`, err)),
      );
      known = {
        ...notCheckedKnownObject(
          "Checking JPL's catalog of known asteroids and comets now. This takes up to a minute the first time.",
          obj.known_object,
        ),
        enrichment: "pending",
      };
      cacheable = false;
    }
  }
  const classification: Classification = matched && obj.classification !== "injected" ? "known_object" : obj.classification;
  const next: ObjectDetail = { ...obj, classification, known_object: known };
  next.label_plain = labelPlain(next);
  next.summary_plain = summaryPlain(next);
  next.explanation = buildExplanation(next, now);
  c.header("Cache-Control", cacheable ? "public, max-age=300" : "no-store");
  return c.json(next);
});

objects.get("/:objectId/prediction", async (c) => {
  const id = c.req.param("objectId");
  if (!ID_RE.test(id)) throw badRequest("invalid object_id");
  const obj = await requireStaticJson<ObjectDetail>(c.env, `objects/${id}.json`, `object '${id}'`);
  if (!obj.orbit) throw new ApiError(404, `object '${id}' has no orbit yet, so there is no prediction`);
  const days = Number(c.req.query("days") ?? "30");
  if (!Number.isInteger(days) || days < 1 || days > 60) throw badRequest("days must be an integer from 1 to 60");
  const pred = await requireStaticJson<ObjectPrediction>(c.env, `objects/${id}/prediction.json`, `prediction for '${id}'`);
  const start = pred.points[0]?.mjd ?? 0;
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ ...pred, days, points: pred.points.filter((p) => p.mjd <= start + days) });
});

objects.get("/:objectId/ades.xml", async (c) => {
  const id = c.req.param("objectId");
  if (!ID_RE.test(id)) throw badRequest("invalid object_id");
  throw new ApiError(404, `ADES export for '${id}' is not available yet`);
});

export const survey = new Hono<AppEnv>();

survey.get("/", async (c) => {
  const body = await requireStaticJson<Survey>(c.env, "survey.json", "survey");
  c.header("Cache-Control", "public, max-age=300");
  return c.json(body);
});
