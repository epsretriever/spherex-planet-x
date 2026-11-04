import type { Classification } from "./contract";

/**
 * Review order shared by every list: unexplained (and not yet checked) objects first, then weak
 * detections (likely artifacts, unconfirmed pairs), then objects JPL identified, then simulated
 * ones. Known objects stay listed, with links to JPL, after the ones that still need a look.
 */
export function reviewPriority(s: { classification: Classification; known_object_matched?: boolean }): number {
  if (s.classification === "injected") return 3;
  if (s.known_object_matched || s.classification === "known_object") return 2;
  if (s.classification === "likely_artifact" || s.classification === "unconfirmed_pair") return 1;
  return 0;
}

export const byReviewPriority = <T extends { classification: Classification; known_object_matched?: boolean }>(a: T, b: T) =>
  reviewPriority(a) - reviewPriority(b);
