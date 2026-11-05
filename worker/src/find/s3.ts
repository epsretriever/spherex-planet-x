/**
 * IRSA's public SPHEREx bucket (AWS Open Data, nasa-irsa-spherex). ObsCore does not give the
 * Level 2 file name, so the processing version of a week segment is read from a bucket
 * listing (one small request per segment, cached for a week).
 */
import type { Deps } from "../env";
import { UpstreamError } from "../errors";
import { SPHEREX_S3 } from "../upstreams";
import { upstreamText } from "./http";

export const S3_NAME = "SPHEREx S3 (nasa-irsa-spherex)";

export function segmentListUrl(release: string, segment: string): string {
  const q = new URLSearchParams({ "list-type": "2", delimiter: "/", prefix: `${release}/level2/${segment}/` });
  return `${SPHEREX_S3}/?${q.toString()}`;
}

/** The newest processing version listed for a segment, e.g. "l2b-v20-2025-251". */
export function parseVersions(xml: string, release: string, segment: string): string | null {
  const prefix = `${release}/level2/${segment}/`;
  const versions = [...xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)]
    .map((m) => m[1]!)
    .filter((p) => p.startsWith(prefix) && p.length > prefix.length)
    .map((p) => p.slice(prefix.length).replace(/\/$/, ""))
    .filter((v) => /^[A-Za-z0-9._-]+$/.test(v));
  return versions.sort().at(-1) ?? null;
}

export async function segmentVersion(deps: Deps, release: string, segment: string): Promise<string | null> {
  const res = await upstreamText(deps, S3_NAME, segmentListUrl(release, segment), { timeoutMs: 15_000, ttlSeconds: 7 * 24 * 3600 });
  if (!res.body.includes("<ListBucketResult")) throw new UpstreamError(S3_NAME, "invalid_response", "SPHEREx S3 listing was not readable");
  return parseVersions(res.body, release, segment);
}

export function level2Paths(release: string, segment: string, version: string, obsId: string, detector: number) {
  const file = `level2_${obsId}D${detector}_spx_${version}.fits`;
  const key = `${release}/level2/${segment}/${version}/${detector}/${file}`;
  return {
    file,
    archive_url: `${SPHEREX_S3}/${key}`,
    irsa_url: `https://irsa.ipac.caltech.edu/ibe/data/spherex/${key}`,
  };
}
