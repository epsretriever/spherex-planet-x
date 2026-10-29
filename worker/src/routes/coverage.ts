import { Hono } from "hono";
import type { AppEnv } from "../app";
import type { Coverage } from "../contract";
import { UpstreamError, badRequest } from "../errors";
import { IRSA_TAP, queryCoverage } from "../irsa";
import { SCHEMA_VERSION, workerVersion } from "../version";

export const coverage = new Hono<AppEnv>();

function num(v: string | undefined, name: string, lo: number, hi: number, dflt?: number): number {
  if (v === undefined || v === "") {
    if (dflt !== undefined) return dflt;
    throw badRequest(`${name} is required`);
  }
  const x = Number(v);
  if (!Number.isFinite(x) || x < lo || x > hi) throw badRequest(`${name} must be between ${lo} and ${hi}`);
  return x;
}

coverage.get("/", async (c) => {
  const ra = num(c.req.query("ra_deg"), "ra_deg", 0, 360);
  const dec = num(c.req.query("dec_deg"), "dec_deg", -90, 90);
  const radius = num(c.req.query("radius_deg"), "radius_deg", 0, 1, 0);
  let result: Awaited<ReturnType<typeof queryCoverage>>;
  try {
    result = await queryCoverage(c.get("deps"), ra, dec, radius);
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError(IRSA_TAP, "invalid_response", `IRSA TAP: ${(err as Error).message}`);
  }
  const body: Coverage = {
    schema_version: SCHEMA_VERSION,
    pipeline_version: workerVersion(),
    center: { ra_deg: ra, dec_deg: dec },
    radius_deg: radius,
    searched: "IRSA TAP: spherex.plane joined to spherex.artifact",
    n_epochs: result.epochs.length,
    truncated: result.truncated,
    epochs: result.epochs,
  };
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(body);
});
