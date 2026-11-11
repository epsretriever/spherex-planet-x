"use client";

import Link from "next/link";
import { compareHref } from "@/lib/routes";
import { CopyLink } from "./CopyLink";

/**
 * What a reader can do with one object's report: share it, set it beside another object, and
 * (for real objects only) open its measured positions in the Minor Planet Center's ADES format.
 */
export function ObjectActions({ objectId, title, simulated }: { objectId: string; title: string; simulated: boolean }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
      <CopyLink title={title} />
      <Link className="button" href={compareHref(objectId)} prefetch={false} aria-label="Compare with another object">
        Compare
      </Link>
      {!simulated && (
        <a className="button" href={`/api/objects/${encodeURIComponent(objectId)}/ades.xml`} aria-label="Astrometry (ADES XML)"
          title="Measured positions as ADES 2022 XML: a draft for review, never submitted anywhere by this site"
        >
          ADES XML
        </a>
      )}
    </div>
  );
}
