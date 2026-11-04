import type { JplLinks, KnownObject } from "./contract";

/** "433 Eros (A898 PA)" -> "433"; "(2019 AB12)" -> "2019 AB12": what JPL's search box expects. */
export function jplSearchString(designation: string): string {
  let n = designation.trim();
  if (/^\([^()]*\)$/.test(n)) n = n.slice(1, -1).trim();
  const provisional = /^\d{4} [A-Z]{1,2}\d*\b/.exec(n);
  if (provisional) return provisional[0];
  const numbered = /^(\d+)(\s|$)/.exec(n);
  if (numbered) return numbered[1]!;
  return n.replace(/\s+\([^)]*\)\s*$/, "").trim() || n;
}

/**
 * Links to JPL's Small-Body Database (orbit) and Horizons (ephemerides) for a matched object:
 * the ones the pipeline published, or built from the designation for matches made by the Worker.
 */
export function jplLinks(known: KnownObject): JplLinks | null {
  if (!known.matched || !known.designation) return null;
  if (known.jpl_links) return known.jpl_links;
  const q = encodeURIComponent(jplSearchString(known.designation));
  return {
    sbdb_url: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${q}`,
    horizons_url: `https://ssd.jpl.nasa.gov/horizons/app.html#/?sstr=${q}`,
  };
}
