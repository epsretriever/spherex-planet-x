/**
 * Links to object pages. Every published field and object has a page prerendered at build time
 * (/explore/{field_id}/ for a patch of sky, /objects/{object_id}/ for an object; the old
 * /detective/{candidate_id}/ pages forward to their object). Anything else falls through to the 404
 * page, which forwards it to the `?id=` route that loads from the API (see ObjectPathFallback).
 */
export const fieldHref = (fieldId: string) => `/explore/${encodeURIComponent(fieldId)}/`;
/** The object a pipeline sighting (candidate) belongs to: candidate X is object obj-X. */
export const objectIdFor = (candidateId: string) => `obj-${candidateId}`;
/** A sighting's report is its object's report: one canonical page per object. */
export const candidateHref = (candidateId: string) => `/objects/${encodeURIComponent(objectIdFor(candidateId))}/`;
export const objectHref = (objectId: string) => `/objects/${encodeURIComponent(objectId)}/`;

/** The side-by-side page for two objects (either may be missing: the page then asks for it). */
export function compareHref(a?: string | null, b?: string | null): string {
  const q = new URLSearchParams();
  if (a) q.set("a", a);
  if (b) q.set("b", b);
  const qs = q.toString();
  return qs ? `/objects/compare/?${qs}` : "/objects/compare/";
}

const ID = "([a-z0-9][a-z0-9._-]{0,95})";
const FALLBACKS: [RegExp, (id: string) => string][] = [
  [new RegExp(`^/explore/${ID}/?$`), (id) => `/explore/field/?id=${encodeURIComponent(id)}`],
  [new RegExp(`^/detective/${ID}/?$`), (id) => `/objects/object/?id=${encodeURIComponent(objectIdFor(id))}`],
  [new RegExp(`^/objects/${ID}/?$`), (id) => `/objects/object/?id=${encodeURIComponent(id)}`],
];
const RESERVED = new Set(["field", "candidate", "object", "compare"]);

/** The `?id=` route for an object path that wasn't prerendered, or null. */
export function queryRouteFor(pathname: string): string | null {
  for (const [re, to] of FALLBACKS) {
    const m = pathname.match(re);
    if (m && !RESERVED.has(m[1]!)) return to(m[1]!);
  }
  return null;
}

/**
 * Where an old URL lives now. Query strings are kept (the Detective's filters are the Objects
 * page's filters). Returns null for paths that didn't move.
 */
export function movedTo(pathname: string, search = ""): string | null {
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  const withQuery = (path: string, extra?: Record<string, string>) => {
    const p = new URLSearchParams(q);
    for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
    const qs = p.toString();
    return qs ? `${path}?${qs}` : path;
  };
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  if (path === "/detective/") return withQuery("/objects/");
  if (path === "/leads/") return withQuery("/objects/", { view: "leads" });
  if (path === "/explore/") return withQuery("/objects/", { view: "patches" });
  if (path === "/detective/candidate/") {
    const id = q.get("id");
    q.delete("id");
    return id ? withQuery("/objects/object/", { id: objectIdFor(id) }) : withQuery("/objects/");
  }
  const m = path.match(new RegExp(`^/detective/${ID}/$`));
  if (m && !RESERVED.has(m[1]!)) return withQuery(candidateHref(m[1]!));
  return null;
}
