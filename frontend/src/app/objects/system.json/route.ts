import { buildSystemBodies } from "@/lib/systemSeeds";

// Written once at build time (static export): where each published object's fitted orbit puts
// it in the solar system, for the 3D view on the sky map page.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ generated_utc: new Date().toISOString(), bodies: buildSystemBodies() });
}
