/**
 * Requests to search a patch of sky (build plan section 2.6, row 9).
 *
 * A visitor asks for a position; the request waits in D1 (`sky_requests`) until the Sky
 * requests Action (.github/workflows/requests.yml) takes it: it finds the SPHEREx week with the
 * most visits of that position, builds a 0.3° field there with the same pipeline as the survey,
 * publishes it and reports back here. Requests need a Turnstile token and are rate limited per
 * visitor; without the Turnstile secret or D1 nothing is accepted.
 *
 * The Action talks to /api/requests/queue and /api/requests/{id}/status with the bearer token
 * REQUESTS_ADMIN_TOKEN (a Worker secret, and a repository secret of the same name).
 */
import { Hono } from "hono";
import { rateLimit, sha256 } from "../ai/core";
import type { AppEnv } from "../app";
import type { SkyRequest, SkyRequestStatus } from "../contract";
import { ensureSchema } from "../db";
import type { Env } from "../env";
import { ApiError, badRequest } from "../errors";
import { ID_RE } from "../static-data";
import { SCHEMA_VERSION, workerVersion } from "../version";

export const REQUESTS_PER_IP_PER_DAY = 5;
export const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const STATUSES: readonly SkyRequestStatus[] = ["queued", "processing", "done", "no_coverage", "rejected"];

interface Row {
  request_id: string;
  ra_deg: number;
  dec_deg: number;
  note: string | null;
  status: SkyRequestStatus;
  field_id: string | null;
  message: string | null;
  created_utc: string;
  updated_utc: string;
}

async function database(env: Env): Promise<D1Database> {
  if (!env.DB) throw new ApiError(503, "sky requests are not available: no database is configured");
  await ensureSchema(env.DB);
  return env.DB;
}

async function position(db: D1Database, row: Row): Promise<number | null> {
  if (row.status !== "queued") return null;
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM sky_requests WHERE status = 'queued' AND created_utc < ?")
    .bind(row.created_utc)
    .first<{ n: number }>();
  return (r?.n ?? 0) + 1;
}

async function view(db: D1Database, row: Row): Promise<SkyRequest> {
  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: workerVersion(),
    request_id: row.request_id,
    status: row.status,
    ra_deg: row.ra_deg,
    dec_deg: row.dec_deg,
    created_utc: row.created_utc,
    updated_utc: row.updated_utc,
    position_in_queue: await position(db, row),
    field_id: row.field_id,
    message: row.message,
  };
}

async function verifyTurnstile(env: Env, fetcher: typeof fetch, token: string, ip: string): Promise<boolean> {
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET ?? "");
  form.set("response", token);
  if (ip !== "unknown") form.set("remoteip", ip);
  try {
    const res = await fetcher(TURNSTILE_VERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(10_000) });
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  } catch {
    return false;
  }
}

function requireAdmin(env: Env, header: string | undefined) {
  const want = env.REQUESTS_ADMIN_TOKEN;
  if (!want) throw new ApiError(503, "request processing is not configured");
  if (header !== `Bearer ${want}`) throw new ApiError(401, "a valid bearer token is required");
}

export const requests = new Hono<AppEnv>();

