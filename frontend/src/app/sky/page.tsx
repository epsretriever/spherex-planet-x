import type { Metadata } from "next";
import { PrefetchData } from "@/components/PrefetchData";
import { staticFields, staticSurvey } from "@/lib/staticData";
import { SkyView } from "./SkyView";

export const metadata: Metadata = {
  title: "Sky map",
  description: "Every patch of sky we have searched for moving objects in SPHEREx data, on an all-sky map with the ecliptic and the Milky Way.",
};

export default function SkyPage() {
  const fields = staticFields()?.fields ?? [];
  return (
    <div className="container">
      <PrefetchData urls={["/api/survey"]} />
      <header className="page-header">
        <p className="eyebrow">Sky map</p>
        <h1>Where we&apos;ve searched</h1>
        <p className="lede">
          SPHEREx maps the whole sky. We search it patch by patch for things that move. Each marked tile is a patch we have searched; the
          rest of the sky we haven&apos;t searched yet, so it can&apos;t tell us anything either way.
        </p>
      </header>
      <SkyView initial={staticSurvey()} fieldNames={Object.fromEntries(fields.map((f) => [f.field_id, f.name]))} />
    </div>
  );
}
