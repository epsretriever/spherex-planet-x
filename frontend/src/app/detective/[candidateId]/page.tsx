import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrefetchData } from "@/components/PrefetchData";
import { buildNames, toNameInput } from "@/lib/names";
import { NO_PAGES, staticCandidate, staticCandidates, staticNameSeed } from "@/lib/staticData";
import { CandidateReport } from "../candidate/CandidateReport";

// One page per published object, rendered at build time from public/data/. The live report
// (with JPL results) replaces it in the browser.
export const dynamicParams = false;

export function generateStaticParams() {
  const ids = staticCandidates()?.candidates.map((c) => ({ candidateId: c.candidate_id })) ?? [];
  return ids.length ? ids : [{ candidateId: NO_PAGES }];
}

type Params = { params: Promise<{ candidateId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = (await params).candidateId;
  const c = staticCandidate(id);
  if (!c) return {};
  const seed = staticNameSeed();
  const name = buildNames(seed.candidates.map(toNameInput), seed.fields).get(id)?.title ?? id;
  return { title: name, description: c.summary_plain };
}

export default async function CandidatePage({ params }: Params) {
  const { candidateId } = await params;
  const candidate = staticCandidate(candidateId);
  if (!candidate) notFound();
  return (
    <div className="container">
      <PrefetchData urls={[`/api/candidates/${candidateId}`, "/api/candidates?include_injected=true", "/api/fields"]} />
      <CandidateReport id={candidateId} initial={candidate} seed={staticNameSeed()} />
    </div>
  );
}
