/**
 * Live run of the precovery search against the real JPL and IRSA services. Skipped unless
 * FIND_LIVE=1 (it needs the network); run by .github/workflows/find-validation.yml.
 *
 * 1. Records every upstream request and answer for a few searches into
 *    test/fixtures/find/*.json; find.test.ts replays them offline.
 * 2. Validation: for objects in our catalog that JPL identified (read from the production
 *    API), checks that /api/find lists the SPHEREx frames our pipeline detected them in, and
 *    writes the match rate to docs/find-validation.json and docs/find-validation.md.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { type Deps, type Env, SUBREQUEST_BUDGET } from "../src/env";
import type { FindResult } from "../src/find/contract";

const LIVE = process.env.FIND_LIVE === "1";
const PROD = process.env.FIND_PROD_API ?? "https://spherex-planet-x.bodhishanbhag.workers.dev";
const N_VALIDATE = Number(process.env.FIND_N_VALIDATE ?? 20);
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const DATA = join(repo, "frontend", "public", "data");

/** ASSETS binding that reads the committed static data from disk. */
const diskAssets = {
  async fetch(input: RequestInfo | URL): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = join(repo, "frontend", "public", decodeURIComponent(url.pathname));
    if (!path.startsWith(DATA) || !existsSync(path)) return new Response("not found", { status: 404 });
    return new Response(readFileSync(path), { headers: { "content-type": "application/json" } });
  },
  connect() {
    throw new Error("not supported");
  },
} as unknown as Fetcher;

export interface RecordedCall {
  method: string;
  url: string;
  form: string | null;
  status: number;
  content_type: string;
  body: string;
}

function liveClient(now: Date) {
  const calls: RecordedCall[] = [];
  const deps: Deps = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const res = await fetch(url, init);
      const body = await res.text();
      calls.push({
        method: init?.method ?? "GET",
        url,
        form: typeof init?.body === "string" ? init.body : null,
        status: res.status,
        content_type: res.headers.get("content-type") ?? "",
        body,
      });
      return new Response(body, { status: res.status, headers: res.headers });
    }) as typeof fetch,
    cache: null,
    kv: null,
    db: null,
    budget: { remaining: SUBREQUEST_BUDGET },
    waitUntil: (w) => void w.catch(() => undefined),
    now: () => now,
  };
  const app = createApp(() => ({ ...deps, budget: { remaining: SUBREQUEST_BUDGET } }));
  const env: Env = { ASSETS: diskAssets };
  return { calls, get: (path: string) => app.request(path, undefined, env) };
}

