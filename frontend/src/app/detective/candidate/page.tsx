import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportSkeleton } from "@/components/Skeletons";
import { CandidateReport } from "./CandidateReport";

export const metadata: Metadata = {
  title: "Evidence report",
};

export default function CandidatePage() {
  return (
    <div className="container">
      <Suspense fallback={<ReportSkeleton />}>
        <CandidateReport />
      </Suspense>
    </div>
  );
}
