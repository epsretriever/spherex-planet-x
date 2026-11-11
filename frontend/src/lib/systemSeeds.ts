import { buildNames } from "./names";
import { staticNameSeed, staticObject, staticObjects } from "./staticData";
import { systemBody, type SystemBody } from "./system";

/** Every published object with a drawable orbit, placed in the solar system (build time). */
export function buildSystemBodies(): SystemBody[] {
  const objects = staticObjects()?.objects ?? [];
  const seed = staticNameSeed();
  const names = buildNames(seed.candidates, seed.fields);
  const out: SystemBody[] = [];
  for (const o of objects) {
    // Simulated objects are test sources planted in the images: they are nowhere in the real solar system.
    if (o.classification === "injected" || o.orbit_status === "none") continue;
    const detail = staticObject(o.object_id);
    const body = systemBody(o.object_id, names.get(o.candidate_ids[0] ?? "")?.title ?? o.object_id, detail?.orbit);
    if (body) out.push(body);
  }
  return out;
}
