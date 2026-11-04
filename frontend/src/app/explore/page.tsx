import type { Metadata } from "next";
import { Moved } from "@/components/Moved";

export const metadata: Metadata = { title: "Patches of sky", robots: { index: false }, alternates: { canonical: "/objects/?view=patches" } };

/** The list of patches is now a tab on the Objects page; each patch keeps its /explore/{id}/ page. */
export default function ExplorePage() {
  return <Moved to="/objects/?view=patches" label="Objects › Patches of sky" />;
}
