import { buildSeeds } from "@/lib/leadSeeds";

// Written once at build time (static export): every published object JPL hadn't named, with
// what the leads page needs. The page filters it with the live object list.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ generated_utc: new Date().toISOString(), leads: buildSeeds() });
}
