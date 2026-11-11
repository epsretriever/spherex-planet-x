// Worker static assets: what `wrangler deploy` uploads from frontend/out, and the extra files
// left out of deployed builds so they fit Cloudflare's file limit.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ignore from "ignore";

/** Cloudflare's per-version static asset file limit on the Workers Free plan. */
export const MAX_WORKER_ASSETS = 20_000;

/**
 * Left out of deployed Worker builds only (local `wrangler dev`, the screenshot tests and
 * Lighthouse keep them). Every survey run adds about 2,000 sky images; the API returns their
 * /data/... URLs and the live site (Vercel) serves frontend/public itself, so the Worker never
 * reads them. On the workers.dev host these images 404; use the Vercel site for pages.
 */
export const DEPLOY_ONLY_IGNORES = ["data/**/*.webp", "data/**/*.png"];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile()) yield p;
  }
}

/** Patterns from dir/.assetsignore plus wrangler's own defaults. */
function readIgnores(dir) {
  const file = join(dir, ".assetsignore");
  const own = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  return ["/.assetsignore", "/_redirects", "/_headers", ...own];
}

/** Count the files a deployed build uploads (its .assetsignore plus DEPLOY_ONLY_IGNORES). */
export function countUploadedAssets(dir, extra = DEPLOY_ONLY_IGNORES) {
  const ig = ignore().add([...readIgnores(dir), ...extra]);
  let uploaded = 0;
  let ignored = 0;
  for (const p of walk(dir)) {
    if (ig.ignores(relative(dir, p).split(sep).join("/"))) ignored++;
    else uploaded++;
  }
  return { uploaded, ignored };
}

/** Add DEPLOY_ONLY_IGNORES to dir/.assetsignore (deployed builds only). */
export function addDeployIgnores(dir) {
  const lines = ["", "# Added by scripts/build.mjs for deployed builds (scripts/asset-count.mjs).", ...DEPLOY_ONLY_IGNORES, ""];
  appendFileSync(join(dir, ".assetsignore"), lines.join("\n"));
}
