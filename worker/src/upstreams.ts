/** Upstream services the Worker calls, with the URLs used to probe them in /api/health. */
export const IRSA_TAP_SYNC = "https://irsa.ipac.caltech.edu/TAP/sync";
export const JPL_SBIDENT = "https://ssd-api.jpl.nasa.gov/sb_ident.api";
export const JPL_HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api";
export const SPHEREX_S3 = "https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com";

export const UPSTREAMS = [
  { name: "IRSA TAP", url: IRSA_TAP_SYNC, probe: "https://irsa.ipac.caltech.edu/TAP/availability" },
  { name: "JPL SBIdent", url: JPL_SBIDENT, probe: JPL_SBIDENT },
  { name: "JPL Horizons", url: JPL_HORIZONS, probe: `${JPL_HORIZONS}?format=json` },
  {
    name: "SPHEREx S3 (nasa-irsa-spherex)",
    url: SPHEREX_S3,
    probe: `${SPHEREX_S3}/?list-type=2&max-keys=1&prefix=qr2/`,
  },
] as const;
