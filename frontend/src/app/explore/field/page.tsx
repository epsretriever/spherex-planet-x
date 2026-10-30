import type { Metadata } from "next";
import { Suspense } from "react";
import { PrefetchData } from "@/components/PrefetchData";
import { FieldPageSkeleton } from "@/components/Skeletons";
import { FieldView } from "./FieldView";

export const metadata: Metadata = {
  title: "Blink the sky",
};

export default function FieldPage() {
  return (
    <div className="container">
      <PrefetchData
        urls={["/api/fields/{id}", "/api/candidates?field_id={id}&include_injected=true", "/api/candidates?include_injected=true", "/api/fields"]}
      />
      <Suspense fallback={<FieldPageSkeleton />}>
        <FieldView />
      </Suspense>
    </div>
  );
}
