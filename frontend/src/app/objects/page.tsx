import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { PrefetchData } from "@/components/PrefetchData";
import { staticNameSeed, staticObjects } from "@/lib/staticData";
import { ObjectListView } from "./ObjectListView";

export const metadata: Metadata = pageMeta(
  "Objects",
  "Every moving object our pipeline tracked in SPHEREx data, linked across visits, with its distance and orbit.",
  "/objects/",
);

export default function ObjectsPage() {
  return (
    <div className="container">
      <PrefetchData urls={["/api/objects", "/api/candidates?include_injected=true", "/api/fields"]} />
      <header className="page-header">
        <p className="eyebrow">Objects</p>
        <h1>Every object we&apos;ve tracked</h1>
        <p className="lede">
          An object is one body in the solar system: every sighting we linked to it, across visits and patches of sky. Open one to follow
          its track, see how far away it is and, once we can fit one, its orbit.
        </p>
      </header>
      <ObjectListView initial={staticObjects()} seed={staticNameSeed()} />
    </div>
  );
}
