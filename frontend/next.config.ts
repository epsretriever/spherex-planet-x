import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * Production builds are a static export (frontend/out) served by the
 * spherex-planet-x Cloudflare Worker, which also answers /api/* and /static/*.
 * In `next dev` those paths are proxied to `npx wrangler dev` instead.
 */
export default function config(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  const apiTarget = (process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

  return {
    reactStrictMode: true,
    poweredByHeader: false,
    trailingSlash: true,
    // Sky images are small, pre-stretched cutouts; never resample them.
    images: { unoptimized: true },
    ...(dev
      ? {
          // Let /api/fields reach the proxy without a trailing-slash redirect.
          skipTrailingSlashRedirect: true,
          async rewrites() {
            return [
              { source: "/api/:path*", destination: `${apiTarget}/api/:path*` },
              { source: "/static/:path*", destination: `${apiTarget}/static/:path*` },
            ];
          },
        }
      : { output: "export" as const }),
  };
}
