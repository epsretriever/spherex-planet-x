import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { Suspense } from "react";
import { CardListSkeleton } from "@/components/Skeletons";
import { CandidateBrowser } from "./CandidateBrowser";

export const metadata: Metadata = pageMeta(
  "Detective",
  "Every moving object found in real SPHEREx images, with its evidence report: positions, motion, signal quality, the JPL check and what could make it wrong.",
  "/detective/",
);

export default function DetectivePage() {
  return (
    <div className="container">
      <header className="page-header">
        <p className="eyebrow">Detective</p>
        <h1>Moving-object candidates</h1>
        <p className="lede">
          Every dot our pipeline caught moving, with the evidence for and against it. Most turn out to be known asteroids. The
          unexplained ones are where the detective work starts.
        </p>
      </header>
      <Suspense fallback={<CardListSkeleton label="Loading candidates" />}>
        <CandidateBrowser />
      </Suspense>
    </div>
  );
}
