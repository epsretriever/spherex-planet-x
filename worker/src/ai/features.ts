import type {
  AiAnswer,
  AiSearch,
  AiSubjectKind,
  AiWriteup,
  CandidateFilter,
  Classification,
  DistanceClass,
  SortKey,
} from "../contract";
import { CLASSIFICATIONS } from "../contract";
import type { Deps } from "../env";
import { buildExplanation, checkNumbers, resolvePath } from "../text";
import { SCHEMA_VERSION } from "../version";
import {
  type AiBinding,
  FORBIDDEN,
  PROMPT_VERSION,
  cacheGet,
  cachePut,
  runJson,
  sha256,
  strings,
  takeQuota,
} from "./core";
import { GLOSSARY, type Subject, facts } from "./facts";
import { ASK_SYSTEM, SEARCH_SYSTEM, WRITEUP_SYSTEM } from "./prompts";

export interface AiContext {
  deps: Deps;
  ai: AiBinding | undefined;
  db: D1Database | undefined;
  model: string;
}

const MAX_PARAGRAPH = 700;
const MAX_ANSWER = 900;

/** Every leaf path in `doc` (dot notation, [i] for arrays), for numbers and digit-bearing strings. */
function leafPaths(doc: unknown, prefix = "", out: string[] = [], depth = 0): string[] {
  if (depth > 6 || out.length > 2000) return out;
  if (typeof doc === "number" || (typeof doc === "string" && /\d/.test(doc))) {
    if (prefix) out.push(prefix);
  } else if (Array.isArray(doc)) {
    doc.forEach((v, i) => leafPaths(v, `${prefix}[${i}]`, out, depth + 1));
  } else if (doc && typeof doc === "object") {
    for (const [k, v] of Object.entries(doc)) leafPaths(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
  }
  return out;
}

/**
 * Is every number in `text` a value from the report? The model's own citations are tried first;
 * if they are incomplete (models often cite loosely), every value in the report is accepted,
 * which still rejects any number that is not in the data. Strings with digits (designations,
 * dates, field names) are removed before numbers are checked.
 */
export function grounded(text: string, paths: string[], doc: unknown): boolean {
  const cited = paths.filter((p) => resolvePath(doc, p) !== undefined);
  if (cited.length > 0 && checkNumbers(text, cited, doc)) return true;
  if (!/\d/.test(text)) return true;
  return checkNumbers(text, leafPaths(doc), doc);
}

// --------------------------------------------------------------------------- write-up

export function templateWriteup(kind: AiSubjectKind, id: string, s: Subject, now: string): AiWriteup {
  const e = buildExplanation(s, now);
  const sentences = e.text.split(/(?<=\.)\s+/);
  const known = sentences.filter((x) => /JPL|catalog/.test(x));
  const motion = sentences.filter((x) => !known.includes(x) && /Detected|moves|fit|parallax|AU/.test(x));
  const rest = sentences.filter((x) => !known.includes(x) && !motion.includes(x));
  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: s.pipeline_version,
    subject_kind: kind,
    subject_id: id,
    verdict: s.summary_plain.split(/(?<=\.)\s+/).pop() ?? s.label_plain,
    paragraphs: [motion.join(" "), known.join(" "), rest.join(" ")].map((p) => p || " ").map((p) => p.trim()),
    grounded_fields: e.grounded_fields,
    numeric_check: e.numeric_check,
    source: "template",
    model: null,
    label_plain: "Written from the measurements below",
    cached: false,
    generated_utc: now,
  };
}

