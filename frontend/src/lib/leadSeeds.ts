import { buildLead, isUnidentified, type Lead } from "./leads";
import { buildNames } from "./names";
import { staticCandidate, staticField, staticNameSeed, staticObjects, staticPrediction } from "./staticData";

/** Every published object JPL hasn't named, as the pipeline published it (the live list decides which are shown). */
export function buildSeeds(): Lead[] {
  const objects = staticObjects()?.objects ?? [];
  const seed = staticNameSeed();
  const names = buildNames(seed.candidates, seed.fields);
  const out: Lead[] = [];
  for (const o of objects) {
    if (!isUnidentified(o.classification)) continue;
    const cid = o.candidate_ids[0];
    const cand = cid ? staticCandidate(cid) : null;
    if (!cand) continue;
    const field = staticField(cand.field_id);
    out.push(buildLead(o, cand, names.get(cid!)?.title ?? o.object_id, field, staticPrediction(o.object_id)));
  }
  return out;
}

