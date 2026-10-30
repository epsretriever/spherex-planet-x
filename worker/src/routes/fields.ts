import { Hono } from "hono";
import type { AppEnv } from "../app";
import type { Classification, FieldDetail, FieldList, QualityLevel } from "../contract";
import { ApiError, badRequest } from "../errors";
import { ID_RE, requireStaticJson } from "../static-data";
import { readRecord } from "../store";
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
  c.header("Cache-Control", STATIC_CACHE);
  return c.json(list);
});

fields.get("/:fieldId", async (c) => {
  const id = c.req.param("fieldId");
  if (!ID_RE.test(id)) throw badRequest("invalid field_id");
  const detail = await requireStaticJson<FieldDetail>(c.env, `fields/${id}.json`, `field '${id}'`);
  const deps = c.get("deps");
  // Movers carry the same JPL-dependent label as the candidate list (stored results only; no
  // upstream calls here).
  const movers = (detail.movers as Mover[] | undefined) ?? [];
  const enriched = await Promise.all(
    movers.map(async (m): Promise<Mover> => {
      if (m.classification === "injected") return m;
      const rec = await readRecord(deps, { candidate_id: m.candidate_id, pipeline_version: detail.pipeline_version });
      if (!rec) return m;
      const classification: Classification = rec.enrichment.matched ? "known_object" : m.classification;
      return { ...m, classification, label_plain: labelPlain({ classification, known_object: rec.enrichment.known_object }) };
    }),
  );
  c.header("Cache-Control", "public, max-age=60");
  return c.json(detail.movers === undefined ? detail : { ...detail, movers: enriched });
});
