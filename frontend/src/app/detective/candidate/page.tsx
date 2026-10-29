import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingBlock } from "@/components/DataState";
import { CandidateReport } from "./CandidateReport";

export const metadata: Metadata = {
  title: "Evidence report",
};

export default function CandidatePage() {
  return (
    <div className="container">
      <Suspense fallback={<LoadingBlock label="Loading the evidence report" height={480} />}>
        <CandidateReport />
      </Suspense>
    </div>
  );
}
