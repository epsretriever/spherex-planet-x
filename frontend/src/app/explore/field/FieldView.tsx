"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { BlinkViewer } from "@/components/BlinkViewer";
import { Deferred } from "@/components/Deferred";
import { ErrorState } from "@/components/DataState";
import { FieldPageSkeleton, ViewerSkeleton } from "@/components/Skeletons";
import { Term } from "@/components/Term";
import { getCandidates, getField } from "@/lib/api";
import type { FieldDetail, Mover } from "@/lib/contract";
import { formatUtcDate } from "@/lib/format";
import { SITE_NAME } from "@/lib/site";
import { useData } from "@/lib/useData";
import { useObjectNames, type NameSeed } from "@/lib/useObjectNames";
import styles from "./FieldView.module.css";

/**
 * One field in the Explorer. `initial` is the field as published when the site was built (the
 * API serves the same file), so prerendered pages skip that request; the candidate list is
 * always fetched for each object's live JPL status.
 */
export function FieldView({ id, initial, seed }: { id: string | null; initial?: FieldDetail | null; seed?: NameSeed }) {
  const state = useData(id && !initial ? `field:${id}` : null, (signal) => getField(id!, signal));
  // The field file is static; the candidate list carries each object's live JPL status.
  const live = useData(id ? `field-candidates:${id}` : null, (signal) =>
    getCandidates({ field_id: id!, include_injected: true }, signal),
  );
  const { nameFor } = useObjectNames(seed);
  const loaded = initial ?? (state.status === "ok" ? state.data : null);

  useEffect(() => {
    if (loaded && !initial) document.title = `${loaded.name} · ${SITE_NAME}`;
  }, [loaded, initial]);

  if (!id) return <ErrorState reason="not_found" />;
  if (!loaded && state.status === "loading") {
    return (
      <>
        <Crumbs />
        <FieldPageSkeleton />
      </>
    );
  }
  if (!loaded && state.status === "error") {
    return (
      <>
        <Crumbs />
        <ErrorState reason={state.error.reason} message={state.error.message} onRetry={state.retry} />
      </>
    );
  }

  const f = loaded!;
  const liveById = new Map(live.status === "ok" ? live.data.candidates.map((c) => [c.candidate_id, c]) : []);
  const movers: Mover[] = f.movers.map((m) => {
    const c = liveById.get(m.candidate_id);
    return c ? { ...m, classification: c.classification, label_plain: c.label_plain } : m;
  });
  const moverName = (m: Mover) =>
    nameFor({ candidate_id: m.candidate_id, classification: m.classification, designation: liveById.get(m.candidate_id)?.known_object_designation }).title;
  const realMovers = f.movers.filter((m) => m.classification !== "injected").length;

  return (
    <div className="fade-in">
      <Crumbs />
      <div className={styles.layout}>
        <header className={styles.header}>
          <p className="eyebrow">Explorer · {f.epochs.length} images</p>
          <h1>{f.name}</h1>
          <p className="lede">{f.blurb}</p>
        </header>

        <div className={styles.viewer}>
          <Deferred fallback={<ViewerSkeleton label="Loading the images" />}>
            <BlinkViewer fieldName={f.name} wcs={f.wcs} epochs={f.epochs} blinkPairs={f.blink_pairs} movers={movers} moverName={moverName} />
          </Deferred>
        </div>

        <aside className={styles.aside}>
          <div className={`card ${styles.panel}`}>
            <h2>What&apos;s in this patch</h2>
            <p>{f.summary_plain}</p>
            <dl className={styles.facts}>
              <div>
                <dt>Moving objects</dt>
                <dd className="mono">{realMovers}</dd>
              </div>
              <div>
                <dt>Dates</dt>
                <dd className="mono">
                  {f.epochs.length ? `${formatUtcDate(f.epochs.reduce((a, b) => (a.mjd < b.mjd ? a : b)).time_utc)} – ${formatUtcDate(f.epochs.reduce((a, b) => (a.mjd > b.mjd ? a : b)).time_utc)}` : "—"}
                </dd>
              </div>
              <div>
                <dt>Sky position</dt>
                <dd className="mono">
                  RA {f.center.ra_deg.toFixed(3)}°, Dec {f.center.dec_deg.toFixed(3)}°
                </dd>
              </div>
              <div>
                <dt>
                  From the <Term term="ecliptic">ecliptic</Term>
                </dt>
                <dd className="mono">{f.ecliptic_lat_deg.toFixed(1)}°</dd>
              </div>
              <div>
                <dt>Patch size</dt>
                <dd className="mono">
                  {f.size_deg.width.toFixed(2)}° × {f.size_deg.height.toFixed(2)}°
                </dd>
              </div>
            </dl>
            {realMovers > 0 && (
              <Link className="button" href={`/detective/?field=${encodeURIComponent(f.field_id)}`}>
                See the evidence for each →
              </Link>
            )}
          </div>

          <div className={`card ${styles.panel}`}>
            <h2>How to look</h2>
            <ol className={styles.tips}>
              <li>Let it blink. Your eye is great at spotting the one dot that jumps.</li>
              <li>Switch to Swipe and drag the divider across a suspicious spot.</li>
              <li>Tap &ldquo;Show me what moved&rdquo; to see what our software found.</li>
            </ol>
          </div>

          <p className={`mono ${styles.versions}`}>
            {f.data_release} · image stretch asinh, {f.stretch.units ?? "MJy/sr"}
            {f.stretch.zodi_subtracted ? ", zodiacal light removed" : ""} · schema {f.schema_version ?? "1.0"} · pipeline{" "}
            {f.pipeline_version}
          </p>
        </aside>
      </div>
    </div>
  );
}

function Crumbs() {
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      <Link href="/explore/" prefetch={false}>← All patches of sky</Link>
    </nav>
  );
}

/** The `?id=` route: for objects published after the site was built, and old links. */
export function FieldFromQuery() {
  return <FieldView id={useSearchParams().get("id")} />;
}
