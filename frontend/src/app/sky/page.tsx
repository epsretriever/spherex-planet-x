import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { staticFields, staticGrowth, staticSurvey } from "@/lib/staticData";
import { skyTile } from "@/components/SkyMap";
import { SkyView } from "./SkyView";

export const metadata: Metadata = pageMeta(
  "Sky map",
  "Every patch of sky we have searched for moving objects in SPHEREx data, on an all-sky map with the ecliptic and the Milky Way.",
  "/sky/",
);

export default function SkyPage() {
  const fields = staticFields()?.fields ?? [];
  const survey = staticSurvey();
  return (
    <div className="container">
      <header className="page-header">
        <p className="eyebrow">Sky map</p>
        <h1>Where we&apos;ve searched</h1>
        <p className="lede">
          SPHEREx maps the whole sky. We search it patch by patch for things that move. Each marked tile is a patch we have searched; the
          rest of the sky we haven&apos;t searched yet, so it can&apos;t tell us anything either way.
        </p>
      </header>
      {/* The Planet Nine region (hundreds of cells) and the empty patches' positions are left out of the HTML and arrive with the
          live survey after first paint; tiles carry only the fields the page reads, which keeps the inlined data (and its parse
          time) down. */}
      <SkyView
        initial={
          survey
            ? {
                ...survey,
                tiles: survey.tiles.map(skyTile),
                planet_nine: null,
                // Thousands of empty patches: their count is inlined, their positions arrive with the live survey.
                empty_cells: survey.empty_cells ? { ...survey.empty_cells, positions: [] } : null,
              }
            : null
        }
        fieldNames={Object.fromEntries(fields.map((f) => [f.field_id, f.name]))}
        growth={staticGrowth()}
      />
    </div>
  );
}
