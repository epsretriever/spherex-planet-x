import type { Metadata } from "next";
import { Suspense } from "react";
import { PageGuide } from "@/components/PageGuide";
import { ReportSkeleton } from "@/components/Skeletons";
import { pageMeta } from "@/lib/meta";
import { CompareView } from "./CompareView";

export const metadata: Metadata = pageMeta(
  "Compare two objects",
  "Set two moving objects from SPHEREx images side by side: their measured motion, distance, orbit and JPL catalog check, with both orbits in one 3D view.",
  "/objects/compare/",
);

export default function ComparePage() {
  return (
    <div className="container">
      <header className="page-header">
        <PageGuide>Pick any two objects to see their measurements side by side and their orbits in one view.</PageGuide>
        <h1>Compare two objects</h1>
        <p className="lede">
          Two dots that move differently are usually at different distances from the Sun. Set two objects side by side to see what the
          measurements say about each.
        </p>
      </header>
      <Suspense fallback={<ReportSkeleton />}>
        <CompareView />
      </Suspense>
    </div>
  );
}
