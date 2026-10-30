import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CandidateDetail, CandidateList, FieldDetail, FieldList, Survey } from "./contract";

/**
 * Build-time access to the pipeline's published data in public/data/ (the same files the Worker
 * serves the API from). Used only by server components during `next build` to prerender each
 * field and object page, so their content arrives in the HTML. Live JPL results still come from
 * the API in the browser.
 */
const DATA_DIR = path.join(process.cwd(), "public", "data");
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,95}$/;

function read<T>(rel: string): T | null {
  const file = path.join(DATA_DIR, rel);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function staticFields(): FieldList | null {
  return read<FieldList>("fields.json");
}

export function staticField(id: string): FieldDetail | null {
  return ID_RE.test(id) ? read<FieldDetail>(`fields/${id}.json`) : null;
}

export function staticCandidates(): CandidateList | null {
  return read<CandidateList>("candidates.json");
}

export function staticCandidate(id: string): CandidateDetail | null {
  return ID_RE.test(id) ? read<CandidateDetail>(`candidates/${id}.json`) : null;
}

export function staticSurvey(): Survey | null {
  const s = read<Survey>("survey.json");
  return s && Array.isArray(s.tiles) ? s : null;
}

/** The lists the name table is built from, for the first render. */
export function staticNameSeed() {
  return { candidates: staticCandidates()?.candidates ?? [], fields: staticFields()?.fields ?? [] };
}

/** Next requires at least one param for a static export; this one renders the 404 page. */
export const NO_PAGES = "__none__";
