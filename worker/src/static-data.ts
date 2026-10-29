import { ApiError } from "./errors";
import type { Env } from "./env";

const ASSET_ORIGIN = "https://assets.local";

/** Valid ids for fields, candidates, studies and runs (also blocks path traversal). */
export const ID_RE = /^[a-z0-9][a-z0-9._-]{0,95}$/;

/**
 * Read a JSON file the pipeline published under frontend/public/data (served at /data/...).
 * Returns null when the file does not exist. With single-page-application not-found handling
 * the assets binding answers unknown paths with index.html, so a non-JSON body also means
 * "not found".
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
