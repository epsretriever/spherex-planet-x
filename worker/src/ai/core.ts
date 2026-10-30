/**
 * Workers AI calls with caching, a daily usage cap and strict output parsing.
 *
 * Every AI feature follows the same rules (docs/build-plan.md section 6):
 * - the model sees only JSON taken from the subject's report (never images, the web or memory);
 * - its output is parsed as JSON and validated, and every number in it is checked against the
 *   report; anything that fails is replaced by deterministic, template-generated text;
 * - results are cached in KV by a hash of the exact input, so repeated views cost nothing.
 */
import type { Deps } from "../env";

/** Default text model. Override with the AI_MODEL var in wrangler.toml. */
export const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
/** Bump when prompts or post-processing change, so cached outputs are regenerated. */
export const PROMPT_VERSION = "1";

/** Daily call caps per feature, to stay inside the free 10,000 neurons/day allowance. */
export const DAILY_CAPS: Record<AiKind, number> = { writeup: 400, ask: 600, search: 600, digest: 10 };
const CACHE_TTL_S = 30 * 24 * 3600;

export type AiKind = "writeup" | "ask" | "search" | "digest";

export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Message {
  role: "system" | "user";
  content: string;
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Extract the first JSON object from a model response (string, or already-parsed object). */
export function parseJsonResponse(raw: unknown): Record<string, unknown> | null {
  const r = (raw as { response?: unknown } | null)?.response ?? raw;
  if (r && typeof r === "object" && !Array.isArray(r)) return r as Record<string, unknown>;
  if (typeof r !== "string") return null;
  const start = r.indexOf("{");
  const end = r.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(r.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function cacheGet<T>(deps: Deps, key: string): Promise<T | null> {
  if (!deps.kv) return null;
  try {
    return ((await deps.kv.get(key, "json")) as T | null) ?? null;
  } catch {
    return null;
  }
}

export async function cachePut(deps: Deps, key: string, value: unknown): Promise<void> {
  if (!deps.kv) return;
  await deps.kv.put(key, JSON.stringify(value), { expirationTtl: CACHE_TTL_S }).catch(() => undefined);
}

/** Count one call against today's cap. Returns false when the cap is reached. Without D1, no cap. */
export async function takeQuota(db: D1Database | undefined, kind: AiKind, now: Date): Promise<boolean> {
  if (!db) return true;
  const day = now.toISOString().slice(0, 10);
  try {
    const row = await db
      .prepare(
        "INSERT INTO ai_usage (day, kind, calls) VALUES (?, ?, 1) ON CONFLICT (day, kind) DO UPDATE SET calls = calls + 1 RETURNING calls",
      )
      .bind(day, kind)
      .first<{ calls: number }>();
    return (row?.calls ?? 0) <= DAILY_CAPS[kind];
  } catch {
    return true; // a usage-table failure must not take the feature down
  }
}

/** Fixed-window rate limit in D1 (key, e.g. "ask:<hash>"). Returns false when over the limit. */
export async function rateLimit(
  db: D1Database | undefined,
  key: string,
  limit: number,
  windowSeconds: number,
  now: Date,
): Promise<boolean> {
  if (!db) return true;
  const t = Math.floor(now.getTime() / 1000);
  const start = t - (t % windowSeconds);
  try {
    const row = await db
      .prepare(
        "INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) " +
          "ON CONFLICT (key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END, " +
          "window_start = excluded.window_start RETURNING count",
      )
      .bind(key, start)
      .first<{ count: number }>();
    return (row?.count ?? 0) <= limit;
  } catch {
    return true;
  }
}

export interface ModelCall {
  ai: AiBinding | undefined;
  model: string;
  messages: Message[];
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
}

/** Run the model; null when unavailable or the output is not a JSON object. Spends budget. */
export async function runJson(deps: Deps, call: ModelCall): Promise<Record<string, unknown> | null> {
  if (!call.ai) return null;
  if (deps.budget.remaining <= 0) return null;
  deps.budget.remaining -= 1;
  try {
    const input: Record<string, unknown> = {
      messages: call.messages,
      max_tokens: call.maxTokens ?? 700,
      temperature: 0.2,
    };
    if (call.jsonSchema) input.response_format = { type: "json_schema", json_schema: call.jsonSchema };
    return parseJsonResponse(await call.ai.run(call.model, input));
  } catch (err) {
    console.error("Workers AI call failed:", err);
    return null;
  }
}

/** Words an AI answer may never use about our objects (no discovery claims). */
export const FORBIDDEN =
  /\b(discover\w*|new planet|first ever|never (been )?seen before)\b|\b(is|could be|might be|may be|likely|probably|found) (a |the )?(planet x|planet nine|planet 9)\b/i;

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