/** SBIdent-style name -> what a visitor would type ("433 Eros (A898 PA)" -> "433"). */
export function queryFor(designation: string): string {
  const t = designation.trim().replace(/^\((.*)\)$/, "$1");
  const n = /^(\d+)(\s|$)/.exec(t);
  if (n) return n[1]!;
  return t.replace(/\s+\([^)]*\)\s*$/, "").trim();
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { "User-Agent": "spherex-planet-x find validation", Accept: "application/json" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

interface ProdSummary {
  object_id: string;
  classification: string;
  known_object_matched: boolean;
  known_object_designation: string | null;
  n_detections: number;
}

describe.skipIf(!LIVE)("live precovery search", () => {
  it(
    "records fixtures and validates against our JPL-identified objects",
    async () => {
      const now = new Date();
      const list = await getJson<{ objects: ProdSummary[] }>(`${PROD}/api/objects?dedupe=false`);
      const groups = new Map<string, ProdSummary[]>();
      for (const o of list.objects) {
        if (!o.known_object_matched || !o.known_object_designation || o.classification === "injected") continue;
        const q = queryFor(o.known_object_designation);
        groups.set(q, [...(groups.get(q) ?? []), o]);
      }
      // Deterministic sample: most detections first, then by name.
      const picked = [...groups.entries()]
        .sort((a, b) => b[1].reduce((t, o) => t + o.n_detections, 0) - a[1].reduce((t, o) => t + o.n_detections, 0) || a[0].localeCompare(b[0]))
        .slice(0, N_VALIDATE);
      console.log(`production lists ${groups.size} JPL-identified bodies; validating ${picked.length}`);

      const rows: Record<string, unknown>[] = [];
      const recordable: { q: string; size: number; json: string }[] = [];
      let totalPipeline = 0;
      let totalRecovered = 0;
      for (const [q, objs] of picked) {
        const pipelineFrames = new Map<string, string>();
        for (const o of objs) {
          const d = await getJson<{ detections: { obs_id: string; time_utc: string; source: { detector: number } }[] }>(
            `${PROD}/api/objects/${encodeURIComponent(o.object_id)}`,
          );
          for (const x of d.detections) pipelineFrames.set(`${x.obs_id}D${x.source.detector}`, x.time_utc);
        }
        const client = liveClient(now);
        const t0 = Date.now();
        const res = await client.get(`/api/find?q=${encodeURIComponent(q)}`);
        const ms = Date.now() - t0;
        const body = (await res.json()) as FindResult & { detail?: string };
        const found = new Set((body.frames ?? []).map((f) => f.frame_id));
        const missing = [...pipelineFrames.keys()].filter((k) => !found.has(k));
        const recovered = pipelineFrames.size - missing.length;
        totalPipeline += pipelineFrames.size;
        totalRecovered += res.ok ? recovered : 0;
        const row = {
          query: q,
          object_ids: objs.map((o) => o.object_id),
          http_status: res.status,
          status: body.status ?? null,
          error: res.ok ? null : (body.detail ?? null),
          pipeline_frames: pipelineFrames.size,
          recovered: res.ok ? recovered : 0,
          find_frames: body.n_frames ?? 0,
          find_visits: body.n_visits ?? 0,
          complete: body.search?.complete ?? null,
          upstream_calls: client.calls.length,
          seconds: Math.round(ms / 100) / 10,
          missing: missing.slice(0, 10).map((k) => ({ frame_id: k, time_utc: pipelineFrames.get(k) })),
          notes: body.search?.notes ?? [],
        };
        rows.push(row);
        console.log(JSON.stringify(row));
        if (res.ok) {
          const size = client.calls.reduce((t, c) => t + c.body.length, 0);
          recordable.push({ q, size, json: `${JSON.stringify({ recorded_utc: now.toISOString(), query: q, calls: client.calls, response: body }, null, 1)}\n` });
        }
      }
      // The two smallest complete searches become offline fixtures.
      const dir = join(here, "fixtures", "find");
      mkdirSync(dir, { recursive: true });
      for (const r of recordable.sort((a, b) => a.size - b.size).slice(0, 2)) {
        writeFileSync(join(dir, `${r.q.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase()}.json`), r.json);
      }
      // A name SBDB doesn't know, for the not-found path.
      {
        const client = liveClient(now);
        const res = await client.get(`/api/find?q=${encodeURIComponent("Notaname Zzq")}`);
        const body = await res.json();
        writeFileSync(
          join(here, "fixtures", "find", "not_found.json"),
          `${JSON.stringify({ recorded_utc: now.toISOString(), query: "Notaname Zzq", http_status: res.status, calls: client.calls, response: body }, null, 1)}\n`,
        );
      }
      const ok = rows.filter((r) => r.http_status === 200);
      const summary = {
        generated_utc: now.toISOString(),
        production_api: PROD,
        n_bodies_in_catalog: groups.size,
        n_validated: rows.length,
        n_answered: ok.length,
        pipeline_frames: totalPipeline,
        recovered_frames: totalRecovered,
        match_rate: totalPipeline ? Math.round((totalRecovered / totalPipeline) * 1000) / 1000 : null,
        bodies_fully_recovered: rows.filter((r) => r.http_status === 200 && r.recovered === r.pipeline_frames).length,
        median_seconds: [...ok.map((r) => r.seconds as number)].sort((a, b) => a - b)[ok.length >> 1] ?? null,
        rows,
      };
      writeFileSync(join(repo, "docs", "find-validation.json"), `${JSON.stringify(summary, null, 2)}\n`);
      const md = [
        "# Precovery search validation",
        "",
        `Generated ${summary.generated_utc} by \`worker/test/find.live.test.ts\` (\`.github/workflows/find-validation.yml\`).`,
        "",
        `For ${rows.length} bodies JPL identified in our catalog (the ones with the most detections, from ${PROD}/api/objects), ` +
          "the Worker's `/api/find` was run against the live JPL and IRSA services and its frames compared with the SPHEREx frames (exposure + detector) our pipeline detected each body in.",
        "",
        `- Frames recovered: **${totalRecovered} of ${totalPipeline}** (match rate ${summary.match_rate === null ? "n/a" : `${(summary.match_rate * 100).toFixed(1)}%`})`,
        `- Bodies with every detected frame recovered: ${summary.bodies_fully_recovered} of ${rows.length}`,
        `- Searches that answered: ${ok.length} of ${rows.length}; median time ${summary.median_seconds ?? "n/a"} s`,
        "",
        "| Query | Pipeline frames | Recovered | /api/find frames | Visits | Complete | Seconds | Error |",
        "|---|---:|---:|---:|---:|---|---:|---|",
        ...rows.map(
          (r) =>
            `| ${r.query} | ${r.pipeline_frames} | ${r.recovered} | ${r.find_frames} | ${r.find_visits} | ${r.complete} | ${r.seconds} | ${r.error ?? ""} |`,
        ),
        "",
      ].join("\n");
      writeFileSync(join(repo, "docs", "find-validation.md"), md);
      console.log(md);
      expect(rows.length).toBeGreaterThan(0);
    },
    60 * 60 * 1000,
  );
});
