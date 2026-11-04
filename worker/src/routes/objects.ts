import { Hono } from "hono";
import type { AppEnv } from "../app";
import type { Deps, Env } from "../env";
import type {
  CandidateDetail,
  Classification,
  JplOrbitComparison,
  ObjectDetail,
  ObjectList,
  ObjectPrediction,
  ObjectSummary,
  PlanetNineRegion,
  ReportingQueue,
  ReportingStatus,
  Survey,
} from "../contract";
import { notCheckedKnownObject } from "../enrich";
import { ApiError, badRequest } from "../errors";
import { ID_RE, readStaticJson, requireStaticJson } from "../static-data";
import { pageParams, paginate } from "../paging";
import { adesXml } from "../ades";
import { REPORTING_LABELS, REPORTING_STATUSES, applyReporting, summaryStatus } from "../reporting";
import { isFinalMatch, newestRecord, pipelineRecord, readRecord, readRecordsFor, refreshRecord } from "../store";
import { reviewPriority } from "./candidates";
import { buildExplanation, labelPlain, summaryPlain, summaryPlainFrom } from "../text";

export const objects = new Hono<AppEnv>();

/** Objects reuse the JPL result of the candidate they were linked from. */
const refOf = (o: { candidate_ids: string[] }, pipelineVersion: string) => ({
  candidate_id: o.candidate_ids[0] ?? "",
  pipeline_version: pipelineVersion,
});

/** Every object with its stored JPL result applied (one store query). */
export async function enrichedObjects(env: Env, deps: Deps): Promise<{ list: ObjectList; objects: ObjectSummary[] }> {
  const list = await requireStaticJson<ObjectList>(env, "objects.json", "object list");
  // Objects the survey pipeline matched to a known object are final: no store lookup.
  const final = (s: ObjectSummary) => s.known_object_checked && s.known_object_matched;
  const real = list.objects.filter((s) => s.classification !== "injected" && s.candidate_ids.length > 0 && !final(s));
  const recs = await readRecordsFor(
    deps,
    real.map((s) => refOf(s, s.pipeline_version ?? list.pipeline_version)),
  );
  const out = list.objects.map((s): ObjectSummary => {
    if (s.classification === "injected" || s.candidate_ids.length === 0 || final(s)) return s;
    const rec = recs.get(s.candidate_ids[0]!);
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
      reporting_status: summaryStatus(s.reporting_measurements_passed, k) ?? s.reporting_status ?? null,
    };
  });
  return { list, objects: out };
}

/** JPL designations compared without case or spacing differences ("2024 AB1" = "2024  ab1"). */
export const designationKey = (d: string) => d.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The same asteroid seen in several tiles (neighbouring tiles, or the same sky in other weeks)
 * becomes one object per JPL designation. The entry with the most detections stays (ties: the
 * earliest); the others are listed in `also_seen_as` and their fields, candidates, detections
 * and time span are added to it. Unmatched objects are never merged: without a designation
 * there is no evidence that two tracks are the same body.
 */
export function mergeByDesignation(items: ObjectSummary[]): ObjectSummary[] {
  const groups = new Map<string, ObjectSummary[]>();
  for (const o of items) {
    if (!o.known_object_matched || !o.known_object_designation || o.classification === "injected") continue;
    const k = designationKey(o.known_object_designation);
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const merged = new Map<string, ObjectSummary>();
  const dropped = new Set<string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort(
      (a, b) => b.n_detections - a.n_detections || a.first_time_utc.localeCompare(b.first_time_utc) || a.object_id.localeCompare(b.object_id),
    );
    const head = sorted[0]!;
    const rest = sorted.slice(1);
    const first = sorted.map((o) => o.first_time_utc).sort()[0]!;
    const last = sorted.map((o) => o.last_time_utc).sort().at(-1)!;
    const uniq = (xs: string[]) => [...new Set(xs)];
    const n = sorted.reduce((t, o) => t + o.n_detections, 0);
    const arc = Math.round(((Date.parse(last) - Date.parse(first)) / 3_600_000) * 1000) / 1000;
    merged.set(head.object_id, {
      ...head,
      field_ids: uniq(sorted.flatMap((o) => o.field_ids)),
      candidate_ids: uniq(sorted.flatMap((o) => o.candidate_ids)),
      n_detections: n,
      n_visits: sorted.reduce((t, o) => t + o.n_visits, 0),
      first_time_utc: first,
      last_time_utc: last,
      arc_hours: arc,
      summary_plain: `${head.summary_plain} Also seen in ${rest.length} other ${rest.length === 1 ? "tile" : "tiles"}: ${n} detections in all.`,
      also_seen_as: rest.map((o) => o.object_id),
    });
    for (const o of rest) dropped.add(o.object_id);
  }
  return items.filter((o) => !dropped.has(o.object_id)).map((o) => merged.get(o.object_id) ?? o);
}

