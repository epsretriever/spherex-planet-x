import { BUILD_COMMIT } from "./build-info";

export const SCHEMA_VERSION = "1.2" as const;
export const WORKER_VERSION = "0.1.0";

/** Version string for responses the Worker builds itself (health, coverage, errors). */
export const workerVersion = (): string =>
  BUILD_COMMIT && BUILD_COMMIT !== "unknown"
    ? `worker-${WORKER_VERSION}+git.${BUILD_COMMIT.slice(0, 7)}`
    : `worker-${WORKER_VERSION}`;

export const USER_AGENT =
  "spherex-planet-x/0.1 (+https://github.com/epsretriever/spherex-planet-x; SPHEREx moving-object explorer)";
