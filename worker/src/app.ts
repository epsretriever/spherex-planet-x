import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Deps, type Env, defaultDeps } from "./env";
import { ApiError } from "./errors";
import { askRoute, candidateWriteups, objectWriteups, searchRoute } from "./routes/ai";
import { candidates } from "./routes/candidates";
import { coverage } from "./routes/coverage";
import { fields } from "./routes/fields";
import { health } from "./routes/health";
import { objects, survey } from "./routes/objects";
import { injection, runs, validation } from "./routes/static-docs";

export type AppEnv = { Bindings: Env; Variables: { deps: Deps } };

export function createApp(makeDeps: (env?: Env, ctx?: Pick<ExecutionContext, "waitUntil">) => Deps = defaultDeps) {
  const app = new Hono<AppEnv>();

  app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));
  app.use("/api/*", async (c, next) => {
    let ctx: Pick<ExecutionContext, "waitUntil"> | undefined;
    try {
      ctx = c.executionCtx;
    } catch {
      ctx = undefined; // no ExecutionContext (unit tests)
    }
    c.set("deps", makeDeps(c.env, ctx));
    await next();
  });

  app.route("/api/health", health);
  app.route("/api/fields", fields);
  app.route("/api/candidates", candidates);
  app.route("/api/injection", injection);
  app.route("/api/coverage", coverage);
  app.route("/api/runs", runs);
  app.route("/api/objects", objects);
  app.route("/api/survey", survey);
  app.route("/api/validation", validation);
  app.route("/api/candidates", candidateWriteups);
  app.route("/api/objects", objectWriteups);
  app.route("/api/ask", askRoute);
  app.route("/api/search", searchRoute);

  app.notFound((c) => c.json(new ApiError(404, `no API route for ${c.req.path}`).toJSON(), 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      if (err.status >= 500) console.error(`${c.req.method} ${c.req.path}: ${err.detail}`);
      return c.json(err.toJSON(), err.status);
    }
    console.error(`${c.req.method} ${c.req.path}:`, err);
    return c.json(new ApiError(500, "internal error").toJSON(), 500);
  });
  return app;
}
