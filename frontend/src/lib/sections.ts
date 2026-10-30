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
  { href: "/simulated/", label: "Simulated", blurb: "How faint and how slow an object we can find", match: "/simulated" },
  { href: "/about/", label: "About", blurb: "How it works, data credits and the team", match: "/about" },
];

export function isCurrent(pathname: string, s: Section): boolean {
  return pathname === s.match || pathname.startsWith(`${s.match}/`);
}
