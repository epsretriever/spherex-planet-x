/** Bindings declared in wrangler.toml. */
export interface Env {
  ASSETS: Fetcher;
  /** Global store for JPL known-object results (see store.ts). Optional so local tools run without it. */
  ENRICHMENT?: KVNamespace;
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
  budget: Budget;
  /** Keep work running after the response is sent (ExecutionContext.waitUntil). */
  waitUntil: (work: Promise<unknown>) => void;
  now: () => Date;
}

export const defaultDeps = (env?: Env, ctx?: Pick<ExecutionContext, "waitUntil">): Deps => ({
  fetch: (input, init) => fetch(input, init),
  cache: typeof caches !== "undefined" ? (caches as unknown as { default: CacheLike }).default : null,
  kv: env?.ENRICHMENT ?? null,
  budget: { remaining: SUBREQUEST_BUDGET },
  waitUntil: ctx ? (work) => ctx.waitUntil(work) : (work) => void work.catch(() => undefined),
  now: () => new Date(),
});
