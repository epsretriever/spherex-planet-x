/**
 * Our own catalog: objects the pipeline found that JPL identified as the body being searched,
 * and the detections they hold (so a frame we measured shows our measured position, flux and
 * signal-to-noise next to JPL's prediction).
 */
import type { Deps, Env } from "../env";
import type { ObjectDetail, ObjectSummary } from "../contract";
import { readStaticJson } from "../static-data";
import { enrichedObjects } from "../routes/objects";
import type { FindCatalogLink, FindObject } from "./contract";

/** "433 Eros (A898 PA)" / "(2024 YR4)" / "2024 yr4" -> comparable keys. */
function keysOf(name: string): { number: string | null; text: string } {
  const t = name.trim().replace(/\s+/g, " ").toLowerCase();
  const inner = t.replace(/^\((.*)\)$/, "$1");
  const n = /^(\d+)(\s|$)/.exec(inner);
  return { number: n ? n[1]! : null, text: inner };
}

/** True when a catalog designation (as JPL SBIdent named it) is this SBDB object. */
export function sameBody(stored: string, o: Pick<FindObject, "designation" | "numbered" | "full_name">): boolean {
  const s = keysOf(stored);
  const des = o.designation.trim().replace(/\s+/g, " ").toLowerCase();
  if (o.numbered && /^\d+$/.test(des)) return s.number === des;
  if (s.number) {
    // A numbered name in the store can still be this object if SBDB's full name has the number.
    const f = keysOf(o.full_name);
    return f.number !== null && f.number === s.number;
  }
  return s.text === des || s.text.includes(`(${des})`) || s.text.startsWith(`${des} `);
}

export interface CatalogDetection {
  object_id: string;
  candidate_id: string;
  obs_id: string;
  detector: number;
  ra_deg: number;
  dec_deg: number;
  flux_ujy: number;
  flux_err_ujy: number;
  snr: number;
  wavelength_um_center: number;
  band_index: number | null;
}

export async function catalogMatches(
  env: Env,
  deps: Deps,
  o: FindObject,
): Promise<{ links: FindCatalogLink[]; detections: CatalogDetection[] }> {
  let summaries: ObjectSummary[];
  try {
    summaries = (await enrichedObjects(env, deps)).objects;
  } catch {
    return { links: [], detections: [] };
  }
  const hits = summaries.filter(
    (s) => s.classification !== "injected" && s.known_object_matched && s.known_object_designation && sameBody(s.known_object_designation, o),
  );
  const links: FindCatalogLink[] = hits.map((s) => ({
    object_id: s.object_id,
    report_path: `/objects/${encodeURIComponent(s.object_id)}/`,
    n_detections: s.n_detections,
    first_time_utc: s.first_time_utc,
    last_time_utc: s.last_time_utc,
  }));
  const detections: CatalogDetection[] = [];
  for (const s of hits.slice(0, 12)) {
    const d = await readStaticJson<ObjectDetail>(env, `objects/${s.object_id}.json`).catch(() => null);
    for (const x of d?.detections ?? []) {
      const det = x.source?.detector;
      if (!x.obs_id || typeof det !== "number") continue;
      detections.push({
        object_id: s.object_id,
        candidate_id: (x as { candidate_id?: string }).candidate_id ?? s.candidate_ids[0] ?? "",
        obs_id: x.obs_id,
        detector: det,
        ra_deg: x.ra_deg,
        dec_deg: x.dec_deg,
        flux_ujy: x.flux_ujy,
        flux_err_ujy: x.flux_err_ujy,
        snr: x.snr,
        wavelength_um_center: x.wavelength_um_center,
        band_index: x.band_index ?? null,
      });
    }
  }
  return { links, detections };
}
