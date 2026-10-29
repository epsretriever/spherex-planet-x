/** Bindings declared in wrangler.toml. */
export interface Env {
  ASSETS: Fetcher;
}

/** Minimal cache interface (caches.default in production, an in-memory fake in tests). */
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/** Runtime dependencies, injectable for tests. */
export interface Deps {
  fetch: typeof fetch;
  cache: CacheLike | null;
  now: () => Date;
}

export const defaultDeps = (): Deps => ({
  fetch: (input, init) => fetch(input, init),
  cache: typeof caches !== "undefined" ? (caches as unknown as { default: CacheLike }).default : null,
  now: () => new Date(),
});
