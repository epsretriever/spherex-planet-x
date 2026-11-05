/**
 * JPL Small-Body Database (SBDB) API: resolves a name or number to one object, with its
 * orbit class and measured physical parameters. https://ssd-api.jpl.nasa.gov/doc/sbdb.html
 */
import type { Deps } from "../env";
import { UpstreamError } from "../errors";
import type { FindMatch, FindObject, FindPhysValue } from "./contract";
import { upstreamText } from "./http";

export const SBDB = "JPL SBDB";
export const SBDB_API = "https://ssd-api.jpl.nasa.gov/sbdb.api";

export type SbdbParsed =
  | { status: "found"; object: FindObject }
  | { status: "ambiguous"; matches: FindMatch[] }
  | { status: "not_found" };
export type SbdbLookup = SbdbParsed & { cached: boolean };

/**
 * A bare number is a numbered asteroid: ask by SPK id (20000000 + number), which is
 * unambiguous. SBDB's text search (sstr) answered HTTP 502 for several plain numbers in our
 * validation run (docs/find-validation.md).
 */
export function sbdbUrl(q: string): string {
  const t = q.trim();
  if (/^\d{1,7}$/.test(t) && Number(t) > 0) return `${SBDB_API}?${new URLSearchParams({ spk: String(20000000 + Number(t)), "phys-par": "1" }).toString()}`;
  return `${SBDB_API}?${new URLSearchParams({ sstr: t, "phys-par": "1" }).toString()}`;
}
export const sbdbPage = (des: string) => `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(des)}`;
export const horizonsPage = (des: string) => `https://ssd.jpl.nasa.gov/horizons/app.html#/?sstr=${encodeURIComponent(des)}`;

const num = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : null;
};

interface RawPhys {
  name?: string;
  value?: unknown;
  sigma?: unknown;
  units?: unknown;
  ref?: unknown;
}

function phys(list: RawPhys[], name: string): FindPhysValue | null {
  const p = list.find((x) => x.name === name);
  const value = p ? num(p.value) : null;
  if (!p || value === null) return null;
  return {
    value,
    sigma: num(p.sigma),
    units: typeof p.units === "string" && p.units ? p.units : null,
    ref: typeof p.ref === "string" && p.ref ? p.ref : null,
  };
}

/** Parse an SBDB response body (exported for tests). */
export function parseSbdb(status: number, body: string): SbdbParsed {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new UpstreamError(SBDB, "invalid_response", "JPL SBDB returned a response that is not JSON");
  }
  if (Array.isArray(j.list)) {
    const matches = (j.list as { pdes?: unknown; name?: unknown }[])
      .map((m) => ({ designation: String(m.pdes ?? "").trim(), name: String(m.name ?? m.pdes ?? "").trim() }))
      .filter((m) => m.designation);
    return { status: "ambiguous", matches };
  }
  const o = j.object as Record<string, unknown> | undefined;
  if (!o || typeof o.des !== "string") {
    if (status === 200 && typeof j.message === "string") return { status: "not_found" };
    throw new UpstreamError(SBDB, "invalid_response", "JPL SBDB returned no object");
  }
  const kind = String(o.kind ?? "");
  const des = o.des.trim();
  const oc = o.orbit_class as { code?: unknown; name?: unknown } | undefined;
  const list = Array.isArray(j.phys_par) ? (j.phys_par as RawPhys[]) : [];
  return {
    status: "found",
    object: {
      designation: des,
      full_name: String(o.fullname ?? des).trim(),
      kind: kind.startsWith("c") ? "comet" : "asteroid",
      // SBDB kind: an/au = numbered/unnumbered asteroid, cn/cu = numbered/unnumbered comet.
      numbered: kind.endsWith("n"),
      orbit_class: oc && oc.code ? { code: String(oc.code), name: String(oc.name ?? oc.code) } : null,
      diameter_km: phys(list, "diameter"),
      albedo: phys(list, "albedo"),
      h_mag: phys(list, "H"),
      sbdb_url: sbdbPage(des),
      horizons_url: horizonsPage(des),
    },
  };
}

/**
 * SBDB answers an unknown name with an error (observed: HTTP 404, or 502 from its gateway),
 * so a 4xx means "no such object"; 5xx stays an upstream error unless the body says otherwise.
 */
export async function sbdbLookup(deps: Deps, query: string): Promise<SbdbLookup> {
  const get = () =>
    upstreamText(deps, SBDB, sbdbUrl(query), { timeoutMs: 15_000, ttlSeconds: 24 * 3600, okStatuses: [200, 300, 400, 404] });
  let res;
  try {
    res = await get();
  } catch (err) {
    // One retry after a gateway error (SBDB's front end answers 502 intermittently).
    if (!(err instanceof UpstreamError) || err.upstreamStatus !== 502) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    res = await get();
  }
  if (res.status === 400 || res.status === 404) return { status: "not_found", cached: res.cached };
  return { ...parseSbdb(res.status, res.body), cached: res.cached };
}
