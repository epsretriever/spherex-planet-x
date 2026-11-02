import { createApp } from "../src/app";
import { type CacheLike, type Deps, type Env, type KvLike, SUBREQUEST_BUDGET } from "../src/env";

/**
 * Fake ASSETS binding. Like the real binding with single-page-application not-found handling,
 * unknown paths answer 200 with index.html.
 */
export function fakeAssets(files: Record<string, unknown>): Fetcher {
  return {
    async fetch(input: RequestInfo | URL): Promise<Response> {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const body = files[url.pathname];
      if (body === undefined) {
        return new Response("<!doctype html><title>app</title>", {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(typeof body === "string" ? body : JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    },
    connect() {
      throw new Error("not supported");
    },
  } as unknown as Fetcher;
}

export class MemoryCache implements CacheLike {
  store = new Map<string, Response>();
  async match(req: Request) {
    return this.store.get(req.url)?.clone();
  }
  async put(req: Request, res: Response) {
    this.store.set(req.url, res.clone());
  }
}

export class MemoryKv implements KvLike {
  store = new Map<string, { value: string; ttl?: number }>();
  async get(key: string) {
    const v = this.store.get(key);
    return v ? JSON.parse(v.value) : null;
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }) {
    this.store.set(key, { value, ttl: options?.expirationTtl });
  }
}

export type FetchHandler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

export function makeClient(
  opts: {
    files?: Record<string, unknown>;
    upstream?: FetchHandler;
    cache?: MemoryCache;
    kv?: MemoryKv | null;
    db?: D1Database | null;
    env?: Partial<Env>;
  } = {},
) {
  const calls: string[] = [];
  const cache = opts.cache ?? new MemoryCache();
  const kv = opts.kv === undefined ? new MemoryKv() : opts.kv;
  const background: Promise<unknown>[] = [];
  const deps: Deps = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      calls.push(url.toString());
      if (!opts.upstream) throw new TypeError("network disabled in tests");
      return opts.upstream(url, init);
    }) as typeof fetch,
    cache,
    kv,
    db: opts.db ?? null,
    budget: { remaining: SUBREQUEST_BUDGET },
    waitUntil: (work) => void background.push(work),
    now: () => new Date("2026-10-29T12:00:00Z"),
  };
  // A fresh budget per request, like a real invocation.
  const app = createApp(() => ({ ...deps, budget: { remaining: SUBREQUEST_BUDGET } }));
  const env: Env = { ASSETS: fakeAssets(opts.files ?? {}), ...(opts.db ? { DB: opts.db } : {}), ...opts.env };
  const get = (path: string, init?: RequestInit) => app.request(path, init, env);
  /** Wait for work started with waitUntil (background JPL lookups). */
  const settle = async () => {
    while (background.length) await Promise.allSettled(background.splice(0));
  };
  return { app, env, get, calls, cache, kv, deps, settle };
}

export const json = (res: Response): Promise<any> => res.json();
