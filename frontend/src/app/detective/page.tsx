import type { Metadata } from "next";
import { Suspense } from "react";
import { CardListSkeleton } from "@/components/Skeletons";
import { CandidateBrowser } from "./CandidateBrowser";

export const metadata: Metadata = {
  title: "Detective",
};

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
