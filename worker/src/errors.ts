import type { ContentfulStatusCode } from "hono/utils/http-status";

export type UpstreamStatus = number | "timeout" | "unreachable" | "invalid_response" | "budget";

/** Contract ErrorResponse: {detail, upstream, upstream_status}. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly detail: string,
    readonly upstream: string | null = null,
    readonly upstreamStatus: UpstreamStatus | null = null,
  ) {
    super(detail);
  }

  toJSON() {
    return { detail: this.detail, upstream: this.upstream, upstream_status: this.upstreamStatus };
  }
}

/** An upstream (IRSA, JPL, S3) failed. Maps to 504 on timeout and 502 otherwise. */
export class UpstreamError extends ApiError {
  constructor(upstream: string, upstreamStatus: UpstreamStatus, detail?: string) {
    super(
      upstreamStatus === "timeout" ? 504 : 502,
      detail ?? `${upstream} ${upstreamStatus === "timeout" ? "timed out" : `failed (${upstreamStatus})`}`,
      upstream,
      upstreamStatus,
    );
  }
}

export const notFound = (what: string) => new ApiError(404, `${what} not found`);
export const badRequest = (detail: string) => new ApiError(400, detail);
