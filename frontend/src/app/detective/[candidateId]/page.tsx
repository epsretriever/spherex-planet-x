import type { Metadata } from "next";
import { Moved } from "@/components/Moved";
import { candidateHref } from "@/lib/routes";
import { NO_PAGES, staticCandidates } from "@/lib/staticData";

// Old evidence-report URLs: each forwards to its object's report, the one canonical page.
export const dynamicParams = false;

export function generateStaticParams() {
  const ids = staticCandidates()?.candidates.map((c) => ({ candidateId: c.candidate_id })) ?? [];
  return ids.length ? ids : [{ candidateId: NO_PAGES }];
}

type Params = { params: Promise<{ candidateId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const id = (await params).candidateId;
  return { title: "Object report", robots: { index: false }, alternates: { canonical: candidateHref(id) } };
}

export default async function CandidatePage({ params }: Params) {
  const { candidateId } = await params;
  return <Moved to={candidateHref(candidateId)} label="this object's report" />;
}
