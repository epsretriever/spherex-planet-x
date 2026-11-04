import type { Metadata } from "next";
import { Moved } from "@/components/Moved";

export const metadata: Metadata = { title: "Object report", robots: { index: false } };

/** /detective/candidate/?id=X is now /objects/object/?id=obj-X. */
export default function CandidateQueryPage() {
  return <Moved to="/objects/" label="the object's report" />;
}
