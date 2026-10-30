import type { Metadata } from "next";
import { Suspense } from "react";
import { StudySkeleton } from "@/components/Skeletons";
import { SimulatedBanner } from "@/components/SimulatedBanner";
import { LimitsView } from "./LimitsView";

export const metadata: Metadata = {
  title: "Detection limits",
  description: "How faint and how slow an object our pipeline can find in real SPHEREx images, measured by planting simulated objects.",
};

export default function LimitsPage() {
  return (
    <div className="container">
      <header className="page-header">
        <p className="eyebrow">Detection limits</p>
        <h1>Where could Planet X still be hiding?</h1>
        <p className="lede">
          An object we didn&apos;t find isn&apos;t proof there&apos;s nothing there; it might just be too faint or too slow for us to
          catch. So we measured our blind spots: we planted simulated moving objects in real SPHEREx images and ran the pipeline
          without telling it where they were.
        </p>
      </header>
      <SimulatedBanner>
        The objects on this page are simulated: planted on purpose to test our software. They are not real objects in the sky.
      </SimulatedBanner>
      <div style={{ marginTop: "var(--space-8)" }}>
        <Suspense fallback={<StudySkeleton />}>
          <LimitsView />
        </Suspense>
      </div>
    </div>
  );
}
