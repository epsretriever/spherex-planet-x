import type { Metadata } from "next";
import Link from "next/link";
import { PrefetchData } from "@/components/PrefetchData";
import { pageMeta } from "@/lib/meta";
import { LeadsView } from "./LeadsView";

export const metadata: Metadata = pageMeta(
  "Unexplained leads",
  "The moving objects in real SPHEREx images that JPL's catalogs can't explain, ranked by the strength of the evidence, with what would confirm each one.",
  "/leads/",
);

export default function LeadsPage() {
  return (
    <div className="container">
      <PrefetchData urls={["/api/objects"]} />
      <header className="page-header">
        <p className="eyebrow">Unexplained leads</p>
        <h1>What JPL can&apos;t explain, ranked</h1>
        <p className="lede">
          Every moving object we tracked is checked against JPL&apos;s catalogs of known asteroids and comets. These are the ones no
          known object explains. Unexplained does not mean new: each could still be an artifact, a mislink, or a catalogued object
          with an uncertain orbit. They are ranked by how strong the evidence is, with what would confirm each one.
        </p>
      </header>
      <LeadsView />
      <p className="muted" style={{ marginTop: "var(--space-8)" }}>
        Identified objects are on the <Link href="/objects/">Objects</Link> page; how faint and slow an object we can find is on{" "}
        <Link href="/limits/">Detection limits</Link>.
      </p>
    </div>
  );
}
