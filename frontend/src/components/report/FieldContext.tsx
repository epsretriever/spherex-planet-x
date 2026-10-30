"use client";

import Link from "next/link";
import { useMemo } from "react";
import { getField } from "@/lib/api";
import type { CandidateDetail, FieldDetail } from "@/lib/contract";
import { projectionMatches, skyToGrid } from "@/lib/grid";
import { fieldHref } from "@/lib/routes";
import { useData } from "@/lib/useData";
import { BlinkViewer, type PredictedMarker } from "../BlinkViewer";
import { ErrorState } from "../DataState";
import { ViewerSkeleton } from "../Skeletons";
import styles from "./report.module.css";

/** Zoom that fits the track with some margin, as a power of two (the viewer zooms in 2× steps). */
function fitZoom(xs: number[], ys: number[], w: number, h: number) {
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 24;
  const z = Math.min(w, h) / span;
  return Math.max(1, Math.min(8, 2 ** Math.floor(Math.log2(Math.max(1, z)))));
}

function useContext(candidate: CandidateDetail, field: FieldDetail | null) {
  return useMemo(() => {
    if (!field) return null;
    const ids = new Set(candidate.detections.map((d) => d.epoch_id));
    const epochs = field.epochs.filter((e) => ids.has(e.epoch_id));
    const pairs = field.blink_pairs.filter((p) => ids.has(p.epoch_id_a) && ids.has(p.epoch_id_b));
    const xs = candidate.detections.map((d) => d.x_grid);
    const ys = candidate.detections.map((d) => d.y_grid);
    const focus = xs.length
      ? {
          x_grid: xs.reduce((a, b) => a + b, 0) / xs.length,
          y_grid: ys.reduce((a, b) => a + b, 0) / ys.length,
          zoom: fitZoom(xs, ys, field.wcs.width_px, field.wcs.height_px),
        }
      : undefined;
    // Only draw predicted positions if our projection reproduces the measured grid positions.
    let predicted: PredictedMarker[] = [];
    const perEpoch = candidate.known_object.matched ? (candidate.known_object.per_epoch ?? []) : [];
    if (perEpoch.length && projectionMatches(candidate.detections, field.wcs, 1)) {
      predicted = perEpoch.flatMap((p) => {
        const g = skyToGrid(p.predicted_ra_deg, p.predicted_dec_deg, field.wcs);
        return g ? [{ epoch_id: p.epoch_id, x_grid: g.x, y_grid: g.y }] : [];
      });
    }
    const mover = field.movers.find((m) => m.candidate_id === candidate.candidate_id);
    const movers = mover
      ? [mover]
      : [
          {
            candidate_id: candidate.candidate_id,
            classification: candidate.classification,
            label_plain: candidate.label_plain,
            quality_level: candidate.scores.quality_level,
            rate_arcsec_per_hr: candidate.motion.rate_arcsec_per_hr,
            track: candidate.detections.map((d) => ({
              epoch_id: d.epoch_id,
              time_utc: d.time_utc,
              mjd: d.mjd,
              ra_deg: d.ra_deg,
              dec_deg: d.dec_deg,
              x_grid: d.x_grid,
              y_grid: d.y_grid,
            })),
          },
        ];
    return { epochs, pairs, focus, predicted, movers };
  }, [candidate, field]);
}

export function FieldContext({ candidate }: { candidate: CandidateDetail }) {
  const state = useData(`field:${candidate.field_id}`, (signal) => getField(candidate.field_id, signal));
  const ctx = useContext(candidate, state.status === "ok" ? state.data : null);

  if (state.status === "loading") return <ViewerSkeleton />;
  if (state.status === "error") return <ErrorState compact reason={state.error.reason} message={state.error.message} onRetry={state.retry} />;
  if (!ctx || ctx.epochs.length === 0) return null;

  return (
    <div>
      <BlinkViewer
        key={candidate.candidate_id}
        fieldName={state.data.name}
        wcs={state.data.wcs}
        epochs={ctx.epochs}
        blinkPairs={ctx.pairs}
        movers={ctx.movers}
        onlyCandidateId={candidate.candidate_id}
        showMoversInitially
        predicted={ctx.predicted}
        focus={ctx.focus}
        compact
      />
      <p className={styles.note} style={{ marginTop: "var(--space-2)" }}>
        Zoomed in on {state.data.name}. Circles mark the measured positions
        {ctx.predicted.length ? "; dashed white circles mark where JPL predicted the known object would be" : ""}.{" "}
        <Link href={fieldHref(state.data.field_id)}>Open the whole patch →</Link>
      </p>
    </div>
  );
}
