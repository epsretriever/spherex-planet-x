/**
 * Translation, read-aloud and voice input for the AI write-ups and questions.
 *
 * Same rules as the text features (core.ts): every call is capped per day, cached by a hash of
 * its exact input, and checked before it is served. A translation is shown only if every number
 * in it is a number from the English text it came from; otherwise the English text is served.
 */
import type { AiWriteup } from "../contract";
import type { Deps } from "../env";
import { type AiBinding, cacheGet, cachePut, sha256, takeQuota } from "./core";

export const TRANSLATE_MODEL = "@cf/meta/m2m100-1.2b";
export const SPEECH_MODEL = "@cf/myshell-ai/melotts";
export const TRANSCRIBE_MODEL = "@cf/openai/whisper-large-v3-turbo";
/** Bump when translation or speech post-processing changes. */
const MEDIA_VERSION = "2";

/** Languages the write-up can be translated into (m2m100 codes), with their own names. */
export const LANGUAGES: Record<string, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  pt: "Português",
  de: "Deutsch",
  hi: "हिन्दी",
  zh: "中文",
  ja: "日本語",
  ko: "한국어",
  ar: "العربية",
};
/** Languages MeloTTS can read aloud. */
export const SPEECH_LANGUAGES = new Set(["en", "es", "fr", "zh", "ja", "ko"]);

export interface MediaContext {
  deps: Deps;
  ai: AiBinding | undefined;
  db: D1Database | undefined;
}

/** Run a non-chat model; null on any failure. Spends one unit of the subrequest budget. */
async function runModel(ctx: MediaContext, model: string, input: Record<string, unknown>): Promise<unknown> {
  if (!ctx.ai || ctx.deps.budget.remaining <= 0) return null;
  ctx.deps.budget.remaining -= 1;
  try {
    return await ctx.ai.run(model, input);
  } catch (err) {
    console.error(`Workers AI ${model} failed:`, err);
    return null;
  }
}

// --------------------------------------------------------------------------- numbers

const LOCAL_DIGITS: [RegExp, number][] = [
  [/[٠-٩]/g, 0x0660], // Arabic-Indic
  [/[۰-۹]/g, 0x06f0], // Extended Arabic-Indic
  [/[०-९]/g, 0x0966], // Devanagari
  [/[０-９]/g, 0xff10], // Full-width
];

/** Numbers written in `text`, in any of the digit systems the translations use. */
export function numbersIn(text: string): number[] {
  let t = text;
  for (const [re, zero] of LOCAL_DIGITS) t = t.replace(re, (d) => String(d.charCodeAt(0) - zero));
  // Thousands separators (14,762 / 14.762 / 14 762) and decimal commas (3,2) both occur.
  t = t.replace(/(\d)[   ](?=\d{3}\b)/g, "$1");
  const out: number[] = [];
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const s = m[0];
    const groups = s.split(/[.,]/);
    if (groups.length > 2 || (groups.length === 2 && groups[1]!.length === 3 && /^\d{1,3}$/.test(groups[0]!))) {
      // 14,762 or 1.234.567: thousands grouping. (Also read as a decimal below, to be lenient.)
      out.push(Number(groups.join("")));
      if (groups.length === 2) out.push(Number(`${groups[0]}.${groups[1]}`));
    } else {
      out.push(Number(s.replace(",", ".")));
    }
  }
  return out.filter((n) => Number.isFinite(n));
}

