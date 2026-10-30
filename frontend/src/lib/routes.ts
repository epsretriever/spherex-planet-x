/**
 * Links to object pages. Every published field and object has a page prerendered at build time
 * (/explore/{field_id}/, /detective/{candidate_id}/). Anything else falls through to the 404
 * page, which forwards it to the `?id=` route that loads from the API (see ObjectPathFallback).
 */
export const fieldHref = (fieldId: string) => `/explore/${encodeURIComponent(fieldId)}/`;
export const candidateHref = (candidateId: string) => `/detective/${encodeURIComponent(candidateId)}/`;

const ID = "([a-z0-9][a-z0-9._-]{0,95})";
const FALLBACKS: [RegExp, (id: string) => string][] = [
  [new RegExp(`^/explore/${ID}/?$`), (id) => `/explore/field/?id=${encodeURIComponent(id)}`],
  [new RegExp(`^/detective/${ID}/?$`), (id) => `/detective/candidate/?id=${encodeURIComponent(id)}`],
];
const RESERVED = new Set(["field", "candidate"]);

/** The `?id=` route for an object path that wasn't prerendered, or null. */
export function queryRouteFor(pathname: string): string | null {
  for (const [re, to] of FALLBACKS) {
    const m = pathname.match(re);
    if (m && !RESERVED.has(m[1]!)) return to(m[1]!);
  }
  return null;
}
