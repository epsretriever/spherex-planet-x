import { buildCompareOptions } from "@/lib/compareOptions";

// Written once at build time (static export): every published object's id and name, so the
// comparison page's pickers fill without downloading and naming the whole object list.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ generated_utc: new Date().toISOString(), options: buildCompareOptions() });
}
