/**
 * Which 3D backdrop a page gets. The home page has its own (the spacetime fabric), so it gets none.
 * - belt: the asteroid belt, for pages about the objects we tracked
 * - field: stars holding still while movers jump, for pages where you blink the sky yourself
 * - orbits: the solar system's orbits, for pages about the method and its limits
 */
export type BackdropVariant = "belt" | "field" | "orbits";

export function backdropFor(pathname: string | null | undefined): BackdropVariant | null {
  const p = (pathname ?? "/").replace(/\/+$/, "") || "/";
  if (p === "/") return null;
  if (/^\/(objects|detective|leads)(\/|$)/.test(p)) return "belt";
  if (/^\/(explore|sky|simulated)(\/|$)/.test(p)) return "field";
  return "orbits";
}