/** Does every number in `text` appear among `allowed` (to the precision it is written at)? */
export function numbersAllowed(text: string, allowed: number[]): boolean {
  const pool = new Set(allowed.map((n) => n.toString()));
  let t = text;
  for (const [re, zero] of LOCAL_DIGITS) t = t.replace(re, (d) => String(d.charCodeAt(0) - zero));
  t = t.replace(/(\d)[   ](?=\d{3}\b)/g, "$1");
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const s = m[0];
    const groups = s.split(/[.,]/);
    const readings: { value: number; decimals: number }[] = [];
    if (groups.length > 2) readings.push({ value: Number(groups.join("")), decimals: 0 });
    else if (groups.length === 2) {
      readings.push({ value: Number(`${groups[0]}.${groups[1]}`), decimals: groups[1]!.length });
      if (groups[1]!.length === 3) readings.push({ value: Number(groups.join("")), decimals: 0 });
    } else readings.push({ value: Number(s), decimals: 0 });
    const ok = readings.some(
      ({ value, decimals }) =>
        pool.has(value.toString()) ||
        allowed.some((n) => n.toFixed(decimals) === value.toFixed(decimals) || Math.abs(n - value) < 0.5 * 10 ** -decimals),
    );
    if (!ok) return false;
  }
  return true;
}

// --------------------------------------------------------------------------- translation

