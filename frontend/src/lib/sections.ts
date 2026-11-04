/**
 * The site's top-level sections, in menu order. A section is listed only once its page exists
 * and is backed by published data, so the live site never links to an empty screen. Add new
 * sections (Objects, Sky map, Help train the AI) here as they ship.
 */
export interface Section {
  href: string;
  label: string;
  /** One line for the phone menu. */
  blurb: string;
  /** Path prefix that marks the section as current. */
  match: string;
  /** Other path prefixes that belong to it (a patch page belongs to Objects). */
  also?: string[];
}

export const SECTIONS: Section[] = [
  { href: "/", label: "Home", blurb: "What this is and how it works", match: "/" },
  {
    href: "/objects/",
    label: "Objects",
    blurb: "Every moving object: search, unexplained leads, known (JPL), and patches of sky to blink",
    match: "/objects",
    also: ["/explore"],
  },
  { href: "/sky/", label: "Sky map", blurb: "Every patch of sky we've searched, and what's left", match: "/sky" },
  { href: "/limits/", label: "Limits", blurb: "Where Planet X could still be hiding: how faint and slow we can see", match: "/limits" },
  { href: "/about/", label: "About", blurb: "How it works, data credits and the team", match: "/about" },
];

export function isCurrent(pathname: string, s: Section): boolean {
  if (s.match === "/") return pathname === "/";
  return [s.match, ...(s.also ?? [])].some((m) => pathname === m || pathname.startsWith(`${m}/`));
}
