import type { Metadata } from "next";
import { Suspense } from "react";
import { FieldPageSkeleton } from "@/components/Skeletons";
import { FieldView } from "./FieldView";

export const metadata: Metadata = {
  title: "Blink the sky",
};

export default function FieldPage() {
  return (
    <div className="container">
      <Suspense fallback={<FieldPageSkeleton />}>
        <FieldView />
      </Suspense>
    </div>
  );
}
