import { Hono } from "hono";
import type { AppEnv } from "../app";
import type { AiSubjectKind, AskRequest, FieldList, SearchRequest } from "../contract";
import { ensureSchema } from "../db";
import type { Deps, Env } from "../env";
import { ApiError, badRequest } from "../errors";
import { ID_RE, requireStaticJson } from "../static-data";
import { DEFAULT_MODEL, rateLimit, sha256 } from "../ai/core";
import type { Subject } from "../ai/facts";
import { type AiContext, ask, search, templateWriteup, writeup } from "../ai/features";
import { loadCandidate } from "./candidates";
import { loadObject } from "./objects";

/** Per-visitor limits, in calls per hour (fixed windows in D1). */
export const ASK_PER_SESSION_PER_HOUR = 20;
export const ASK_PER_IP_PER_HOUR = 60;
export const SEARCH_PER_IP_PER_HOUR = 60;

async function context(env: Env, deps: Deps): Promise<AiContext> {
  let db = env.DB;
  if (db) {
    try {
      await ensureSchema(db);
    } catch (err) {
      console.error("D1 schema check failed; AI usage caps are off for this request:", err);
      db = undefined;
    }
  }
  return { deps, ai: env.AI, db, model: env.AI_MODEL || DEFAULT_MODEL };
}

async function loadSubject(env: Env, deps: Deps, kind: AiSubjectKind, id: string) {
  if (!ID_RE.test(id)) throw badRequest(`invalid ${kind}_id`);
  return kind === "candidate" ? loadCandidate(env, deps, id) : loadObject(env, deps, id);
}

const visitorKey = async (env: Env, prefix: string, value: string) =>
  `${prefix}:${(await sha256(`${env.HASH_SALT ?? ""}\n${value}`)).slice(0, 32)}`;

async function readBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw badRequest("body must be JSON");
  }
}

function writeupRoute(kind: AiSubjectKind) {
  const app = new Hono<AppEnv>();
  app.get("/:id/writeup", async (c) => {
    const deps = c.get("deps");
    const id = c.req.param("id");
    const { detail, pending } = await loadSubject(c.env, deps, kind, id);
    // While JPL is still being checked, explain only what is measured; the client refetches.
    if (pending) {
      c.header("Cache-Control", "no-store");
      return c.json(templateWriteup(kind, id, detail as Subject, deps.now().toISOString()));
    }
    const out = await writeup(await context(c.env, deps), kind, id, detail as Subject);
    c.header("Cache-Control", out.source === "ai" ? "public, max-age=3600" : "no-store");
    return c.json(out);
  });
  return app;
}

export const candidateWriteups = writeupRoute("candidate");
export const objectWriteups = writeupRoute("object");

export const askRoute = new Hono<AppEnv>();

askRoute.post("/", async (c) => {
  const body = await readBody<Partial<AskRequest>>(c.req.raw);
  const kind = body.subject_kind;
  if (kind !== "candidate" && kind !== "object") throw badRequest("subject_kind must be 'candidate' or 'object'");
  if (typeof body.subject_id !== "string") throw badRequest("subject_id is required");
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 1 || question.length > 500) throw badRequest("question must be 1 to 500 characters");
  const session = typeof body.session_id === "string" ? body.session_id : "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(session)) throw badRequest("session_id must be 8 to 64 letters, digits, '-' or '_'");
  const deps = c.get("deps");
  const { detail, pending } = await loadSubject(c.env, deps, kind, body.subject_id);
  const ctx = await context(c.env, deps);
  const now = deps.now();
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const [okSession, okIp] = await Promise.all([
    rateLimit(ctx.db, await visitorKey(c.env, "ask-s", session), ASK_PER_SESSION_PER_HOUR, 3600, now),
    rateLimit(ctx.db, await visitorKey(c.env, "ask-ip", ip), ASK_PER_IP_PER_HOUR, 3600, now),
  ]);
  if (!okSession || !okIp) {
    c.header("Retry-After", String(3600 - (Math.floor(now.getTime() / 1000) % 3600)));
    throw new ApiError(429, "Too many questions this hour. Please try again later.");
  }
  if (pending) throw new ApiError(409, "JPL's catalog is still being checked for this object. Ask again in a minute.");
  c.header("Cache-Control", "no-store");
  return c.json(await ask(ctx, kind, body.subject_id, detail as Subject, question));
});

export const searchRoute = new Hono<AppEnv>();

searchRoute.post("/", async (c) => {
  const body = await readBody<Partial<SearchRequest>>(c.req.raw);
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 1 || query.length > 300) throw badRequest("query must be 1 to 300 characters");
  const deps = c.get("deps");
  const ctx = await context(c.env, deps);
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const now = deps.now();
  if (!(await rateLimit(ctx.db, await visitorKey(c.env, "search-ip", ip), SEARCH_PER_IP_PER_HOUR, 3600, now))) {
    c.header("Retry-After", String(3600 - (Math.floor(now.getTime() / 1000) % 3600)));
    throw new ApiError(429, "Too many searches this hour. Please try again later.");
  }
  const fields = await requireStaticJson<FieldList>(c.env, "fields.json", "field list");
  c.header("Cache-Control", "no-store");
  return c.json(await search(ctx, query, fields.fields.map((f) => f.field_id), fields.pipeline_version));
});
