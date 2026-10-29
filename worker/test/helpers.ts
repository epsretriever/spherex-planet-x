import { createApp } from "../src/app";
import type { CacheLike, Deps, Env } from "../src/env";

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

export type FetchHandler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

export function makeClient(opts: { files?: Record<string, unknown>; upstream?: FetchHandler; cache?: MemoryCache } = {}) {
  const calls: string[] = [];
  const cache = opts.cache ?? new MemoryCache();
  const deps: Deps = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      calls.push(url.toString());
      if (!opts.upstream) throw new TypeError("network disabled in tests");
      return opts.upstream(url, init);
    }) as typeof fetch,
    cache,
    now: () => new Date("2026-10-29T12:00:00Z"),
  };
  const app = createApp(() => deps);
  const env: Env = { ASSETS: fakeAssets(opts.files ?? {}) };
  const get = (path: string, init?: RequestInit) => app.request(path, init, env);
  return { app, env, get, calls, cache };
}

export const json = (res: Response): Promise<any> => res.json();
