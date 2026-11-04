"use client";

import type { CandidateDetail, ObjectDetail } from "@/lib/contract";
import type { NameSeed } from "@/lib/useObjectNames";
import { ObjectReport } from "../report/ObjectReport";

/** An object's page: its report (evidence for its sighting, plus visits, orbit and history). */
export function ObjectView({
  id,
  initial,
  initialCandidate,
  seed,
}: {
  id: string;
  initial?: ObjectDetail | null;
  initialCandidate?: CandidateDetail | null;
  seed?: NameSeed;
}) {
  const candidate = initial?.candidate_ids[0] ?? (id.startsWith("obj-") ? id.slice(4) : null);
  return <ObjectReport id={candidate} objectId={id} initial={initialCandidate} initialObject={initial} seed={seed} />;
}
