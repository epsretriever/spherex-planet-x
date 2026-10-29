import {
  SUPPORTED_SCHEMA_MAJOR,
  type CandidateDetail,
  type CandidateList,
  type Classification,
  type FieldDetail,
  type FieldList,
  type InjectionStudy,
  type Versioned,
} from "./contract";

/**
 * Data access. The app only ever fetches relative URLs: /api/* from the
 * spherex-planet-x Worker, or, with NEXT_PUBLIC_USE_FIXTURES=true, the static
 * JSON the backend commits to frontend/public/data/ (served at /data/).
 *
 * Fixture layout under /data/ (per-ID files first, then the single-file
 * names used in shared/fixtures/):
 *   fields.json
 *   fields/{field_id}.json          or field_detail.json
 *   candidates.json
 *   candidates/{candidate_id}.json  or candidate_detail.json
 *   injection/{study_id}.json       or injection_study.json
 */

export type DataErrorReason = "not_found" | "unavailable" | "invalid";

export class DataError extends Error {
  constructor(
    readonly reason: DataErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "DataError";
  }
}

export const USE_FIXTURES = process.env.NEXT_PUBLIC_USE_FIXTURES === "true";
const FIXTURE_BASE = (process.env.NEXT_PUBLIC_FIXTURE_BASE ?? "/data").replace(/\/+$/, "");

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" }, signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new DataError("unavailable", `Could not reach ${url}.`);
  }
  if (res.status === 404) throw new DataError("not_found", `${url} returned 404.`);
  if (!res.ok) throw new DataError("unavailable", `${url} returned ${res.status}.`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new DataError("invalid", `${url} did not return JSON.`);
  }
}

/** Tries each URL in order, moving on only when one is missing. */
async function firstFound<T>(urls: string[], signal?: AbortSignal): Promise<T> {
  let lastError: unknown = new DataError("not_found", "Not found.");
  for (const url of urls) {
    try {
      return await getJson<T>(url, signal);
    } catch (err) {
      if (!(err instanceof DataError) || err.reason !== "not_found") throw err;
      lastError = err;
    }
  }
  throw lastError;
}

const warned = new Set<string>();
function checkVersion<T extends Partial<Versioned>>(body: T, what: string): T {
  const major = Number.parseInt(String(body?.schema_version ?? "1").split(".")[0] ?? "", 10);
  if (major !== SUPPORTED_SCHEMA_MAJOR && !warned.has(what)) {
    warned.add(what);
    console.warn(`[api] ${what}: schema_version ${String(body.schema_version)}; this app expects ${SUPPORTED_SCHEMA_MAJOR}.x.`);
  }
  return body;
}

function expectArray(body: unknown, key: string, what: string) {
  const value = (body as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(value)) throw new DataError("invalid", `${what} is missing its ${key} array.`);
}

const enc = encodeURIComponent;

export async function getFields(signal?: AbortSignal): Promise<FieldList> {
  const body = await getJson<FieldList>(USE_FIXTURES ? `${FIXTURE_BASE}/fields.json` : "/api/fields", signal);
  expectArray(body, "fields", "Field list");
  return checkVersion(body, "fields");
}

export async function getField(fieldId: string, signal?: AbortSignal): Promise<FieldDetail> {
  const body = USE_FIXTURES
    ? await firstFound<FieldDetail>([`${FIXTURE_BASE}/fields/${enc(fieldId)}.json`, `${FIXTURE_BASE}/field_detail.json`], signal)
    : await getJson<FieldDetail>(`/api/fields/${enc(fieldId)}`, signal);
  expectArray(body, "epochs", "Field");
  if (body.field_id !== fieldId) throw new DataError("not_found", `No field ${fieldId}.`);
  return checkVersion(
    { ...body, blink_pairs: body.blink_pairs ?? [], movers: body.movers ?? [] },
    "field",
  );
}

