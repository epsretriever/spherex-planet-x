import type { Metadata } from "next";
import { FieldGrid } from "@/components/FieldGrid";

export const metadata: Metadata = {
  title: "Explore the sky",
};

export default function ExplorePage() {
  return (
    <div className="container">
      <header className="page-header">
        <p className="eyebrow">Explorer</p>
        <h1>Pick a patch of sky</h1>
        <p className="lede">
          SPHEREx photographed each of these patches on several dates. Open one and flip between the pictures to see what moved.
        </p>
      </header>
      <FieldGrid />
    </div>
  );
}
