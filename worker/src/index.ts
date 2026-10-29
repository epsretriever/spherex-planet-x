import { createApp } from "./app";
import { type Env, defaultDeps } from "./env";
import { refreshStale } from "./scheduled";

// Requests outside /api/* never reach this Worker: wrangler.toml routes them to static assets
// (frontend/out) with single-page-application fallback.
const app = createApp();

export default {
  fetch: app.fetch,
  /** Cron Trigger: keep JPL known-object results fresh (see scheduled.ts). */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const report = await refreshStale(env, defaultDeps(env, ctx));
    console.log(`scheduled enrichment: ${JSON.stringify(report)}`);
  },
} satisfies ExportedHandler<Env>;