objects.get("/", async (c) => {
  const paging = pageParams((n) => c.req.query(n));
  const dedupe = c.req.query("dedupe") !== "false";
  const statuses = c.req.queries("reporting_status") ?? [];
  for (const st of statuses) if (!REPORTING_STATUSES.includes(st as ReportingStatus)) throw badRequest(`unknown reporting_status '${st}'`);
  const { list, objects: all } = await enrichedObjects(c.env, c.get("deps"));
  const rows = dedupe ? mergeByDesignation(all) : all;
  // Unexplained first, then weak detections, then known objects; best score first within each.
  rows.sort((a, b) => reviewPriority(a) - reviewPriority(b) || b.overall_score - a.overall_score);
  const page = paginate(statuses.length ? rows.filter((o) => statuses.includes(o.reporting_status ?? "")) : rows, paging);
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ ...list, total: page.total, offset: page.offset, limit: page.limit, next_offset: page.next_offset, objects: page.items });
});

objects.get("/:objectId", async (c) => {
  const id = c.req.param("objectId");
  if (!ID_RE.test(id)) throw badRequest("invalid object_id");
  const { detail, cacheControl } = await loadObject(c.env, c.get("deps"), id);
  c.header("Cache-Control", cacheControl);
  return c.json(detail);
});

/** An object report with the JPL result of its first candidate applied, as the detail route serves it. */
export async function loadObject(
  env: Env,
  deps: Deps,
  id: string,
): Promise<{ detail: ObjectDetail; cacheControl: string; pending: boolean }> {
  const obj = await requireStaticJson<ObjectDetail>(env, `objects/${id}.json`, `object '${id}'`);
  const now = deps.now().toISOString();
  let known = obj.known_object;
  let matched = false;
  let cacheable = true;
  let pending = false;
  let comparison: JplOrbitComparison | null = null;
  if (isFinalMatch(obj.known_object)) {
    matched = true; // identified by the survey pipeline: final
  } else if (obj.classification !== "injected" && obj.candidate_ids.length > 0) {
    const rec = newestRecord(await readRecord(deps, refOf(obj, obj.pipeline_version)), pipelineRecord(obj.known_object));
    if (rec) {
      const k = rec.enrichment.known_object;
      known = { ...k, enrichment: k.enrichment === "pipeline" ? "pipeline" : "cached" };
      matched = rec.enrichment.matched;
      cacheable = rec.status === "checked";
      comparison = rec.orbit_comparison ?? null;
    } else {
      const candId = obj.candidate_ids[0]!;
      deps.waitUntil(
        requireStaticJson<CandidateDetail>(env, `candidates/${candId}.json`, "candidate")
          .then((cand) => refreshRecord(deps, cand, obj.orbit))
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
      pending = true;
    }
  }
  const classification: Classification = matched && obj.classification !== "injected" ? "known_object" : obj.classification;
  const next: ObjectDetail = { ...obj, classification, known_object: known };
  if (next.orbit && comparison) next.orbit = { ...next.orbit, jpl_comparison: comparison };
  next.label_plain = labelPlain(next);
  next.summary_plain = summaryPlain(next);
  next.explanation = buildExplanation(next, now);
  if (obj.reporting !== undefined) next.reporting = applyReporting(obj.reporting, known);
  if (matched && known.designation) {
    const key = designationKey(known.designation);
    const { objects: all } = await enrichedObjects(env, deps);
    next.also_seen_as = all
      .filter((o) => o.object_id !== id && o.known_object_matched && o.known_object_designation && designationKey(o.known_object_designation) === key)
      .map((o) => o.object_id);
  }
  return { detail: next, cacheControl: cacheable ? "public, max-age=300" : "no-store", pending };
}

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
  const deps = c.get("deps");
  const { detail, pending } = await loadObject(c.env, deps, id);
  if (detail.classification === "injected") {
    throw new ApiError(404, `object '${id}' is a simulated (injected) source and is never reported`);
  }
  const xml = adesXml(detail, {
    stationCode: c.env.MPC_STATION_CODE,
    submitter: c.env.ADES_SUBMITTER,
    generatedUtc: deps.now().toISOString(),
  });
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `inline; filename="${id}.ades.xml"`,
      // The JPL result (and so the comments) can change while a lookup is pending.
      "Cache-Control": pending ? "no-store" : "public, max-age=300",
      "X-ADES-Status": c.env.MPC_STATION_CODE ? "draft" : "draft; station code not configured",
    },
  });
});

