import { Hono } from "hono";
import type { FieldDetail, FieldList } from "../contract";
import type { AppEnv } from "../app";
import { ApiError, badRequest } from "../errors";
import { ID_RE, requireStaticJson } from "../static-data";

export const fields = new Hono<AppEnv>();

const STATIC_CACHE = "public, max-age=300";

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
  c.header("Cache-Control", STATIC_CACHE);
  return c.json(detail);
});
