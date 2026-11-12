import { type Context, Hono } from "hono";
import type { AppEnv } from "../app";
import type { AiSubjectKind, AiWriteup, AskRequest, FieldList, ObjectList, SearchRequest, Survey } from "../contract";
import { ensureSchema } from "../db";
import type { Deps, Env } from "../env";
import { ApiError, badRequest } from "../errors";
import { ID_RE, readStaticJson, requireStaticJson } from "../static-data";
import { DEFAULT_MODEL, cacheGet, cachePut, rateLimit, sha256 } from "../ai/core";
import { type GuideTotals, guide } from "../ai/guide";
import {
  LANGUAGES,
  MAX_AUDIO_BYTES,
  SPEECH_LANGUAGES,
  SPEECH_MODEL as SPEECH_MODEL_ID,
  speakClip, speechParts, transcribe, translateWriteup } from "../ai/media";
import type { Subject } from "../ai/facts";
import { type AiContext, ask, search, templateWriteup, writeup } from "../ai/features";
import { loadCandidate } from "./candidates";
import { loadObject } from "./objects";

/** Per-visitor limits, in calls per hour (fixed windows in D1). */
export const ASK_PER_SESSION_PER_HOUR = 20;
export const ASK_PER_IP_PER_HOUR = 60;
export const SEARCH_PER_IP_PER_HOUR = 60;
export const SPEECH_PER_IP_PER_HOUR = 30;
export const SPEECH_CLIPS_PER_IP_PER_HOUR = 180;
export const TRANSCRIBE_PER_IP_PER_HOUR = 30;
export const GUIDE_PER_SESSION_PER_HOUR = 20;
export const GUIDE_PER_IP_PER_HOUR = 60;

function retryAfter(now: Date) {
  return String(3600 - (Math.floor(now.getTime() / 1000) % 3600));
}

/** The write-up language asked for with ?lang=, or "en". Unknown codes are a 400. */
function langParam(raw: string | undefined): string {
  if (raw === undefined || raw === "") return "en";
  if (!LANGUAGES[raw]) throw badRequest(`lang must be one of ${Object.keys(LANGUAGES).join(", ")}`);
  return raw;
}

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
    const lang = langParam(c.req.query("lang"));
    const ctx = await context(c.env, deps);
    const english = await writeup(ctx, kind, id, detail as Subject);
    const out = lang === "en" ? english : await translateWriteup(ctx, english, lang);
    const translated = lang === "en" || (out as { lang?: string }).lang === lang;
    c.header("Cache-Control", english.source === "ai" && translated ? "public, max-age=3600" : "no-store");
    return c.json(out);
  });
  /** The checked text read aloud for ?lang=: the write-up, or its translation (409/503 when unavailable). */
  async function speechText(c: Context<AppEnv>, lang: string) {
    const deps = c.get("deps");
    const id = c.req.param("id")!;
    if (!SPEECH_LANGUAGES.has(lang)) throw badRequest(`read-aloud is available in ${[...SPEECH_LANGUAGES].join(", ")}`);
    const { detail, pending } = await loadSubject(c.env, deps, kind, id);
    if (pending) throw new ApiError(409, "JPL's catalog is still being checked for this object. Try again in a minute.");
    const ctx = await context(c.env, deps);
    const english: AiWriteup = await writeup(ctx, kind, id, detail as Subject);
    const text = lang === "en" ? english : await translateWriteup(ctx, english, lang);
    if (lang !== "en" && (text as { lang?: string }).lang !== lang) {
      throw new ApiError(503, "The translation isn't available right now, so it can't be read aloud.");
    }
    return { ctx, id, parts: speechParts([text.verdict, ...text.paragraphs]) };
  }

  async function limitSpeech(c: Context<AppEnv>, ctx: Awaited<ReturnType<typeof context>>, bucket: string, max: number) {
    const deps = c.get("deps");
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    if (!(await rateLimit(ctx.db, await visitorKey(c.env, bucket, ip), max, 3600, deps.now()))) {
      c.header("Retry-After", retryAfter(deps.now()));
      throw new ApiError(429, "Too many read-aloud requests this hour. Please try again later.");
    }
  }

  // Read-aloud: the URLs of one audio clip per paragraph, made on demand by the route below.
  app.get("/:id/writeup/speech", async (c) => {
    const lang = langParam(c.req.query("lang"));
    const { ctx, id, parts } = await speechText(c, lang);
    if (!ctx.ai) throw new ApiError(503, "Read-aloud isn't available right now.");
    await limitSpeech(c, ctx, "speech-ip", SPEECH_PER_IP_PER_HOUR);
    const base = `/api/${kind === "object" ? "objects" : "candidates"}/${encodeURIComponent(id)}/writeup/speech`;
    const q = lang === "en" ? "" : `?lang=${lang}`;
    c.header("Cache-Control", "no-store");
    return c.json({
      subject_kind: kind,
      subject_id: id,
      lang,
      model: SPEECH_MODEL_ID,
      clips: parts.map((_, i) => `${base}/${i}${q}`),
      cached: false,
    });
  });

  // One paragraph as audio (WAV from MeloTTS), cached in KV and by the browser.
  app.get("/:id/writeup/speech/:n", async (c) => {
    const n = Number(c.req.param("n"));
    if (!Number.isInteger(n) || n < 0) throw badRequest("clip number must be 0 or more");
    const lang = langParam(c.req.query("lang"));
    const { ctx, parts } = await speechText(c, lang);
    if (n >= parts.length) throw new ApiError(404, "No such clip.");
    await limitSpeech(c, ctx, "speech-clip-ip", SPEECH_CLIPS_PER_IP_PER_HOUR);
    const clip = await speakClip(ctx, parts[n]!, lang);
    if (!clip) throw new ApiError(503, "Read-aloud isn't available right now.");
    return new Response(clip.bytes, {
      headers: {
        "Content-Type": clip.type,
        "Content-Length": String(clip.bytes.byteLength),
        "Cache-Control": "public, max-age=86400",
        "X-Cache": clip.cached ? "hit" : "miss",
      },
    });
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

// --------------------------------------------------------------------------- voice input

export const transcribeRoute = new Hono<AppEnv>();

/** POST a short recording (audio/webm, audio/ogg, audio/mp4, audio/mpeg or audio/wav); returns its text. */
transcribeRoute.post("/", async (c) => {
  const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!/^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac|x-m4a)$/.test(type)) throw badRequest("body must be an audio recording");
  const len = Number(c.req.header("content-length") ?? "0");
  if (len > MAX_AUDIO_BYTES) throw new ApiError(413, "Recording is too long. Keep questions under about 30 seconds.");
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) throw badRequest("recording is empty");
  if (bytes.length > MAX_AUDIO_BYTES) throw new ApiError(413, "Recording is too long. Keep questions under about 30 seconds.");
  const deps = c.get("deps");
  const ctx = await context(c.env, deps);
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await rateLimit(ctx.db, await visitorKey(c.env, "stt-ip", ip), TRANSCRIBE_PER_IP_PER_HOUR, 3600, deps.now()))) {
    c.header("Retry-After", retryAfter(deps.now()));
    throw new ApiError(429, "Too many voice questions this hour. Please type your question instead.");
  }
  const lang = c.req.query("lang");
  const out = await transcribe(ctx, bytes, lang && LANGUAGES[lang] ? lang : undefined);
  if (!out) throw new ApiError(422, "Couldn't make out any words. Try again closer to the microphone, or type your question.");
  c.header("Cache-Control", "no-store");
  return c.json(out);
});