requests.post("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    throw badRequest("body must be JSON");
  }
  const ra = Number(body.ra_deg);
  const dec = Number(body.dec_deg);
  if (!(typeof body.ra_deg === "number" && Number.isFinite(ra) && ra >= 0 && ra < 360)) throw badRequest("ra_deg must be a number in [0, 360)");
  if (!(typeof body.dec_deg === "number" && Number.isFinite(dec) && dec >= -90 && dec <= 90)) throw badRequest("dec_deg must be a number in [-90, 90]");
  const note = body.note === undefined || body.note === null ? null : String(body.note).trim();
  if (note !== null && note.length > 200) throw badRequest("note must be at most 200 characters");
  const token = typeof body.turnstile_token === "string" ? body.turnstile_token : "";
  if (!token || token.length > 2048) throw badRequest("turnstile_token is required");
  if (!c.env.TURNSTILE_SECRET) throw new ApiError(503, "sky requests are not available: bot protection is not configured");
  const db = await database(c.env);
  const deps = c.get("deps");
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const client = (await sha256(`${c.env.HASH_SALT ?? ""}\n${ip}`)).slice(0, 32);
  if (!(await verifyTurnstile(c.env, deps.fetch, token, ip))) throw new ApiError(403, "the bot check failed; reload the page and try again");
  if (!(await rateLimit(db, `requests:${client}`, REQUESTS_PER_IP_PER_DAY, 86_400, deps.now()))) {
    throw new ApiError(429, `at most ${REQUESTS_PER_IP_PER_DAY} requests a day from one connection`);
  }
  const now = deps.now().toISOString();
  const id = `req-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await db
    .prepare(
      "INSERT INTO sky_requests (request_id, ra_deg, dec_deg, note, status, client_hash, created_utc, updated_utc) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)",
    )
    .bind(id, Math.round(ra * 1e6) / 1e6, Math.round(dec * 1e6) / 1e6, note, client, now, now)
    .run();
  const row = await db.prepare("SELECT * FROM sky_requests WHERE request_id = ?").bind(id).first<Row>();
  c.header("Cache-Control", "no-store");
  return c.json(await view(db, row!), 201);
});

/** Queued requests, oldest first, for the Sky requests Action. */
requests.get("/queue", async (c) => {
  requireAdmin(c.env, c.req.header("Authorization"));
  const db = await database(c.env);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "10") || 10, 1), 50);
  const { results } = await db
    .prepare("SELECT * FROM sky_requests WHERE status = 'queued' ORDER BY created_utc LIMIT ?")
    .bind(limit)
    .all<Row>();
  c.header("Cache-Control", "no-store");
  return c.json({ requests: await Promise.all(results.map((r) => view(db, r))) });
});

/** Status updates from the Sky requests Action. */
requests.post("/:requestId/status", async (c) => {
  requireAdmin(c.env, c.req.header("Authorization"));
  const id = c.req.param("requestId");
  if (!ID_RE.test(id)) throw badRequest("invalid request_id");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = body.status as SkyRequestStatus;
  if (!STATUSES.includes(status) || status === "queued") throw badRequest("status must be processing, done, no_coverage or rejected");
  const fieldId = typeof body.field_id === "string" ? body.field_id : null;
  if (status === "done" && !(fieldId && ID_RE.test(fieldId))) throw badRequest("a done request needs field_id");
  const message = typeof body.message === "string" ? body.message.slice(0, 500) : null;
  const db = await database(c.env);
  const now = c.get("deps").now().toISOString();
  const exists = await db.prepare("SELECT 1 AS x FROM sky_requests WHERE request_id = ?").bind(id).first();
  if (!exists) throw new ApiError(404, `request '${id}' not found`);
  await db
    .prepare("UPDATE sky_requests SET status = ?, field_id = ?, message = ?, updated_utc = ? WHERE request_id = ?")
    .bind(status, status === "done" ? fieldId : null, message, now, id)
    .run();
  const row = await db.prepare("SELECT * FROM sky_requests WHERE request_id = ?").bind(id).first<Row>();
  c.header("Cache-Control", "no-store");
  return c.json(await view(db, row!));
});

requests.get("/:requestId", async (c) => {
  const id = c.req.param("requestId");
  if (!ID_RE.test(id)) throw badRequest("invalid request_id");
  const db = await database(c.env);
  const row = await db.prepare("SELECT * FROM sky_requests WHERE request_id = ?").bind(id).first<Row>();
  if (!row) throw new ApiError(404, `request '${id}' not found`);
  c.header("Cache-Control", "no-store");
  return c.json(await view(db, row));
});
