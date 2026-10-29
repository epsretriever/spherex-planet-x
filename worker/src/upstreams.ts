/** Upstream services the Worker calls, and how /api/health checks each one. */
export const IRSA_TAP_SYNC = "https://irsa.ipac.caltech.edu/TAP/sync";
export const JPL_SBIDENT = "https://ssd-api.jpl.nasa.gov/sb_ident.api";
export const JPL_HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api";
export const SPHEREX_S3 = "https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com";

/**
 * A probe is a minimal *valid* request. An upstream counts as reachable only when it answers
 * the probe with HTTP 200 and the body passes `accept` (an error page or a 4xx is not "up").
 */
export interface Upstream {
  name: string;
  url: string;
  probe: string;
  accept: (body: string) => boolean;
}

const isJsonWith = (key: string) => (body: string) => {
  try {
    const v = JSON.parse(body) as Record<string, unknown>;
    return typeof v === "object" && v !== null && key in v;
  } catch {
    return false;
  }
};

// A one-arcminute SBIdent field of view at a fixed SPHEREx epoch, observed from the geocenter's
// surface point (lat 0, lon 0, alt 0). Valid input, tiny answer.
const SBIDENT_PROBE =
  `${JPL_SBIDENT}?lat=0&lon=0&alt=0&obs-time=2025-06-03_08:03:01` +
  "&fov-ra-center=23-06-53.52&fov-dec-center=M05-27-03.6&fov-ra-hwidth=0.01&fov-dec-hwidth=0.01&two-pass=false";

export const UPSTREAMS: readonly Upstream[] = [
  {
    name: "IRSA TAP",
    url: IRSA_TAP_SYNC,
    probe: "https://irsa.ipac.caltech.edu/TAP/availability",
    accept: (b) => /available/i.test(b),
  },
  { name: "JPL SBIdent", url: JPL_SBIDENT, probe: SBIDENT_PROBE, accept: isJsonWith("signature") },
  {
    name: "JPL Horizons",
    url: JPL_HORIZONS,
    probe: `${JPL_HORIZONS}?format=json&COMMAND='499'&OBJ_DATA='NO'&MAKE_EPHEM='NO'`,
    accept: isJsonWith("signature"),
  },
  {
    name: "SPHEREx S3 (nasa-irsa-spherex)",
    url: SPHEREX_S3,
    probe: `${SPHEREX_S3}/?list-type=2&max-keys=1&prefix=qr2/`,
    accept: (b) => b.includes("<ListBucketResult"),
  },
];
