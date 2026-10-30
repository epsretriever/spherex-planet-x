import { Hono } from "hono";
import type { AppEnv } from "../app";
import type { RunStatus } from "../contract";
import { ApiError, badRequest } from "../errors";
import { ID_RE, requireStaticJson } from "../static-data";

export const injection = new Hono<AppEnv>();

injection.get("/:studyId", async (c) => {
  const id = c.req.param("studyId");
  if (!ID_RE.test(id)) throw badRequest("invalid study_id");
  const study = await requireStaticJson<unknown>(c.env, `injection/${id}.json`, `injection study '${id}'`);
  c.header("Cache-Control", "public, max-age=300");
  return c.json(study);
});

export const runs = new Hono<AppEnv>();

runs.post("/", () => {
  throw new ApiError(
    501,
    "Runs cannot be processed inside the Worker: pixel processing needs more CPU than a Worker " +
      "allows. Build the position offline with `spherex-px run --ra <deg> --dec <deg>` " +
      "(see pipeline/README.md); the result is published with the site's static data.",
  );
});

runs.get("/:runId", async (c) => {
  const id = c.req.param("runId");
  if (!ID_RE.test(id)) throw badRequest("invalid run_id");
  const run = await requireStaticJson<RunStatus>(c.env, `runs/${id}.json`, `run '${id}'`);
  c.header("Cache-Control", "public, max-age=300");
  return c.json(run);
});

