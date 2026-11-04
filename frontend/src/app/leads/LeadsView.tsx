"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ClassificationBadge } from "@/components/ClassificationBadge";
import { EmptyState, ErrorState } from "@/components/DataState";
import { CardListSkeleton } from "@/components/Skeletons";
import { assetUrl, getObjects } from "@/lib/api";
import { getLeadSeeds } from "@/lib/leadsClient";
import { formatUtcDate, formatUtcDateTime } from "@/lib/format";
import {
  CONFIDENCE_DEFINITION,
  followUpAdvice,
  formatAngle,
  formatDec,
  formatRa,
  isUnidentified,
  rankLeads,
  whyNot,
  whyReal,
  withLiveStatus,
  type Confidence,
  type Lead,
} from "@/lib/leads";
import { candidateHref, objectHref } from "@/lib/routes";
import { useData } from "@/lib/useData";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { WhenVisible } from "@/components/WhenVisible";
import { FollowUpDownloads } from "@/components/followup/FollowUpDownloads";
import styles from "./Leads.module.css";

type Ranked = Lead & { confidence: Confidence };

/** Cards rendered before "Show all" (each holds a blink, two charts and a download panel). */
const FIRST = 10;

export function LeadsView() {
  const [showAll, setShowAll] = useState(false);
  const seedState = useData("lead-seeds", (signal) => getLeadSeeds(signal));
  const state = useData("objects", (signal) => getObjects(signal));
  const seeds = useMemo(() => (seedState.status === "ok" ? seedState.data : []), [seedState]);
  const { leads, newSinceBuild, live } = useMemo(() => {
    if (state.status !== "ok") return { leads: rankLeads(seeds), newSinceBuild: 0, live: false };
    const liveObj = new Map(state.data.objects.map((o) => [o.object_id, o]));
    const kept = seeds
      .filter((l) => {
        const o = liveObj.get(l.object_id);
        return o !== undefined && isUnidentified(o.classification);
      })
      .map((l) => {
        const o = liveObj.get(l.object_id)!;
        return withLiveStatus({ ...l, classification: o.classification }, o.known_object_checked);
      });
    const seedIds = new Set(seeds.map((s) => s.object_id));
    const extra = state.data.objects.filter((o) => isUnidentified(o.classification) && !seedIds.has(o.object_id)).length;
    return { leads: rankLeads(kept), newSinceBuild: extra, live: true };
  }, [seeds, state]);

  if (state.status === "loading" || seedState.status === "loading") return <CardListSkeleton label="Loading the latest JPL results" />;
  if (seedState.status === "error") return <ErrorState reason={seedState.error.reason} message={seedState.error.message} onRetry={seedState.retry} />;
  if (!leads.length) {
    return (
      <EmptyState title="No unexplained objects right now">
        <p>JPL&apos;s catalogs explain every object we&apos;ve tracked so far. New patches of sky are searched several times a day.</p>
      </EmptyState>
    );
  }
  const counts = { strong: 0, moderate: 0, weak: 0 };
  for (const l of leads) counts[l.confidence.level]++;
  return (
    <>
      {!live && (
        <p className={styles.notice} role="status">
          The latest JPL results couldn&apos;t be loaded, so this shows every object not identified when the site was built. Some may
          have been identified since.
        </p>
      )}
      <div className={styles.summary}>
        <p>
          <span className="mono">{leads.length}</span> unexplained {leads.length === 1 ? "object" : "objects"}:{" "}
          <span className="mono">{counts.strong}</span> strong, <span className="mono">{counts.moderate}</span> moderate and{" "}
          <span className="mono">{counts.weak}</span> weak leads.
          {newSinceBuild > 0 && (
            <>
              {" "}
              {newSinceBuild} more arrived after this page was built; they are on the <Link href="/objects/">Objects</Link> page.
            </>
          )}
        </p>
        <details className={styles.definition}>
          <summary>How the confidence score works</summary>
          <p>{CONFIDENCE_DEFINITION}</p>
        </details>
      </div>
      <ol className={styles.list}>
        {(showAll ? leads : leads.slice(0, FIRST)).map((l, i) => (
          <li key={l.object_id}>
            {i < 2 ? (
              <LeadCard lead={l} rank={i + 1} />
            ) : (
              <WhenVisible minHeight={900}>
                <LeadCard lead={l} rank={i + 1} />
              </WhenVisible>
            )}
          </li>
        ))}
      </ol>
      {!showAll && leads.length > FIRST && (
        <button type="button" className={`button ${styles.more}`} onClick={() => setShowAll(true)}>
          Show all {leads.length} leads
        </button>
      )}
    </>
  );
}

