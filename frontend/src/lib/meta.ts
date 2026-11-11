import type { Metadata } from "next";
import { SITE_NAME, SITE_TAGLINE } from "./site";

/**
 * The deployed origin, for absolute share-image URLs. Override with NEXT_PUBLIC_SITE_URL (for
 * example on a preview deployment).
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://driftnet-sky.vercel.app").replace(/\/+$/, "");

export const SHARE_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: `${SITE_NAME}: ${SITE_TAGLINE}` };

/**
 * Title, description and share card for one page. Next.js replaces (rather than merges) a parent's
 * `openGraph` and `twitter` blocks, so every page sets the whole card here; otherwise a shared link
 * would show the site's name instead of the page's.
 */
export function pageMeta(title: string | null, description: string = SITE_TAGLINE, path?: string): Metadata {
  const full = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  return {
    ...(title ? { title } : {}),
    description,
    ...(path ? { alternates: { canonical: path } } : {}),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: full,
      description,
      ...(path ? { url: path } : {}),
      images: [SHARE_IMAGE],
    },
    twitter: { card: "summary_large_image", title: full, description, images: [SHARE_IMAGE.url] },
  };
}