/**
 * Candidates for reporting: the objects that pass every test, with counts by status and how a
 * submission is made. Nothing is submitted from here (docs/api-contract.md, "ADES export").
 */
export const reporting = new Hono<AppEnv>();

reporting.get("/", async (c) => {
  const { list, objects: all } = await enrichedObjects(c.env, c.get("deps"));
  const rows = mergeByDesignation(all).filter((o) => o.classification !== "injected");
  const counts = { ready: 0, incomplete: 0, not_ready: 0, not_evaluated: 0 };
  for (const o of rows) counts[o.reporting_status ?? "not_evaluated"] += 1;
  const ready = rows.filter((o) => o.reporting_status === "ready");
  c.header("Cache-Control", "public, max-age=60");
  return c.json<ReportingQueue>({
    schema_version: "1.1",
    pipeline_version: list.pipeline_version,
    generated_utc: c.get("deps").now().toISOString(),
    label_plain: REPORTING_LABELS.ready,
    counts,
    objects: ready,
    ades_urls: Object.fromEntries(ready.map((o) => [o.object_id, `/api/objects/${o.object_id}/ades.xml`])),
    submission: {
      automatic: false,
      station_code_configured: Boolean(c.env.MPC_STATION_CODE),
      how_plain:
        "Nothing is submitted automatically. A team member reviews each candidate (images, every test, the JPL check), " +
        "downloads its ADES file, and submits it to the Minor Planet Center under the team's observatory code and contact details.",
    },
  });
});

export const survey = new Hono<AppEnv>();

survey.get("/", async (c) => {
  const survey = await requireStaticJson<Survey>(c.env, "survey.json", "survey");
  // Distinct asteroids among matched objects: the same one seen in several tiles counts once.
  const { objects: all } = await enrichedObjects(c.env, c.get("deps")).catch(() => ({ objects: [] as ObjectSummary[] }));
  const designations = new Set(
    all.filter((o) => o.known_object_matched && o.known_object_designation).map((o) => designationKey(o.known_object_designation!)),
  );
  // The Planet Nine region is published on its own (spherex-px planet-nine) and added here.
  const planetNine = survey.planet_nine ?? (await readStaticJson<PlanetNineRegion>(c.env, "survey/planet_nine.json").catch(() => null));
  const body: Survey = {
    ...survey,
    totals: { ...survey.totals, n_known_objects: designations.size },
    ...(planetNine ? { planet_nine: planetNine } : {}),
  };
  c.header("Cache-Control", "public, max-age=300");
  return c.json(body);
});
