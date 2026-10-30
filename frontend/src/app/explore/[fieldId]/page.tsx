import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrefetchData } from "@/components/PrefetchData";
import { NO_PAGES, staticField, staticFields, staticNameSeed } from "@/lib/staticData";
import { FieldView } from "../field/FieldView";

// One page per published field, rendered at build time from public/data/.
export const dynamicParams = false;

export function generateStaticParams() {
  const ids = staticFields()?.fields.map((f) => ({ fieldId: f.field_id })) ?? [];
  return ids.length ? ids : [{ fieldId: NO_PAGES }];
}

type Params = { params: Promise<{ fieldId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const field = staticField((await params).fieldId);
  return field ? { title: field.name, description: field.blurb } : {};
}

export default async function FieldPage({ params }: Params) {
  const { fieldId } = await params;
  const field = staticField(fieldId);
  if (!field) notFound();
  return (
    <div className="container">
      <PrefetchData urls={[`/api/candidates?field_id=${fieldId}&include_injected=true`, "/api/candidates?include_injected=true", "/api/fields"]} />
      <FieldView id={fieldId} initial={field} seed={staticNameSeed()} />
    </div>
  );
}
