"use client";

import { useMemo } from "react";
import { getCandidates, getFields } from "./api";
import type { CandidateDetail, CandidateSummary, FieldSummary } from "./contract";
import { buildNames, fallbackName, toNameInput, type ObjectName } from "./names";
import { useData } from "./useData";

/**
 * Names for every published object. Uses the full candidate list (including simulated ones) so
 * letters don't depend on the current filter. Returns null until both lists have loaded; callers
 * fall back to `nameFor`'s generic title meanwhile.
 */
export interface NameSeed {
  candidates: CandidateSummary[];
  fields: FieldSummary[];
}

export function useObjectNames(seed?: NameSeed) {
  const state = useData("object-names", async (signal) => {
    const [cands, fields] = await Promise.all([getCandidates({ include_injected: true }, signal), getFields(signal)]);
    return { cands: cands.candidates, fields: fields.fields };
  });
  // Until the live lists arrive, use the lists the page was built with (if any).
  const names = useMemo(() => {
    if (state.status === "ok") return buildNames(state.data.cands.map(toNameInput), state.data.fields);
    if (seed && seed.candidates.length) return buildNames(seed.candidates.map(toNameInput), seed.fields);
    return null;
  }, [state, seed]);
  return useMemo(
    () => ({
      ready: names !== null,
      /** Name for a candidate. A live designation on `detail` wins over the list's copy. */
      nameFor(c: { candidate_id: string; classification: CandidateDetail["classification"]; designation?: string | null }): ObjectName {
        const known = names?.get(c.candidate_id);
        const designation = c.classification === "known_object" ? (c.designation ?? null) : null;
        if (known) return designation ? { ...known, title: designation } : known;
        return fallbackName(c);
      },
    }),
    [names],
  );
}