/** Split a paragraph into sentences without breaking decimals ("0.04"), initials or "e.g.". */
export function splitSentences(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  return t
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export interface TranslatedWriteup extends AiWriteup {
  /** Language of verdict and paragraphs. */
  lang: string;
  translation?: { model: string; from: "en"; numeric_check: "passed" | "failed" | "not_run"; cached: boolean };
}

function cleanTranslation(raw: unknown): string | null {
  const t = (raw as { translated_text?: unknown } | null)?.translated_text;
  if (typeof t !== "string") return null;
  const s = t.trim();
  if (!s || /^ERROR\b/.test(s)) return null;
  return s;
}

/**
 * The write-up in `lang`. Falls back to the English write-up (with translation.numeric_check
 * "failed" or "not_run") when the model is unavailable, capped, or changes any number.
 */
export async function translateWriteup(ctx: MediaContext, w: AiWriteup, lang: string): Promise<TranslatedWriteup> {
  if (lang === "en" || !LANGUAGES[lang]) return { ...w, lang: "en" };
  const pieces = [w.verdict, ...w.paragraphs].map((p) => p.trim());
  const key = `ai:m${MEDIA_VERSION}:tr:${lang}:${await sha256(pieces.join("\n"))}`;
  const english = (check: "failed" | "not_run"): TranslatedWriteup => ({
    ...w,
    lang: "en",
    translation: { model: TRANSLATE_MODEL, from: "en", numeric_check: check, cached: false },
  });
  const hit = await cacheGet<string[]>(ctx.deps, key);
  let out: string[] | null = hit;
  if (!out) {
    if (!ctx.ai || !(await takeQuota(ctx.db, "translate", ctx.deps.now()))) return english("not_run");
    // m2m100 sometimes drops later sentences of a long input, so each sentence is translated on its own.
    const sentences = pieces.map(splitSentences);
    const flat = sentences.flat();
    const results = await Promise.all(flat.map((text) => runModel(ctx, TRANSLATE_MODEL, { text, source_lang: "en", target_lang: lang })));
    const done = results.map(cleanTranslation);
    if (done.some((t) => t === null)) return english("not_run");
    let k = 0;
    const joiner = lang === "zh" || lang === "ja" ? "" : " ";
    const texts = sentences.map((ss) => ss.map(() => done[k++]!).join(joiner));
    // Every number in each translated piece must be a number from its English original.
    if (texts.some((t, i) => !numbersAllowed(t!, numbersIn(pieces[i]!)))) return english("failed");
    out = texts as string[];
    await cachePut(ctx.deps, key, out);
  }
  const [verdict, ...paragraphs] = out;
  return {
    ...w,
    verdict: verdict ?? w.verdict,
    paragraphs: paragraphs.length === w.paragraphs.length ? paragraphs : w.paragraphs,
    label_plain: `${w.label_plain}, machine-translated into ${LANGUAGES[lang]}`,
    lang,
    translation: { model: TRANSLATE_MODEL, from: "en", numeric_check: "passed", cached: Boolean(hit) },
  };
}

// --------------------------------------------------------------------------- speech

/** Longest paragraph read aloud, in characters (MeloTTS slows down sharply on long inputs). */
const MAX_CLIP_CHARS = 900;
/** Most paragraphs read aloud for one write-up. */
export const MAX_CLIPS = 6;

/** Paragraphs to read aloud: the checked write-up or translation, trimmed to the limits above. */
export function speechParts(texts: string[]): string[] {
  return texts
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, MAX_CLIPS)
    .map((t) => (t.length > MAX_CLIP_CHARS ? `${t.slice(0, MAX_CLIP_CHARS).replace(/\s+\S*$/, "")}…` : t));
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** MeloTTS returns `{audio: base64}` from the binding, or raw bytes from some runtimes. */
async function audioBytes(raw: unknown): Promise<Uint8Array | null> {
  if (!raw) return null;
  const a = (raw as { audio?: unknown }).audio;
  if (typeof a === "string" && a.length > 100) return fromBase64(a.replace(/^data:audio\/[\w-]+;base64,/, ""));
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (typeof (raw as ReadableStream).getReader === "function") {
    const buf = await new Response(raw as ReadableStream).arrayBuffer();
    return buf.byteLength ? new Uint8Array(buf) : null;
  }
  return null;
}

/** The audio format of `bytes`, from its first bytes (MeloTTS currently returns WAV). */
export function audioType(bytes: Uint8Array): string {
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  if (tag === "RIFF") return "audio/wav";
  if (tag === "OggS") return "audio/ogg";
  if (tag.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return "audio/mpeg";
  if (tag === "fLaC") return "audio/flac";
  return "application/octet-stream";
}

export interface SpeechClip {
  bytes: Uint8Array;
  type: string;
  cached: boolean;
}

/** One paragraph read aloud, cached in KV as raw bytes. Null when the model is unavailable or capped. */
export async function speakClip(ctx: MediaContext, text: string, lang: string): Promise<SpeechClip | null> {
  if (!SPEECH_LANGUAGES.has(lang) || !text) return null;
  const key = `ai:m${MEDIA_VERSION}:tts:${lang}:${await sha256(text)}`;
  const hit = await cacheGet<string>(ctx.deps, key);
  if (typeof hit === "string" && hit.length > 60) {
    const bytes = fromBase64(hit);
    return { bytes, type: audioType(bytes), cached: true };
  }
  if (!ctx.ai || !(await takeQuota(ctx.db, "speech", ctx.deps.now()))) return null;
  const bytes = await audioBytes(await runModel(ctx, SPEECH_MODEL, { prompt: text, lang }));
  if (!bytes || bytes.byteLength <= 44) return null;
  await cachePut(ctx.deps, key, toBase64(bytes));
  return { bytes, type: audioType(bytes), cached: false };
}

// --------------------------------------------------------------------------- voice input

export const MAX_AUDIO_BYTES = 1_500_000;

export interface Transcript {
  text: string;
  model: string;
  language: string | null;
}

/** Whisper transcription of a short recorded question. Null when the model can't hear anything. */
export async function transcribe(ctx: MediaContext, audio: Uint8Array, language?: string): Promise<Transcript | null> {
  if (!ctx.ai || !(await takeQuota(ctx.db, "transcribe", ctx.deps.now()))) return null;
  const input: Record<string, unknown> = { audio: toBase64(audio), task: "transcribe", vad_filter: true };
  if (language && LANGUAGES[language]) input.language = language;
  const raw = (await runModel(ctx, TRANSCRIBE_MODEL, input)) as { text?: unknown; transcription_info?: { language?: unknown } } | null;
  const text = typeof raw?.text === "string" ? raw.text.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  if (!text) return null;
  const lang = raw?.transcription_info?.language;
  return { text, model: TRANSCRIBE_MODEL, language: typeof lang === "string" ? lang : null };
}
