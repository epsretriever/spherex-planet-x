import { Hono } from "hono";
import type { AppEnv } from "../app";
import type { Exclusion } from "../contract";
import { requireStaticJson } from "../static-data";

/** What the survey has ruled out (spherex-px exclusion): static data/survey/exclusion.json. */
export const exclusion = new Hono<AppEnv>();

exclusion.get("/", async (c) => {
  const doc = await requireStaticJson<Exclusion>(c.env, "survey/exclusion.json", "exclusion map");
  c.header("Cache-Control", "public, max-age=300");
  return c.json(doc);
});
