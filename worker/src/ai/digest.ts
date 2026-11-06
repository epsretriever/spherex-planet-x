/**
 * Daily digest (build plan section 6.4, row 11): two or three sentences on the latest survey run
 * and the totals, for the home page feed.
 *
 * Written by Workers AI from the run ledger only, checked like every AI output (JSON shape,
 * every number must be a value in the facts, no discovery language, no "new"), and replaced by
 * a deterministic template when any check fails, the daily cap (10) is reached or there is no AI
 * binding. One digest per UTC day and ledger state, cached.
 */
import type { Digest, Survey } from "../contract";
import { checkNumbers } from "../text";
import { SCHEMA_VERSION } from "../version";
import { FORBIDDEN, PROMPT_VERSION, cacheGet, cachePut, runJson, sha256, strings, takeQuota } from "./core";
import type { AiContext } from "./features";

const MAX_TEXT = 600;
/** Words the digest may not use about objects: we never call an object new. */
const NO_NEW = /\bnew(ly)?\b/i;

export const DIGEST_SYSTEM = `You write a short daily update for the public about an automated search of NASA SPHEREx infrared images for moving objects (asteroids and comets).
Rules:
- Use ONLY the JSON facts you are given. Every number you write must appear in the facts (you may round it). Do not compute new numbers.
- Never say "new", "discovered", "discovery" or "Planet X". Objects are "found", "tracked" or "identified as known asteroids".
- Short, plain sentences.
Return JSON only: {"text": string (2 or 3 sentences), "grounded_fields": [string]}.
grounded_fields lists the JSON paths (dot notation, e.g. "last_run.n_tiles_processed") of every value you used.`;

export interface DigestFacts {
  date: string;
  last_run: {
    run_id: string;
    finished_date: string;
    n_tiles_processed: number;
    n_tiles_with_movers: number | null;
    n_candidates: number | null;
    n_segments: number;
  } | null;
  totals: {
    n_objects: number;
    n_known_objects: number | null;
    n_searched: number;
    area_deg2_searched: number;
  };
}

export function digestFacts(survey: Survey, nKnown: number | null, date: string): DigestFacts {
  const r = survey.last_run;
  return {
    date,
    last_run: r
      ? {
          run_id: r.run_id,
          finished_date: r.finished_utc.slice(0, 10),
          n_tiles_processed: r.n_tiles_processed,
          n_tiles_with_movers: r.n_tiles_with_movers ?? null,
          n_candidates: r.n_candidates ?? null,
          n_segments: r.segments?.length ?? 0,
        }
      : null,
    totals: {
      n_objects: survey.totals.n_objects,
      n_known_objects: nKnown,
      n_searched: survey.totals.n_searched ?? survey.totals.n_processed,
      area_deg2_searched: survey.totals.area_deg2_searched ?? survey.totals.area_deg2_processed,
    },
  };
}

/** The deterministic digest: every number is a cited fact. */
export function templateDigest(f: DigestFacts, pipelineVersion: string, now: string): Digest {
  const parts: string[] = [];
  const paths: string[] = [];
  if (f.last_run) {
    const r = f.last_run;
    let s = `The latest survey run, finished on ${r.finished_date}, searched ${r.n_tiles_processed} patches of sky from ${r.n_segments} weeks of SPHEREx observations`;
    paths.push("last_run.finished_date", "last_run.n_tiles_processed", "last_run.n_segments");
    if (r.n_candidates !== null && r.n_tiles_with_movers !== null) {
      s += ` and found ${r.n_candidates} moving ${r.n_candidates === 1 ? "object" : "objects"} in ${r.n_tiles_with_movers} of them`;
      paths.push("last_run.n_candidates", "last_run.n_tiles_with_movers");
    }
    parts.push(`${s}.`);
  }
  const t = f.totals;
  let s = `In all, ${t.n_objects} moving objects are tracked across ${t.n_searched} patches (${t.area_deg2_searched} square degrees)`;
  paths.push("totals.n_objects", "totals.n_searched", "totals.area_deg2_searched");
  if (t.n_known_objects !== null) {
    s += `, and JPL's catalog identifies ${t.n_known_objects} of them as known asteroids or comets`;
    paths.push("totals.n_known_objects");
  }
  parts.push(`${s}.`);
  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: pipelineVersion,
    date: f.date,
    text: parts.join(" "),
    grounded_fields: paths,
    numeric_check: "passed",
    run_id: f.last_run?.run_id ?? null,
    model: null,
    generated_utc: now,
  };
}

export async function digest(ctx: AiContext, survey: Survey, nKnown: number | null): Promise<Digest & { source: "ai" | "template" }> {
  const now = ctx.deps.now().toISOString();
  const f = digestFacts(survey, nKnown, now.slice(0, 10));
  const input = JSON.stringify(f);
  const key = `ai:v${PROMPT_VERSION}:digest:${await sha256(`${ctx.model}\n${input}`)}`;
  const hit = await cacheGet<Digest & { source: "ai" }>(ctx.deps, key);
  if (hit) return hit;
  const fallback = (reason: string) => {
    console.warn(`digest: template (${reason})`);
    return { ...templateDigest(f, survey.pipeline_version, now), source: "template" as const };
  };
  if (!ctx.ai) return fallback("no_ai_binding");
  if (!(await takeQuota(ctx.db, "digest", ctx.deps.now()))) return fallback("daily_cap");
  const out = await runJson(ctx.deps, {
    ai: ctx.ai,
    model: ctx.model,
    messages: [
      { role: "system", content: DIGEST_SYSTEM },
      { role: "user", content: `Facts (JSON):\n${input}` },
    ],
  });
  const text = typeof out?.text === "string" ? out.text.trim() : "";
  const paths = strings(out?.grounded_fields);
  const problem = !out
    ? "model_unavailable"
    : !text || text.length > MAX_TEXT
      ? "bad_text"
      : FORBIDDEN.test(text) || NO_NEW.test(text)
        ? "forbidden_claim"
        : /\d/.test(text) && !checkNumbers(text, paths, f)
          ? "ungrounded_numbers"
          : null;
  if (problem) return fallback(problem);
  const result = {
    schema_version: SCHEMA_VERSION,
    pipeline_version: survey.pipeline_version,
    date: f.date,
    text,
    grounded_fields: paths,
    numeric_check: "passed" as const,
    run_id: f.last_run?.run_id ?? null,
    model: ctx.model,
    generated_utc: now,
    source: "ai" as const,
  };
  await cachePut(ctx.deps, key, result);
  return result;
}
