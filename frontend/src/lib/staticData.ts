import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { toNameSeed, type NameSeed } from "./names";
import type { CandidateDetail, CandidateList, FieldDetail, FieldList, InjectionStudy, InjectionStudyIndex, ObjectDetail, ObjectList, ObjectPrediction, Survey } from "./contract";

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

export function staticObjects(): ObjectList | null {
  const o = read<ObjectList>("objects.json");
  return o && Array.isArray(o.objects) ? o : null;
}

export function staticObject(id: string): ObjectDetail | null {
  return ID_RE.test(id) ? read<ObjectDetail>(`objects/${id}.json`) : null;
}

/** An object's orbit prediction (only once it has an orbit). */
export function staticPrediction(id: string): (ObjectPrediction & { note_plain?: string | null }) | null {
  return ID_RE.test(id) ? read<ObjectPrediction & { note_plain?: string | null }>(`objects/${id}/prediction.json`) : null;
}

export function staticSurvey(): Survey | null {
  const s = read<Survey>("survey.json");
  return s && Array.isArray(s.tiles) ? s : null;
}

/** The lists the name table is built from, for the first render. */
export function staticNameSeed(): NameSeed {
  return toNameSeed(staticCandidates()?.candidates ?? [], staticFields()?.fields ?? []);
}

/** The newest published injection-recovery study. */
export function staticInjectionStudy(): InjectionStudy | null {
  const idx = read<InjectionStudyIndex>("injection/index.json");
  const newest = [...(idx?.studies ?? [])].sort((a, b) => b.generated_utc.localeCompare(a.generated_utc))[0];
  return newest && ID_RE.test(newest.study_id) ? read<InjectionStudy>(`injection/${newest.study_id}.json`) : null;
}

/** Next requires at least one param for a static export; this one renders the 404 page. */
export const NO_PAGES = "__none__";

/** One point per UTC day, written by the pipeline's publish step (growth.json). */
export interface GrowthDay {
  date: string;
  tiles_searched: number;
  area_deg2: number;
  sky_percent: number;
  candidates: number;
  objects: number;
  /** From the live Worker (JPL results); missing on days before it was recorded. */
  identified?: number;
  unidentified?: number;
}

export function staticGrowth(): GrowthDay[] {
  const g = read<{ days: GrowthDay[] }>("growth.json");
  return Array.isArray(g?.days) ? g.days : [];
}
