import { buildNames } from "./names";
import { staticNameSeed, staticObjects } from "./staticData";

/** One entry of the comparison page's pickers. */
export interface CompareOption {
  id: string;
  /** The object's name as built ("Moving object A in Aquarius"); the live JPL designation replaces it in the browser. */
  title: string;
  simulated: boolean;
}

/** Every published object with its name, for the comparison pickers (build time). */
export function buildCompareOptions(): CompareOption[] {
  const seed = staticNameSeed();
  const names = buildNames(seed.candidates, seed.fields);
  return (staticObjects()?.objects ?? []).map((o) => ({
    id: o.object_id,
    title: names.get(o.candidate_ids[0] ?? "")?.title ?? o.object_id,
    simulated: o.classification === "injected",
  }));
}
