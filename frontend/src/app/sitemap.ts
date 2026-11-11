import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/meta";
import { fieldHref, objectHref } from "@/lib/routes";
import { staticFields, staticObjects } from "@/lib/staticData";

export const dynamic = "force-static";

/** Every page built from the published data: the main pages, each patch of sky and each object. */
export default function sitemap(): MetadataRoute.Sitemap {
  const objects = staticObjects();
  const fields = staticFields();
  const updated = objects?.generated_utc ?? fields?.generated_utc;
  const lastModified = updated ? new Date(updated) : undefined;
  const page = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({ url: `${SITE_URL}${path}`, lastModified, priority });
  return [
    page("/", 1),
    page("/objects/", 0.9),
    page("/sky/", 0.9),
    page("/limits/", 0.8),
    page("/about/", 0.8),
    page("/objects/compare/", 0.5),
    ...(fields?.fields ?? []).map((f) => page(fieldHref(f.field_id), 0.5)),
    // Simulated objects are test sources: their reports stay reachable but are not offered to search engines.
    ...(objects?.objects ?? []).filter((o) => o.classification !== "injected").map((o) => page(objectHref(o.object_id), 0.6)),
  ];
}
