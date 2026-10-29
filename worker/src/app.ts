import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Deps, type Env, defaultDeps } from "./env";
import { ApiError } from "./errors";
import { fields } from "./routes/fields";
import { health } from "./routes/health";

export type AppEnv = { Bindings: Env; Variables: { deps: Deps } };

export function createApp(makeDeps: () => Deps = defaultDeps) {
  const app = new Hono<AppEnv>();

  app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));
  app.use("/api/*", async (c, next) => {
    c.set("deps", makeDeps());
    await next();
  });

  app.route("/api/health", health);
  app.route("/api/fields", fields);

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