const LEVEL_LABEL = { strong: "Strong lead", moderate: "Moderate lead", weak: "Weak lead" } as const;

function LeadCard({ lead, rank }: { lead: Ranked; rank: number }) {
  const c = lead.confidence;
  const headingId = `lead-${lead.object_id}`;
  return (
    <article className={`card ${styles.card}`} aria-labelledby={headingId} id={lead.object_id}>
      <header className={styles.cardHead}>
        <span className={`mono ${styles.rank}`} aria-label={`Rank ${rank}`}>
          #{rank}
        </span>
        <div className={styles.titleBlock}>
          <h2 id={headingId} className={styles.title}>
            <Link href={objectHref(lead.object_id)}>{lead.name}</Link>
          </h2>
          <p className={`mono ${styles.id}`}>{lead.object_id}</p>
          <div className={styles.badges}>
            <ClassificationBadge value={lead.classification} size="sm" />
          </div>
        </div>
        <div className={`${styles.score} ${styles[c.level]}`}>
          <span className={`mono ${styles.scoreValue}`}>{c.score}</span>
          <span className={styles.scoreLabel}>{LEVEL_LABEL[c.level]}</span>
        </div>
      </header>

      <div className={styles.body}>
        <LeadBlink lead={lead} />
        <div className={styles.facts}>
          <ul className={styles.parts} aria-label="Confidence score breakdown">
            {c.parts.map((p) => (
              <li key={p.key}>
                <span className={styles.partLabel}>{p.label}</span>
                <span className={styles.bar} aria-hidden="true">
                  <span style={{ width: `${(100 * p.points) / p.max}%` }} />
                </span>
                <span className={`mono ${styles.partPts}`}>
                  {Math.round(p.points)}/{p.max}
                </span>
                <span className={styles.partDetail}>{p.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className={styles.cases}>
        <section aria-label="Why it might be real">
          <h3 className={styles.caseFor}>Why it might be real</h3>
          <ul>
            {whyReal(lead).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
        <section aria-label="Why it might not be">
          <h3 className={styles.caseAgainst}>Why it might not be (or might not be new)</h3>
          <ul>
            {whyNot(lead).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className={styles.confirm} aria-label="What would confirm it">
        <h3>What would confirm it</h3>
        <div className={styles.confirmGrid}>
          <div>
            {lead.prediction ? (
              <dl className={styles.pred}>
                <div>
                  <dt>Predicted position, {formatUtcDate(lead.prediction.time_utc)}</dt>
                  <dd className="mono">
                    {formatRa(lead.prediction.ra_deg)} {formatDec(lead.prediction.dec_deg)}
                  </dd>
                </div>
                <div>
                  <dt>Uncertainty (1σ ellipse)</dt>
                  <dd className="mono">
                    {formatAngle(lead.prediction.sigma_major_arcsec)} × {formatAngle(lead.prediction.sigma_minor_arcsec)}, PA{" "}
                    {Math.round(lead.prediction.sigma_pa_deg)}°
                  </dd>
                </div>
                {lead.last && (
                  <div>
                    <dt>Last seen by SPHEREx, {formatUtcDateTime(lead.last.time_utc)}</dt>
                    <dd className="mono">
                      {formatRa(lead.last.ra_deg)} {formatDec(lead.last.dec_deg)}
                    </dd>
                  </div>
                )}
              </dl>
            ) : null}
            <p className={styles.advice}>{followUpAdvice(lead)}</p>
            {lead.prediction?.note_plain && <p className={styles.note}>{lead.prediction.note_plain}</p>}
          </div>
          {lead.prediction && <EllipsePlot p={lead.prediction} />}
        </div>
        <FollowUpDownloads objectId={lead.object_id} candidateId={lead.candidate_id} />
      </section>

      <footer className={styles.links}>
        <Link href={candidateHref(lead.candidate_id)}>Full evidence report →</Link>
        <Link href={objectHref(lead.object_id)}>Object, distance and orbit →</Link>
      </footer>
    </article>
  );
}

/** Flips between the first image of each visit, cropped to the track, with the measured positions circled. */
function LeadBlink({ lead }: { lead: Lead }) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const n = lead.frames.length;
  useEffect(() => {
    if (!playing || reduced || n < 2) return;
    const t = setInterval(() => setI((k) => (k + 1) % n), 800);
    return () => clearInterval(t);
  }, [playing, reduced, n]);
  if (!lead.grid || n === 0) return <div className={styles.blinkEmpty}>No images published for this object.</div>;
  const xs = lead.frames.map((f) => f.x_grid);
  const ys = lead.frames.map((f) => f.y_grid);
  const span = Math.max(48, Math.max(...xs) - Math.min(...xs) + 28, Math.max(...ys) - Math.min(...ys) + 28);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const vb = `${cx - span / 2} ${cy - span / 2} ${span} ${span}`;
  const f = lead.frames[i % n]!;
  const r = Math.max(2.5, span / 22);
  return (
    <figure className={styles.blink}>
      <svg viewBox={vb} className={styles.blinkSvg} role="img" aria-label={`Blink of ${n} SPHEREx images of ${lead.name}; frame ${(i % n) + 1}, ${formatUtcDateTime(f.time_utc)}`}>
        {lead.frames.map((fr, k) => (
          <image
            key={fr.epoch_id}
            href={assetUrl(fr.url)}
            x={0}
            y={0}
            width={lead.grid!.width_px}
            height={lead.grid!.height_px}
            style={{ opacity: k === i % n ? 1 : 0 }}
            preserveAspectRatio="none"
          />
        ))}
        {lead.frames.map((fr, k) => (
          <circle
            key={`c${fr.epoch_id}`}
            cx={fr.x_grid}
            cy={fr.y_grid}
            r={r}
            fill="none"
            stroke={k === i % n ? "var(--track)" : "rgb(124 240 200 / 0.3)"}
            strokeWidth={span / 110}
          />
        ))}
      </svg>
      <figcaption className={styles.blinkCaption}>
        <span className="mono">
          {(i % n) + 1}/{n} · {formatUtcDateTime(f.time_utc)}
          {f.wavelength_um ? ` · ${f.wavelength_um.toFixed(2)} µm` : ""}
        </span>
        {n > 1 && (
          <span className={styles.blinkControls}>
            <button type="button" className={styles.iconButton} onClick={() => setI((k) => (k - 1 + n) % n)} aria-label="Previous image">
              ‹
            </button>
            {!reduced && (
              <button type="button" className={styles.iconButton} onClick={() => setPlaying((p) => !p)} aria-pressed={!playing}>
                {playing ? "Pause" : "Play"}
              </button>
            )}
            <button type="button" className={styles.iconButton} onClick={() => setI((k) => (k + 1) % n)} aria-label="Next image">
              ›
            </button>
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** The 1σ and 3σ uncertainty ellipses around the predicted position, to scale, north up and east left. */
function EllipsePlot({ p }: { p: NonNullable<Lead["prediction"]> }) {
  const a3 = 3 * p.sigma_major_arcsec;
  const half = a3 * 1.15;
  const scale = 90 / half;
  // Position angle is measured from north through east; on the sky with east left that is a
  // clockwise-from-up rotation mirrored, i.e. an SVG rotation of -PA from the vertical.
  const rot = -p.sigma_pa_deg;
  const ry1 = p.sigma_major_arcsec * scale;
  const rx1 = Math.max(0.8, p.sigma_minor_arcsec * scale);
  const bar = niceBar(half);
  return (
    <figure className={styles.ellipse}>
      <svg viewBox="-100 -100 200 200" role="img" aria-label={`Uncertainty ellipse: ${formatAngle(p.sigma_major_arcsec)} by ${formatAngle(p.sigma_minor_arcsec)} at 1 sigma, three times that at 3 sigma`}>
        <rect x={-100} y={-100} width={200} height={200} fill="var(--surface-2)" rx={8} />
        <line x1={-95} y1={0} x2={95} y2={0} stroke="var(--border)" />
        <line x1={0} y1={-95} x2={0} y2={95} stroke="var(--border)" />
        <g transform={`rotate(${rot})`}>
          <ellipse rx={rx1 * 3} ry={ry1 * 3} fill="rgb(255 209 102 / 0.08)" stroke="var(--status-unexplained)" strokeDasharray="4 3" />
          <ellipse rx={rx1} ry={ry1} fill="rgb(255 209 102 / 0.2)" stroke="var(--status-unexplained)" />
        </g>
        <circle r={2.5} fill="var(--text)" />
        <text x={0} y={-86} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
          N
        </text>
        <text x={-88} y={4} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
          E
        </text>
        <line x1={50} y1={88} x2={50 + bar.arcsec * scale} y2={88} stroke="var(--text)" strokeWidth={2} />
        <text x={50 + (bar.arcsec * scale) / 2} y={82} textAnchor="middle" fontSize={9} fill="var(--text)">
          {bar.label}
        </text>
      </svg>
      <figcaption>1σ (solid) and 3σ (dashed) uncertainty, to scale.</figcaption>
    </figure>
  );
}

function niceBar(halfArcsec: number) {
  const target = halfArcsec * 0.4;
  const steps = [1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 18000, 36000, 72000, 180000, 360000];
  const s = steps.reduce((best, x) => (x <= target ? x : best), steps[0]!);
  return { arcsec: s, label: formatAngle(s) };
}
