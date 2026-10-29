import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingBlock } from "@/components/DataState";
import { SimulatedBanner } from "@/components/SimulatedBanner";
import { InjectionView } from "./InjectionView";

export const metadata: Metadata = {
  title: "Testing the pipeline (SIMULATED)",
};

export default function SimulatedPage() {
  return (
    <div className="container">
      <SimulatedBanner />
      <header className="page-header" style={{ marginTop: "var(--space-8)" }}>
        <p className="eyebrow">Injection test · SIMULATED</p>
        <h1>How good is our detective?</h1>
        <p className="lede">
          To know what our software can and can&apos;t find, we planted fake moving objects in real SPHEREx images, then ran the
          pipeline without telling it where they were. Here is how many it found, by how bright and how fast they were.
        </p>
      </header>
      <Suspense fallback={<LoadingBlock label="Loading the injection test" height={420} />}>
        <InjectionView />
      </Suspense>
    </div>
  );
}
