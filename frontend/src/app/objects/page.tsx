import type { Metadata } from "next";
import { Suspense } from "react";
import { PageGuide } from "@/components/PageGuide";
import { PrefetchData } from "@/components/PrefetchData";
import { CardListSkeleton } from "@/components/Skeletons";
import { pageMeta } from "@/lib/meta";
import { ObjectsHub } from "./ObjectsHub";

export const metadata: Metadata = pageMeta(
  "Objects",
  "Every moving object found in real NASA SPHEREx images: search and filter them, see the unexplained leads ranked, the ones JPL identified, and the patches of sky we searched.",
  "/objects/",
);

export default function ObjectsPage() {
  return (
    <div className="container">
      <PrefetchData urls={["/api/candidates", "/api/objects", "/api/fields"]} />
      <header className="page-header">
        <PageGuide>Find any moving object we tracked, and open its evidence report.</PageGuide>
        <h1>Objects</h1>
        <p className="lede">
          Everything our pipeline caught moving in SPHEREx images. Most are known asteroids; the unexplained ones are where the detective
          work starts.
        </p>
      </header>
      <Suspense fallback={<CardListSkeleton label="Loading objects" />}>
        <ObjectsHub />
      </Suspense>
    </div>
  );
}