export async function writeup(ctx: AiContext, kind: AiSubjectKind, id: string, s: Subject): Promise<AiWriteup> {
  const now = ctx.deps.now().toISOString();
  const f = facts(s);
  const input = JSON.stringify(f);
  const key = `ai:v${PROMPT_VERSION}:writeup:${await sha256(`${ctx.model}\n${input}`)}`;
  const hit = await cacheGet<AiWriteup>(ctx.deps, key);
  if (hit) return { ...hit, cached: true };
  const fallback = (reason: string) => {
    console.warn(`writeup ${id}: template (${reason})`);
    return { ...templateWriteup(kind, id, s, now), fallback_reason: reason };
  };
  if (!ctx.ai) return fallback("no_ai_binding");
  if (!(await takeQuota(ctx.db, "writeup", ctx.deps.now()))) return fallback("daily_cap");
  const out = await runJson(ctx.deps, {
    ai: ctx.ai,
    model: ctx.model,
    messages: [
      { role: "system", content: WRITEUP_SYSTEM },
      { role: "user", content: `Facts (JSON):\n${input}` },
    ],
  });
  const verdict = typeof out?.verdict === "string" ? out.verdict.trim() : "";
  const paragraphs = strings(out?.paragraphs).map((p) => p.trim()).filter(Boolean);
  const paths = strings(out?.grounded_fields);
  const text = [verdict, ...paragraphs].join(" ");
  const problem = !out
    ? "model_unavailable"
    : verdict.length === 0 || verdict.length > 300
      ? "bad_verdict"
      : paragraphs.length !== 3 || paragraphs.some((p) => p.length > MAX_PARAGRAPH)
        ? `bad_paragraphs_${paragraphs.length}`
        : FORBIDDEN.test(text) ||
            (!s.known_object.checked && /\bunexplained\b|(does not|doesn't|did not|didn't) match/i.test(text))
          ? "forbidden_claim"
          : !grounded(text, paths, s)
            ? "ungrounded_numbers"
            : null;
  if (problem) return fallback(problem);
  const result: AiWriteup = {
    schema_version: SCHEMA_VERSION,
    pipeline_version: s.pipeline_version,
    subject_kind: kind,
    subject_id: id,
    verdict,
    paragraphs,
    grounded_fields: paths,
    numeric_check: "passed",
    source: "ai",
    model: ctx.model,
    label_plain: "AI-written from the measurements below",
    cached: false,
    generated_utc: now,
  };
  await cachePut(ctx.deps, key, result);
  return result;
}

// --------------------------------------------------------------------------- ask

export const CANT_ANSWER = "The data in this report doesn't tell us that.";

export async function ask(
  ctx: AiContext,
  kind: AiSubjectKind,
  id: string,
  s: Subject,
  question: string,
): Promise<AiAnswer> {
  const now = ctx.deps.now().toISOString();
  const input = JSON.stringify(facts(s));
  const q = question.trim().replace(/\s+/g, " ");
  const key = `ai:v${PROMPT_VERSION}:ask:${await sha256(`${ctx.model}\n${input}\n${q.toLowerCase()}`)}`;
  const base = {
    schema_version: SCHEMA_VERSION,
    pipeline_version: s.pipeline_version,
    subject_kind: kind,
    subject_id: id,
    question: q,
    generated_utc: now,
  } as const;
  const hit = await cacheGet<AiAnswer>(ctx.deps, key);
  if (hit) return { ...hit, cached: true };
  const refuse = (check: AiAnswer["numeric_check"]): AiAnswer => ({
    ...base,
    answer: CANT_ANSWER,
    citations: [],
    answered_from_data: false,
    numeric_check: check,
    model: null,
    cached: false,
  });
  if (!ctx.ai || !(await takeQuota(ctx.db, "ask", ctx.deps.now()))) return refuse("not_run");
  const out = await runJson(ctx.deps, {
    ai: ctx.ai,
    model: ctx.model,
    maxTokens: 400,
    messages: [
      { role: "system", content: ASK_SYSTEM },
      {
        role: "user",
        content: `Facts (JSON):\n${input}\n\nGlossary (JSON):\n${JSON.stringify(GLOSSARY)}\n\nQuestion: ${q}`,
      },
    ],
  });
  const answer = typeof out?.answer === "string" ? out.answer.trim() : "";
  const citations = strings(out?.citations);
  const fromData = out?.answered_from_data === true;
  if (!answer || answer.length > MAX_ANSWER || FORBIDDEN.test(answer)) return refuse("failed");
  if (!fromData) {
    // Definitions from the glossary carry no object facts; numbers would have to be cited.
    if (/\d/.test(answer)) return refuse("failed");
    const result: AiAnswer = { ...base, answer, citations: [], answered_from_data: false, numeric_check: "passed", model: ctx.model, cached: false };
    await cachePut(ctx.deps, key, result);
    return result;
  }
  if (!grounded(answer, citations, s)) return refuse("failed");
  const result: AiAnswer = { ...base, answer, citations, answered_from_data: true, numeric_check: "passed", model: ctx.model, cached: false };
  await cachePut(ctx.deps, key, result);
  return result;
}

// --------------------------------------------------------------------------- search

const DISTANCE_CLASSES: readonly DistanceClass[] = ["neo", "main_belt", "jupiter_trojan", "centaur", "tno", "unknown"];
const SORTS: readonly SortKey[] = ["score", "rate", "newest", "unusual"];

export const EMPTY_FILTER: CandidateFilter = {
  classification: [],
  rate_min_arcsec_per_hr: null,
  rate_max_arcsec_per_hr: null,
  distance_class: [],
  field_id: [],
  min_score: null,
  include_injected: false,
  sort: "score",
};

const num = (v: unknown, lo: number, hi: number): number | null | undefined => {
  if (v === null || v === undefined) return null;
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
};

