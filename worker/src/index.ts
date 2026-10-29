import { createApp } from "./app";

// Requests outside /api/* never reach this Worker: wrangler.toml routes them to static assets
// (frontend/out) with single-page-application fallback.
export default createApp();
