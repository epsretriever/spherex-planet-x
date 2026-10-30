import type { Metadata } from "next";
import { Suspense } from "react";
import { PrefetchData } from "@/components/PrefetchData";
import { ReportSkeleton } from "@/components/Skeletons";
import { CandidateReport } from "./CandidateReport";

export const metadata: Metadata = {
  title: "Evidence report",
};

export default function CandidatePage() {
  return (
    <div className="container">
      <PrefetchData urls={["/api/candidates/{id}", "/api/candidates?include_injected=true", "/api/fields"]} />
      <Suspense fallback={<ReportSkeleton />}>
        <CandidateReport />
      </Suspense>
    </div>
  );
}
