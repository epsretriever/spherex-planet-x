import { Hono } from "hono";
import type { AppEnv } from "../app";
import type { Classification, FieldDetail, FieldList, QualityLevel } from "../contract";
import { ApiError, badRequest } from "../errors";
import { ID_RE, requireStaticJson } from "../static-data";
import { pageParams, paginate } from "../paging";
import { readRecords } from "../store";
import { labelPlain } from "../text";

export const fields = new Hono<AppEnv>();

const STATIC_CACHE = "public, max-age=300";

interface Mover {
  candidate_id: string;
  classification: Classification;
  label_plain: string;
  quality_level: QualityLevel;
  rate_arcsec_per_hr: number | null;
  track: unknown[];
}

fields.get("/", async (c) => {
  const list = await requireStaticJson<FieldList>(c.env, "fields.json", "field list").catch((err) => {
    if (err instanceof ApiError && err.status === 404) {
      throw new ApiError(503, "Static data has not been built: data/fields.json is missing");
    }
    throw err;
  });
  const paging = pageParams((n) => c.req.query(n));
  const origin = c.req.query("origin");
  const items = origin === undefined ? list.fields : list.fields.filter((f) => f.origin === origin);
  const page = paginate(items, paging);
  c.header("Cache-Control", STATIC_CACHE);
  return c.json({ ...list, total: page.total, offset: page.offset, limit: page.limit, next_offset: page.next_offset, fields: page.items });
});

fields.get("/:fieldId", async (c) => {
  const id = c.req.param("fieldId");
  if (!ID_RE.test(id)) throw badRequest("invalid field_id");
  const detail = await requireStaticJson<FieldDetail>(c.env, `fields/${id}.json`, `field '${id}'`);
  const deps = c.get("deps");
  // Movers carry the same JPL-dependent label as the candidate list (stored results only; no
  // upstream calls here).
  const movers = (detail.movers as Mover[] | undefined) ?? [];
  const recs = await readRecords(
    deps,
    detail.pipeline_version,
    movers.filter((m) => m.classification !== "injected").map((m) => m.candidate_id),
  );
  const enriched = movers.map((m): Mover => {
    const rec = m.classification === "injected" ? undefined : recs.get(m.candidate_id);
    if (!rec) return m;
    const classification: Classification = rec.enrichment.matched ? "known_object" : m.classification;
    return { ...m, classification, label_plain: labelPlain({ classification, known_object: rec.enrichment.known_object }) };
  });
  c.header("Cache-Control", "public, max-age=60");
  return c.json(detail.movers === undefined ? detail : { ...detail, movers: enriched });
});