// --------------------------------------------------------------------------- site guide

const TOTALS_KEY = "guide:totals:v1";
const TOTALS_TTL_S = 3600;

/** Survey totals the guide may quote, cached for an hour so the big JSON files are read rarely. */
export async function guideTotals(env: Env, deps: Deps): Promise<GuideTotals> {
  const hit = await cacheGet<GuideTotals>(deps, TOTALS_KEY);
  if (hit) return hit;
  const [survey, objects] = await Promise.all([
    readStaticJson<Survey>(env, "survey.json").catch(() => null),
    readStaticJson<ObjectList>(env, "objects.json").catch(() => null),
  ]);
  const t = survey?.totals;
  const totals: GuideTotals = {
    survey_updated_utc: survey?.generated_utc ?? null,
    patches_searched: t?.n_searched ?? null,
    patches_with_data_processed: t?.n_processed ?? null,
    patches_empty: t?.n_empty ?? null,
    patches_failed: t?.n_failed ?? null,
    sky_area_searched_deg2: t?.area_deg2_searched ?? null,
    sky_percent_searched: t?.sky_fraction_searched != null ? Math.round(t.sky_fraction_searched * 10000) / 100 : null,
    images_read: t?.n_epochs ?? null,
    objects_tracked: t?.n_objects ?? null,
    last_run_finished_utc: survey?.last_run?.finished_utc ?? null,
    last_run_patches: survey?.last_run?.n_tiles_processed ?? null,
    last_run_new_objects: survey?.last_run?.n_new_objects ?? null,
  };
  for (const o of objects?.objects ?? []) {
    const k = `objects_${o.classification}`;
    totals[k] = ((totals[k] as number | undefined) ?? 0) + 1;
    if (o.distance_class) {
      const d = `objects_distance_${o.distance_class}`;
      totals[d] = ((totals[d] as number | undefined) ?? 0) + 1;
    }
  }
  if (deps.kv) await deps.kv.put(TOTALS_KEY, JSON.stringify(totals), { expirationTtl: TOTALS_TTL_S }).catch(() => undefined);
  return totals;
}

export const guideRoute = new Hono<AppEnv>();

guideRoute.post("/", async (c) => {
  const body = await readBody<{ question?: unknown; session_id?: unknown }>(c.req.raw);
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 1 || question.length > 500) throw badRequest("question must be 1 to 500 characters");
  const session = typeof body.session_id === "string" ? body.session_id : "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(session)) throw badRequest("session_id must be 8 to 64 letters, digits, '-' or '_'");
  const deps = c.get("deps");
  const ctx = await context(c.env, deps);
  const now = deps.now();
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const [okSession, okIp] = await Promise.all([
    rateLimit(ctx.db, await visitorKey(c.env, "guide-s", session), GUIDE_PER_SESSION_PER_HOUR, 3600, now),
    rateLimit(ctx.db, await visitorKey(c.env, "guide-ip", ip), GUIDE_PER_IP_PER_HOUR, 3600, now),
  ]);
  if (!okSession || !okIp) {
    c.header("Retry-After", retryAfter(now));
    throw new ApiError(429, "Too many questions this hour. Please try again later.");
  }
  const totals = await guideTotals(c.env, deps);
  c.header("Cache-Control", "no-store");
  return c.json(await guide(ctx, question, totals));
});
