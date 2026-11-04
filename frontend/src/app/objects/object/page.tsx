import type { Metadata } from "next";
import { Suspense } from "react";
import { PrefetchData } from "@/components/PrefetchData";
import { ReportSkeleton } from "@/components/Skeletons";
import { ObjectReportFromQuery } from "../report/ObjectReport";

export const metadata: Metadata = {
  title: "Object",
};

export default function ObjectQueryPage() {
  return (
    <div className="container">
      <PrefetchData urls={["/api/objects/{id}", "/api/candidates?include_injected=true", "/api/fields"]} />
      <Suspense fallback={<ReportSkeleton />}>
        <ObjectReportFromQuery />
      </Suspense>
    </div>
  );
}