/** Strict validation of the model's filter. Returns null when anything is out of contract. */
export function validateFilter(raw: Record<string, unknown> | null, fieldIds: string[]): CandidateFilter | null {
  if (!raw) return null;
  const allowed = new Set(Object.keys(EMPTY_FILTER));
  if (Object.keys(raw).some((k) => !allowed.has(k))) return null;
  const cls = strings(raw.classification ?? []);
  const dist = strings(raw.distance_class ?? []);
  const fields = strings(raw.field_id ?? []);
  if (cls.some((c) => !CLASSIFICATIONS.includes(c as Classification))) return null;
  if (dist.some((d) => !DISTANCE_CLASSES.includes(d as DistanceClass))) return null;
  if (fields.some((f) => !fieldIds.includes(f))) return null;
  const rmin = num(raw.rate_min_arcsec_per_hr, 0, 10000);
  const rmax = num(raw.rate_max_arcsec_per_hr, 0, 10000);
  const ms = num(raw.min_score, 0, 1);
  if (rmin === undefined || rmax === undefined || ms === undefined) return null;
  if (rmin !== null && rmax !== null && rmin > rmax) return null;
  const sort = (raw.sort ?? "score") as SortKey;
  if (!SORTS.includes(sort)) return null;
  const inj = raw.include_injected ?? false;
  if (typeof inj !== "boolean") return null;
  return {
    classification: cls as Classification[],
    rate_min_arcsec_per_hr: rmin,
    rate_max_arcsec_per_hr: rmax,
    distance_class: dist as DistanceClass[],
    field_id: fields,
    min_score: ms,
    include_injected: inj || cls.includes("injected"),
    sort,
  };
}

const CLASS_WORDS: Record<Classification, string> = {
  known_object: "known objects",
  unmatched: "unexplained objects",
  likely_artifact: "likely artifacts",
  unconfirmed_pair: "unconfirmed pairs",
  injected: "simulated objects",
};

/** Deterministic description of a validated filter (never model-written). */
export function describeFilter(f: CandidateFilter): string {
  const parts: string[] = [];
  parts.push(f.classification.length ? f.classification.map((c) => CLASS_WORDS[c]).join(" or ") : "all objects");
  if (f.rate_min_arcsec_per_hr !== null && f.rate_max_arcsec_per_hr !== null)
    parts.push(`moving ${f.rate_min_arcsec_per_hr} to ${f.rate_max_arcsec_per_hr} arcseconds per hour`);
  else if (f.rate_min_arcsec_per_hr !== null) parts.push(`moving at least ${f.rate_min_arcsec_per_hr} arcseconds per hour`);
  else if (f.rate_max_arcsec_per_hr !== null) parts.push(`moving at most ${f.rate_max_arcsec_per_hr} arcseconds per hour`);
  if (f.distance_class.length) parts.push(`in: ${f.distance_class.map((d) => d.replace("_", " ")).join(", ")}`);
  if (f.field_id.length) parts.push(`in field ${f.field_id.join(", ")}`);
  if (f.min_score !== null) parts.push(`with score at least ${f.min_score}`);
  const sort = { score: "most reliable first", rate: "fastest first", newest: "newest first", unusual: "most unusual first" }[f.sort];
  return `Showing ${parts.join(", ")}, ${sort}.`;
}

export async function search(ctx: AiContext, query: string, fieldIds: string[], pipelineVersion: string): Promise<AiSearch> {
  const q = query.trim().replace(/\s+/g, " ");
  const key = `ai:v${PROMPT_VERSION}:search:${await sha256(`${ctx.model}\n${fieldIds.join(",")}\n${q.toLowerCase()}`)}`;
  const base = { schema_version: SCHEMA_VERSION, pipeline_version: pipelineVersion, query: q } as const;
  const hit = await cacheGet<AiSearch>(ctx.deps, key);
  if (hit) return { ...hit, cached: true };
  const invalid = (): AiSearch => ({
    ...base,
    filter: EMPTY_FILTER,
    explanation_plain: "Couldn't turn that into a filter; showing everything.",
    valid: false,
    model: ctx.ai ? ctx.model : null,
    cached: false,
  });
  if (!ctx.ai || !(await takeQuota(ctx.db, "search", ctx.deps.now()))) return invalid();
  const out = await runJson(ctx.deps, {
    ai: ctx.ai,
    model: ctx.model,
    maxTokens: 250,
    messages: [
      { role: "system", content: SEARCH_SYSTEM },
      { role: "user", content: `Field ids: ${JSON.stringify(fieldIds)}\nRequest: ${q}` },
    ],
  });
  const f = validateFilter(out, fieldIds);
  if (!f) return invalid();
  const result: AiSearch = { ...base, filter: f, explanation_plain: describeFilter(f), valid: true, model: ctx.model, cached: false };
  await cachePut(ctx.deps, key, result);
  return result;
}
