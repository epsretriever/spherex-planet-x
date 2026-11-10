import { Hono } from "hono";
import type { AppEnv } from "../app";
import type { CompositionValidation, ObjectComposition } from "../contract";
import { badRequest } from "../errors";
import { ID_RE, requireStaticJson } from "../static-data";

/**
 * "What is it made of?" (static, from `spherex-px composition` / `composition-validate`).
 * - /api/objects/:objectId/composition: the object's indicative composition from its colors.
 * - /api/validation/composition: agreement with published taxonomies of JPL-identified objects.
 * Mounted before the objects and validation routers, so their catch-alls never shadow these.
 */
export const composition = new Hono<AppEnv>();

composition.get("/objects/:objectId/composition", async (c) => {
  const id = c.req.param("objectId");
  if (!ID_RE.test(id)) throw badRequest("invalid object_id");
  const doc = await requireStaticJson<ObjectComposition>(c.env, `objects/${id}/composition.json`, `composition for '${id}'`);
  c.header("Cache-Control", "public, max-age=300");
  return c.json(doc);
});

composition.get("/validation/composition", async (c) => {
  const doc = await requireStaticJson<CompositionValidation>(c.env, "validation/composition.json", "composition validation");
  c.header("Cache-Control", "public, max-age=300");
  return c.json(doc);
});
