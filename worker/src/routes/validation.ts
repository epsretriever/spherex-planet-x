import { Hono } from "hono";
import type { AppEnv } from "../app";
import type { JplOrbitComparison, ObjectList } from "../contract";
import { ApiError } from "../errors";
import { requireStaticJson } from "../static-data";
import { readRecords, usableRecord } from "../store";

/**
 * Validation results.
 * - /api/validation/orbits: the orbit method on simulated asteroids (static, from
 *   `spherex-px orbit-validation`).
 * - /api/validation/jpl-orbits: our orbits versus JPL's for every object JPL identified
 *   (from the comparisons stored with the JPL results, orbit-compare.ts).
 */
export const validation = new Hono<AppEnv>();

validation.get("/orbits", async (c) => {
  const doc = await requireStaticJson<unknown>(c.env, "validation/orbits.json", "orbit validation");
  c.header("Cache-Control", "public, max-age=300");
  return c.json(doc);
});

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const fraction = (xs: (boolean | null | undefined)[]) => {
  const known = xs.filter((x): x is boolean => typeof x === "boolean");
  return known.length ? known.filter(Boolean).length / known.length : null;
};
const r = (x: number | null, d: number) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

validation.get("/jpl-orbits", async (c) => {
  const list = await requireStaticJson<ObjectList>(c.env, "objects.json", "object list");
  const real = list.objects.filter((o) => o.classification !== "injected" && o.candidate_ids.length > 0);
  const recs = await readRecords(c.get("deps"), list.pipeline_version, real.map((o) => o.candidate_ids[0]!));
  const rows: (JplOrbitComparison & { object_id: string })[] = [];
  let identified = 0;
  for (const o of real) {
    const rec = usableRecord(recs.get(o.candidate_ids[0]!), o.known_object_checked);
    if (!(rec ? rec.enrichment.matched : o.known_object_matched)) continue;
    identified += 1;
    if (rec?.orbit_comparison) rows.push({ object_id: o.object_id, ...rec.orbit_comparison });
  }
  c.header("Cache-Control", "public, max-age=300");
  return c.json({
    schema_version: "1.1",
    pipeline_version: list.pipeline_version,
    n_identified: identified,
    n_compared: rows.length,
    distance_in_interval: r(fraction(rows.map((x) => x.distance_in_interval)), 3),
    delta_a_au_abs_median: r(median(rows.map((x) => Math.abs(x.delta_a_au))), 4),
    delta_e_abs_median: r(median(rows.map((x) => Math.abs(x.delta_e))), 4),
    delta_i_deg_abs_median: r(median(rows.map((x) => Math.abs(x.delta_i_deg))), 3),
    position_error_arcsec_30d_median: r(
      median(rows.map((x) => x.position_error_arcsec_30d).filter((x): x is number => x !== null)),
      1,
    ),
    inside_3sigma_30d: r(fraction(rows.map((x) => x.inside_3sigma_30d)), 3),
    rows,
  });
});

validation.all("/:name", (c) => {
  throw new ApiError(404, `no validation named '${c.req.param("name")}'`);
});
