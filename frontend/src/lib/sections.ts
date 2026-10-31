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
}

export const SECTIONS: Section[] = [
  { href: "/explore/", label: "Explore", blurb: "Blink real SPHEREx images and spot what moved", match: "/explore" },
  { href: "/detective/", label: "Detective", blurb: "Every moving object, with the evidence for and against", match: "/detective" },
  { href: "/objects/", label: "Objects", blurb: "Each moving object, tracked across visits, with its distance and orbit", match: "/objects" },
  { href: "/sky/", label: "Sky map", blurb: "Every patch of sky we've searched, and what's left", match: "/sky" },
  { href: "/limits/", label: "Limits", blurb: "Where Planet X could still be hiding: how faint and slow we can see", match: "/limits" },
  { href: "/about/", label: "About", blurb: "How it works, data credits and the team", match: "/about" },
];

export function isCurrent(pathname: string, s: Section): boolean {
  return pathname === s.match || pathname.startsWith(`${s.match}/`);
}