export interface CandidateQuery {
  field_id?: string;
  classification?: Classification[];
  min_score?: number;
  include_injected?: boolean;
}

/** Applies the API's documented filters, for the fixture fallback. */
export function filterCandidates(list: CandidateList, q: CandidateQuery): CandidateList {
  const wanted = q.classification?.length ? new Set(q.classification) : null;
  const candidates = list.candidates.filter((c) => {
    if (q.field_id && c.field_id !== q.field_id) return false;
    if (wanted && !wanted.has(c.classification)) return false;
    if (typeof q.min_score === "number" && c.overall_score < q.min_score) return false;
    if (c.classification === "injected" && !q.include_injected && !wanted?.has("injected")) return false;
    return true;
  });
  return { ...list, candidates, total: candidates.length };
}

export async function getCandidates(q: CandidateQuery = {}, signal?: AbortSignal): Promise<CandidateList> {
  if (USE_FIXTURES) {
    const body = await getJson<CandidateList>(`${FIXTURE_BASE}/candidates.json`, signal);
    expectArray(body, "candidates", "Candidate list");
    return checkVersion(filterCandidates(body, q), "candidates");
  }
  const params = new URLSearchParams();
  if (q.field_id) params.set("field_id", q.field_id);
  for (const c of q.classification ?? []) params.append("classification", c);
  if (typeof q.min_score === "number") params.set("min_score", String(q.min_score));
  if (q.include_injected) params.set("include_injected", "true");
  const qs = params.toString();
  const body = await getJson<CandidateList>(`/api/candidates${qs ? `?${qs}` : ""}`, signal);
  expectArray(body, "candidates", "Candidate list");
  return checkVersion(body, "candidates");
}

export async function getCandidate(candidateId: string, signal?: AbortSignal): Promise<CandidateDetail> {
  const body = USE_FIXTURES
    ? await firstFound<CandidateDetail>(
        [`${FIXTURE_BASE}/candidates/${enc(candidateId)}.json`, `${FIXTURE_BASE}/candidate_detail.json`],
        signal,
      )
    : await getJson<CandidateDetail>(`/api/candidates/${enc(candidateId)}`, signal);
  expectArray(body, "detections", "Candidate");
  if (body.candidate_id !== candidateId) throw new DataError("not_found", `No candidate ${candidateId}.`);
  return checkVersion(body, "candidate");
}

export async function getInjectionStudy(studyId: string, signal?: AbortSignal): Promise<InjectionStudy> {
  const body = USE_FIXTURES
    ? await firstFound<InjectionStudy>(
        [`${FIXTURE_BASE}/injection/${enc(studyId)}.json`, `${FIXTURE_BASE}/injection_study.json`],
        signal,
      )
    : await getJson<InjectionStudy>(`/api/injection/${enc(studyId)}`, signal);
  expectArray(body, "grid", "Injection study");
  if (body.study_id !== studyId) throw new DataError("not_found", `No injection study ${studyId}.`);
  return checkVersion(body, "injection");
}

/**
 * Finds the injection study to show: the one named in the URL, or the study
 * that the first injected candidate belongs to.
 */
export async function findInjectionStudyId(signal?: AbortSignal): Promise<string> {
  const list = await getCandidates({ classification: ["injected"] }, signal);
  const first = list.candidates[0];
  if (!first) throw new DataError("not_found", "No injected candidates were published.");
  const detail = await getCandidate(first.candidate_id, signal);
  if (!detail.injection?.study_id) throw new DataError("not_found", "Injected candidate has no study.");
  return detail.injection.study_id;
}

/**
 * Image URLs in responses are relative to the API host, which is this
 * origin. In fixture mode, root-relative URLs are looked up under /data/.
 */
export function assetUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (USE_FIXTURES) return `${FIXTURE_BASE}/${url.replace(/^\/+/, "")}`;
  return url.startsWith("/") ? url : `/${url}`;
}
