import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingBlock } from "@/components/DataState";
import { FieldView } from "./FieldView";

export const metadata: Metadata = {
  title: "Blink the sky",
};

export default function FieldPage() {
  return (
    <div className="container">
      <Suspense fallback={<LoadingBlock label="Loading this patch of sky" height={480} />}>
        <FieldView />
      </Suspense>
    </div>
  );
}
