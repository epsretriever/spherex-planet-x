import type { Metadata } from "next";
import { pageMeta } from "@/lib/meta";
import { objectHref } from "@/lib/routes";
import { notFound } from "next/navigation";
import { PrefetchData } from "@/components/PrefetchData";
import { buildNames } from "@/lib/names";
import { NO_PAGES, staticCandidate, staticNameSeed, staticObject, staticObjects } from "@/lib/staticData";
import { ObjectView } from "../object/ObjectView";

// One page per published object, rendered at build time; the live API replaces it in the browser.
export const dynamicParams = false;

export function generateStaticParams() {
  const ids = staticObjects()?.objects.map((o) => ({ objectId: o.object_id })) ?? [];
  return ids.length ? ids : [{ objectId: NO_PAGES }];
}

type Params = { params: Promise<{ objectId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = (await params).objectId;
  const o = staticObject(id);
  if (!o) return {};
  const seed = staticNameSeed();
  const name = buildNames(seed.candidates, seed.fields).get(o.candidate_ids[0] ?? "")?.title ?? id;
  return pageMeta(name, o.summary_plain, objectHref(id));
}

export default async function ObjectPage({ params }: Params) {
  const { objectId } = await params;
  const object = staticObject(objectId);
  if (!object) notFound();
  return (
    <div className="container">
      <PrefetchData
        urls={[`/api/objects/${objectId}`, `/api/candidates/${object.candidate_ids[0] ?? ""}`, "/api/candidates?include_injected=true", "/api/fields"]}
      />
      <ObjectView
        id={objectId}
        initial={object}
        initialCandidate={object.candidate_ids[0] ? staticCandidate(object.candidate_ids[0]) : null}
        seed={staticNameSeed()}
      />
    </div>
  );
}
