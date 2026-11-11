import { PageGuide } from "@/components/PageGuide";
import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { staticFields, staticSurvey } from "@/lib/staticData";
import { packTile } from "@/components/skyTile";
import { SkyView } from "./SkyView";

export const metadata: Metadata = pageMeta(
  "Sky map",
  "Every patch of sky we have searched for moving objects in SPHEREx data, on an all-sky map with the ecliptic and the Milky Way.",
  "/sky/",
);

export default function SkyPage() {
  const fields = staticFields()?.fields ?? [];
  // The page shows only the latest run (last_run); the run history stays in the API, out of the HTML.
  const { runs: _runs, ...survey0 } = (staticSurvey() ?? {}) as NonNullable<ReturnType<typeof staticSurvey>> & { runs?: unknown };
  void _runs;
  const survey = "tiles" in survey0 ? survey0 : null;
  return (
    <div className="container">
      <header className="page-header">
        <PageGuide>See which parts of the sky we have searched for moving objects, and which we haven&apos;t yet.</PageGuide>
        <h1>Where we&apos;ve searched</h1>
        <p className="lede">
          SPHEREx maps the whole sky. We search it patch by patch for things that move. Each marked tile is a patch we have searched; the
          rest of the sky we haven&apos;t searched yet, so it can&apos;t tell us anything either way.
        </p>
      </header>
      {/* The Planet Nine region (hundreds of cells) and the empty patches' positions are left out of the HTML and arrive with the
          live survey after first paint; tiles carry only the fields the page reads, as plain rows (packTile), which keeps the
          inlined data (and its parse time) down. */}
      <SkyView
        initial={
          survey
            ? {
                ...survey,
                tiles: survey.tiles.map(packTile),
                planet_nine: null,
                // Thousands of empty patches: their count is inlined, their positions arrive with the live survey.
                empty_cells: survey.empty_cells ? { ...survey.empty_cells, positions: [] } : null,
              }
            : null
        }
        fieldNames={Object.fromEntries(fields.map((f) => [f.field_id, f.name]))}
      />
    </div>
  );
}
