"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { BlinkViewer } from "@/components/BlinkViewer";
import { ErrorState } from "@/components/DataState";
import { FieldPageSkeleton } from "@/components/Skeletons";
import { Term } from "@/components/Term";
import { getField } from "@/lib/api";
import { formatUtcDate } from "@/lib/format";
import { SITE_NAME } from "@/lib/site";
import { useData } from "@/lib/useData";
import styles from "./FieldView.module.css";

export function FieldView() {
  const id = useSearchParams().get("id");
  const state = useData(id ? `field:${id}` : null, (signal) => getField(id!, signal));

  useEffect(() => {
    if (state.status === "ok") document.title = `${state.data.name} · ${SITE_NAME}`;
  }, [state]);

  if (!id) return <ErrorState reason="not_found" />;
  if (state.status === "loading") {
    return (
      <>
        <Crumbs />
        <FieldPageSkeleton />
      </>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <Crumbs />
        <ErrorState reason={state.error.reason} message={state.error.message} onRetry={state.retry} />
      </>
    );
  }

  const f = state.data;
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
          <BlinkViewer fieldName={f.name} wcs={f.wcs} epochs={f.epochs} blinkPairs={f.blink_pairs} movers={f.movers} />
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
      <Link href="/explore/">← All patches of sky</Link>
    </nav>
  );
}
