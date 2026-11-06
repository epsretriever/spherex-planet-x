/** Bindings declared in wrangler.toml. */
export interface Env {
  ASSETS: Fetcher;
  /** Global store for JPL known-object results (see store.ts). Optional so local tools run without it. */
  ENRICHMENT?: KVNamespace;
  /** D1 database (see db.ts and migrations/). Optional so local tools run without it. */
  DB?: D1Database;
  /** Workers AI (see ai/). Optional: without it every AI feature falls back to deterministic text. */
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  /** Text model id for Workers AI; defaults to ai/core.ts DEFAULT_MODEL. */
  AI_MODEL?: string;
  /** Salt for hashing visitor session ids and IP addresses before they are stored. */
  HASH_SALT?: string;
  /** Cloudflare Turnstile secret; sky requests are refused without it. */
  TURNSTILE_SECRET?: string;
  /** Bearer token for the Sky requests Action (/api/requests/queue and /status). */
  REQUESTS_ADMIN_TOKEN?: string;
}

/** Minimal cache interface (caches.default in production, an in-memory fake in tests). */
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** Minimal KV interface (the ENRICHMENT binding in production, an in-memory fake in tests). */
export interface KvLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * Upstream calls this invocation may still make. A Worker on the free plan may make only 50
 * subrequests per invocation; we keep a margin for static-asset reads.
 */
export interface Budget {
  remaining: number;
}

export const SUBREQUEST_BUDGET = 40;

/** Runtime dependencies, injectable for tests. */
export interface Deps {
  fetch: typeof fetch;
  cache: CacheLike | null;
  kv: KvLike | null;
  /** D1 (the DB binding): JPL results and locks (store.ts). Null in local tools without D1. */
  db: D1Database | null;
  budget: Budget;
  /** Keep work running after the response is sent (ExecutionContext.waitUntil). */
  waitUntil: (work: Promise<unknown>) => void;
  now: () => Date;
}

export const defaultDeps = (env?: Env, ctx?: Pick<ExecutionContext, "waitUntil">): Deps => ({
  fetch: (input, init) => fetch(input, init),
  cache: typeof caches !== "undefined" ? (caches as unknown as { default: CacheLike }).default : null,
  kv: env?.ENRICHMENT ?? null,
  db: env?.DB ?? null,
  budget: { remaining: SUBREQUEST_BUDGET },
  waitUntil: ctx ? (work) => ctx.waitUntil(work) : (work) => void work.catch(() => undefined),
  now: () => new Date(),
});
