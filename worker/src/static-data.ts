import { ApiError } from "./errors";
import type { Env } from "./env";

const ASSET_ORIGIN = "https://assets.local";

/** Valid ids for fields, candidates, studies and runs (also blocks path traversal). */
export const ID_RE = /^[a-z0-9][a-z0-9._-]{0,95}$/;

/**
 * Read a JSON file the pipeline published under frontend/public/data (served at /data/...).
 * Returns null when the file does not exist: the assets binding answers 404 (with the site's
 * 404 page). A non-JSON body is also treated as "not found", so this stays correct if the
 * not-found handling ever changes to serve HTML with 200.
 */
export async function readStaticJson<T>(env: Env, path: string): Promise<T | null> {
  const res = await env.ASSETS.fetch(new Request(`${ASSET_ORIGIN}/data/${path}`));
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(500, `static data /data/${path}: HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) return null;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(500, `static data /data/${path} is not valid JSON`);
  }
}

export async function requireStaticJson<T>(env: Env, path: string, what: string): Promise<T> {
  const data = await readStaticJson<T>(env, path);
  if (data === null) throw new ApiError(404, `${what} not found`);
  return data;
}
