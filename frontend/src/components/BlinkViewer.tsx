"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { assetUrl } from "@/lib/api";
import { buildSequences, canRender, formatGap, type Sequence } from "@/lib/blink";
import type { BlinkPair, Epoch, GridWcs, Mover } from "@/lib/contract";
import { formatInterval, formatRate, formatUtcDate, formatUtcShortDate, formatUtcTime, formatWavelength } from "@/lib/format";
import { gridToImage } from "@/lib/grid";
import { CLASSIFICATIONS } from "@/lib/labels";
import { candidateHref } from "@/lib/routes";
import { useHasTransparency } from "@/lib/useHasTransparency";
import { useImagePreload } from "@/lib/useImagePreload";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { ClassificationBadge } from "./ClassificationBadge";
import { Sheet } from "./Sheet";
import { SourceDrawer, type SourceSubject } from "./SourceDrawer";
import { Term } from "./Term";
import styles from "./BlinkViewer.module.css";

export type ViewerMode = "blink" | "swipe" | "step";

/** A dashed marker, e.g. a known object's predicted position. */
export interface PredictedMarker {
  epoch_id: string;
  x_grid: number;
  y_grid: number;
}

export interface BlinkViewerProps {
  fieldName: string;
  wcs: Pick<GridWcs, "width_px" | "height_px" | "cdelt_arcsec">;
  epochs: Epoch[];
  blinkPairs: BlinkPair[];
  movers?: Mover[];
  /** Display name for a mover, e.g. its JPL designation. */
  moverName?: (m: Mover) => string;
  /** Start with the "what moved" overlay on. */
  showMoversInitially?: boolean;
  /** Only show this candidate's track (evidence report). */
  onlyCandidateId?: string;
  predicted?: PredictedMarker[];
  /** Start zoomed in on this grid position. */
  focus?: { x_grid: number; y_grid: number; zoom: number };
  /** Hide the per-date list under the viewer. */
  compact?: boolean;
}

const RATES_HZ = [0.5, 1, 2, 4] as const;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const MODES: { value: ViewerMode; label: string }[] = [
  { value: "blink", label: "Blink" },
  { value: "swipe", label: "Swipe" },
  { value: "step", label: "Step" },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const frameLetter = (i: number) => String.fromCharCode(65 + (i % 26));
/** Pan is stored as a fraction of the stage size so it survives resizes. */
const clampPan = (p: { x: number; y: number }, z: number) => {
  const max = (z - 1) / 2;
  return { x: clamp(p.x, -max, max), y: clamp(p.y, -max, max) };
};

function initialView(focus: BlinkViewerProps["focus"], w: number, h: number) {
  if (!focus) return { zoom: 1, pan: { x: 0, y: 0 } };
  const zoom = clamp(focus.zoom, ZOOM_MIN, ZOOM_MAX);
  const { col, row } = gridToImage(focus.x_grid, focus.y_grid, h);
  // Shift so the focus point sits at the stage center.
  return { zoom, pan: clampPan({ x: -zoom * (col / w - 0.5), y: -zoom * (row / h - 0.5) }, zoom) };
}

export function BlinkViewer({
  fieldName,
  wcs,
  epochs,
  blinkPairs,
  movers = [],
  moverName,
  showMoversInitially = false,
  onlyCandidateId,
  predicted = [],
  focus,
  compact = false,
}: BlinkViewerProps) {
  const W = wcs.width_px > 0 ? wcs.width_px : 1;
  const H = wcs.height_px > 0 ? wcs.height_px : 1;
  const sequences = useMemo(() => buildSequences(epochs, blinkPairs), [epochs, blinkPairs]);
  const reducedMotion = useReducedMotion();

  const [seqKey, setSeqKey] = useState(() => sequences[0]?.key ?? "");
  const sequence = sequences.find((s) => s.key === seqKey) ?? sequences[0];
  const frames = useMemo(() => sequence?.epochs ?? [], [sequence]);

  const [modeChoice, setModeChoice] = useState<ViewerMode | null>(null);
  // Reduced motion: never auto-blink; start in Swipe instead.
  const mode: ViewerMode = modeChoice ?? (reducedMotion ? "swipe" : "blink");
  const [index, setIndex] = useState(0);
  const [playChoice, setPlayChoice] = useState<boolean | null>(null);
  const [rateHz, setRateHz] = useState<number>(1);
  const [swipe, setSwipe] = useState(50);
  const [{ zoom, pan }, setView] = useState(() => initialView(focus, W, H));
  const [sourceFor, setSourceFor] = useState<SourceSubject | null>(null);

  const hasSimulated = movers.some((m) => m.classification === "injected");
  const [showMovers, setShowMovers] = useState(showMoversInitially);
  const [showSimulated, setShowSimulated] = useState(!!onlyCandidateId);
  const [activeMover, setActiveMover] = useState<Mover | null>(null);

  const visibleMovers = useMemo(
    () =>
      movers.filter((m) =>
        onlyCandidateId ? m.candidate_id === onlyCandidateId : m.classification !== "injected" || showSimulated,
      ),
    [movers, onlyCandidateId, showSimulated],
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; kind: "pan" | "swipe"; x: number; y: number; pan: { x: number; y: number } } | null>(
    null,
  );

  const urls = useMemo(() => frames.filter(canRender).map((f) => assetUrl(f.image.url)), [frames]);
  const preload = useImagePreload(urls);
  const hasNoData = useHasTransparency(urls);
  const ready = preload.done;

  const n = frames.length;
  const safeIndex = n ? clamp(index, 0, n - 1) : 0;
  const playing = mode === "blink" && ready && n > 1 && (playChoice ?? !reducedMotion);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % n), 1000 / rateHz);
    return () => window.clearInterval(id);
  }, [playing, rateHz, n]);

  // Swipe compares a frame with the one after it.
  const swipeLeft = n > 1 ? Math.min(safeIndex, n - 2) : 0;
  const visible: number[] = mode === "swipe" && n > 1 ? [swipeLeft, swipeLeft + 1] : [safeIndex];
  const visibleEpochIds = new Set(visible.map((i) => frames[i]?.epoch_id));
  const frameIds = new Set(frames.map((f) => f.epoch_id));

  const step = useCallback(
    (delta: number) => {
      if (!n) return;
      setPlayChoice(false);
      const span = mode === "swipe" ? Math.max(1, n - 1) : n;
      setIndex((i) => (((clamp(i, 0, n - 1) + delta) % span) + span) % span);
    },
    [mode, n],
  );

  const changeZoom = (factor: number) =>
    setView(({ zoom: z, pan: p }) => {
      const next = clamp(z * factor, ZOOM_MIN, ZOOM_MAX);
      return { zoom: next, pan: clampPan({ x: (p.x * next) / z, y: (p.y * next) / z }, next) };
    });
  const resetView = () => setView({ zoom: 1, pan: { x: 0, y: 0 } });

  const selectMode = (m: ViewerMode) => {
    setModeChoice(m);
    if (m !== "blink") setPlayChoice(false);
  };

  const swipeFromPointer = (clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setSwipe(clamp(((clientX - rect.left) / rect.width) * 100, 0, 100));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const kind = zoom > 1 ? "pan" : mode === "swipe" ? "swipe" : null;
    if (!kind) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: e.pointerId, kind, x: e.clientX, y: e.clientY, pan };
    if (kind === "swipe") swipeFromPointer(e.clientX);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.kind === "swipe") return swipeFromPointer(e.clientX);
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect?.width) return;
    setView((v) => ({
      zoom: v.zoom,
      pan: clampPan({ x: d.pan.x + (e.clientX - d.x) / rect.width, y: d.pan.y + (e.clientY - d.y) / rect.height }, v.zoom),
    }));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      " ": () => mode === "blink" && setPlayChoice(!playing),
      k: () => mode === "blink" && setPlayChoice(!playing),
      ArrowLeft: () => (mode === "swipe" ? setSwipe((s) => clamp(s - 5, 0, 100)) : step(-1)),
      ArrowRight: () => (mode === "swipe" ? setSwipe((s) => clamp(s + 5, 0, 100)) : step(1)),
      "+": () => changeZoom(2),
      "=": () => changeZoom(2),
      "-": () => changeZoom(0.5),
      "0": resetView,
      m: () => movers.length > 0 && setShowMovers((v) => !v),
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  if (!sequence || n === 0) {
    return (
      <div className={styles.empty} role="status">
        No observations of this patch of sky are available yet.
      </div>
    );
  }

  const transform = `translate(${pan.x * 100}%, ${pan.y * 100}%) scale(${zoom})`;
  const current = frames[safeIndex]!;
  const first = frames[0]!;
  const last = frames[n - 1]!;
  const loadedCount = urls.filter((u) => preload.loaded.has(u) || preload.failed.has(u)).length;
  // Marker radius in grid pixels; shrink a little as we zoom so markers don't swamp the view.
  const r = 5 / Math.sqrt(zoom);

  const openSource = (e: Epoch, i: number) =>
    setSourceFor({
      title: `Image ${frameLetter(i)}`,
      time_utc: e.time_utc,
      mjd: e.mjd,
      wavelength_um_center: e.wavelength_um_center,
      wavelength_um_range: e.wavelength_um_range,
      epoch_id: e.epoch_id,
      source: e.image?.source ?? e.source,
    });

  return (
    <section className={styles.viewer} aria-label={`Image comparer for ${fieldName}`}>
      <div className={styles.toolbar}>
        {sequences.length > 1 && (
          <label className={styles.compare}>
            <span className={styles.controlLabel}>Compare</span>
            <select
              value={sequence.key}
              onChange={(e) => {
                setSeqKey(e.target.value);
                setIndex(0);
              }}
            >
              {sequences.map((s) => (
                <option key={s.key} value={s.key}>
                  {optionLabel(s)}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className={styles.segmented} role="radiogroup" aria-label="Viewing mode">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              className={styles.segment}
              onClick={() => selectMode(m.value)}
              disabled={m.value !== "step" && n < 2}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {sequence.gapHours !== null && (
        <p className={styles.pairFacts}>
          <span className="mono">{formatGap(sequence.gapHours)}</span>
          {sequence.displacementArcsec !== null && (
            <>
              {" · "}the moving object shifts <span className="mono">{Math.round(sequence.displacementArcsec)}″</span> between them
            </>
          )}
        </p>
      )}

      <WavelengthNote lambdaMatched={sequence.lambdaMatched} labelPlain={sequence.labelPlain} />

      <div
        ref={stageRef}
        className={styles.stage}
        style={{ aspectRatio: `${W} / ${H}`, ["--stage-ratio" as string]: W / H }}
        data-mode={mode}
        data-zoomed={zoom > 1 || undefined}
        tabIndex={0}
        role="group"
        aria-roledescription="image comparer"
        aria-label={`${fieldName}. Arrow keys ${mode === "swipe" ? "move the divider" : "change the date"}, plus and minus zoom${movers.length ? ", M shows what moved" : ""}.`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {frames.map((epoch, i) => {
          const shown = visible.includes(i);
          const isRight = mode === "swipe" && i === visible[1];
          return (
            <div
              key={epoch.epoch_id}
              className={styles.frame}
              data-visible={shown || undefined}
              style={isRight ? { clipPath: `inset(0 0 0 ${swipe}%)` } : undefined}
              aria-hidden={!shown}
            >
              <FrameImage epoch={epoch} letter={frameLetter(i)} transform={transform} failed={preload.failed.has(assetUrl(epoch.image?.url))} />
            </div>
          );
        })}

        {(showMovers || predicted.length > 0) && (
          <svg
            className={styles.overlay}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            style={{ transform }}
            aria-hidden={!showMovers}
          >
            <defs>
              <marker id="bv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill="var(--track)" />
              </marker>
            </defs>
            {predicted
              .filter((p) => frameIds.has(p.epoch_id))
              .map((p) => {
                const { col, row } = gridToImage(p.x_grid, p.y_grid, H);
                return (
                  <circle
                    key={`pred-${p.epoch_id}`}
                    className={styles.predicted}
                    cx={col}
                    cy={row}
                    r={r * 1.4}
                    data-current={visibleEpochIds.has(p.epoch_id) || undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            {showMovers &&
              visibleMovers.map((m) => {
                const pts = m.track
                  .filter((t) => frameIds.has(t.epoch_id))
                  .sort((a, b) => a.mjd - b.mjd)
                  .map((t) => ({ ...gridToImage(t.x_grid, t.y_grid, H), epoch_id: t.epoch_id }));
                if (!pts.length) return null;
                const color = `var(${CLASSIFICATIONS[m.classification]?.cssVar ?? "--track"})`;
                return (
                  <g key={m.candidate_id} className={styles.mover} data-classification={m.classification} style={{ ["--mover" as string]: color }}>
                    {pts.length > 1 && (
                      <polyline
                        className={styles.track}
                        points={pts.map((p) => `${p.col},${p.row}`).join(" ")}
                        markerEnd="url(#bv-arrow)"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    {pts.map((p) => (
                      <circle
                        key={p.epoch_id}
                        className={styles.ring}
                        cx={p.col}
                        cy={p.row}
                        r={r}
                        data-current={visibleEpochIds.has(p.epoch_id) || undefined}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    {!onlyCandidateId && (
                      <circle
                        className={styles.hit}
                        cx={pts.find((p) => visibleEpochIds.has(p.epoch_id))?.col ?? pts[0]!.col}
                        cy={pts.find((p) => visibleEpochIds.has(p.epoch_id))?.row ?? pts[0]!.row}
                        r={Math.max(r * 2.2, 6)}
                        role="button"
                        aria-label={`${moverName ? `${moverName(m)}, ` : ""}${CLASSIFICATIONS[m.classification]?.label ?? m.classification}: ${m.label_plain}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          setPlayChoice(false);
                          setActiveMover(m);
                        }}
                      />
                    )}
                  </g>
                );
              })}
          </svg>
        )}

        {mode === "swipe" && n > 1 && (
          <div className={styles.divider} style={{ left: `${swipe}%` }} aria-hidden="true">
            <span className={styles.dividerHandle} />
          </div>
        )}

        <div className={styles.labels}>
          {visible.map((i, pos) => {
            const e = frames[i]!;
            return (
              <div key={e.epoch_id} className={styles.frameLabel} data-side={visible.length > 1 ? (pos ? "right" : "left") : undefined}>
                <span className={styles.letter}>{frameLetter(i)}</span>
                <span className="mono">{formatUtcShortDate(e.time_utc)}</span>
                <span className={`mono ${styles.wl}`}>{formatWavelength(e.wavelength_um_center)}</span>
              </div>
            );
          })}
        </div>

        {!ready && (
          <div className={styles.loading} role="status">
            <span className={styles.loadingBar} style={{ width: `${urls.length ? (loadedCount / urls.length) * 100 : 0}%` }} />
            <span>
              Loading images… {loadedCount} of {urls.length}
            </span>
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <div className={styles.group}>
          {mode === "blink" && (
            <button
              type="button"
              className={`button button-primary ${styles.play}`}
              onClick={() => setPlayChoice(!playing)}
              disabled={!ready || n < 2}
              aria-pressed={playing}
            >
              <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span> {playing ? "Pause" : "Play"}
            </button>
          )}
          {mode !== "swipe" && (
            <>
              <button type="button" className="button" onClick={() => step(-1)} aria-label="Previous date">
                ‹
              </button>
              <button type="button" className="button" onClick={() => step(1)} aria-label="Next date">
                ›
              </button>
            </>
          )}
          {mode === "swipe" && n > 1 && (
            <label className={styles.slider}>
              <span className="visually-hidden">Divider position</span>
              <input type="range" min={0} max={100} step={1} value={Math.round(swipe)} onChange={(e) => setSwipe(Number(e.target.value))} />
            </label>
          )}
          {mode === "blink" && (
            <label className={styles.rate}>
              <span className="visually-hidden">Blink speed</span>
              <select value={rateHz} onChange={(e) => setRateHz(Number(e.target.value))}>
                {RATES_HZ.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}× per second
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className={styles.group}>
          <button type="button" className="button" onClick={() => changeZoom(0.5)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">
            −
          </button>
          <span className={`mono ${styles.zoomLevel}`}>{zoom}×</span>
          <button type="button" className="button" onClick={() => changeZoom(2)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">
            +
          </button>
          {zoom > 1 && (
            <button type="button" className="button" onClick={resetView}>
              Fit
            </button>
          )}
        </div>
      </div>

      {movers.length > 0 && !onlyCandidateId && (
        <div className={styles.moverBar}>
          <button
            type="button"
            className={`button ${styles.moverToggle}`}
            aria-pressed={showMovers}
            onClick={() => setShowMovers((v) => !v)}
            data-on={showMovers || undefined}
          >
            <span className={styles.moverDot} aria-hidden="true" />
            {showMovers ? "Hide what moved" : "Show me what moved"}
          </button>
          {showMovers && (
            <span className="muted">
              {visibleMovers.length} moving {visibleMovers.length === 1 ? "object" : "objects"} circled. Tap one to learn more.
            </span>
          )}
          {showMovers && hasSimulated && (
            <label className={styles.check}>
              <input type="checkbox" checked={showSimulated} onChange={(e) => setShowSimulated(e.target.checked)} />
              Include SIMULATED test objects
            </label>
          )}
        </div>
      )}

      {hasNoData && (
        <p className={styles.legend}>
          <span className={styles.noDataSwatch} aria-hidden="true" />
          Hatched areas are outside SPHEREx&apos;s view: the detector didn&apos;t cover that part of the patch in that image.
        </p>
      )}

      <p className={styles.caption}>
        {n > 1 ? (
          <>
            {n} images of the same patch of sky, taken {formatInterval(first.mjd, last.mjd)} apart. Stars stay put; watch for dots
            that jump.
          </>
        ) : (
          <>One image of this patch of sky.</>
        )}
      </p>

      {!compact && (
        <ol className={styles.timeline} aria-label="Images in this comparison">
          {frames.map((e, i) => {
            const ok = canRender(e);
            return (
              <li key={e.epoch_id} className={styles.timelineItem} data-active={visible.includes(i) || undefined}>
                <button
                  type="button"
                  className={styles.timelineSelect}
                  onClick={() => {
                    setPlayChoice(false);
                    setIndex(mode === "swipe" ? Math.min(i, Math.max(0, n - 2)) : i);
                  }}
                  aria-current={i === safeIndex ? "true" : undefined}
                >
                  <span className={styles.letter}>{frameLetter(i)}</span>
                  <span className="mono">{formatUtcDate(e.time_utc)}</span>
                  <span className={`mono ${styles.wl}`}>{formatWavelength(e.wavelength_um_center)}</span>
                </button>
                <button
                  type="button"
                  className={styles.sourceChip}
                  onClick={() => openSource(e, i)}
                  disabled={!ok}
                  aria-label={ok ? `Source for image ${frameLetter(i)}` : `Image ${frameLetter(i)} has no source information`}
                >
                  {ok ? "Source" : "No source"}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {compact && (
        <div className={styles.compactSources}>
          {visible.map((i) => (
            <button key={frames[i]!.epoch_id} type="button" className={styles.sourceLink} onClick={() => openSource(frames[i]!, i)} disabled={!canRender(frames[i]!)}>
              Source of image {frameLetter(i)}
            </button>
          ))}
        </div>
      )}

      <p className="visually-hidden" aria-live="polite">
        {!playing && `Showing image ${frameLetter(safeIndex)}, ${formatUtcDate(current.time_utc)}, ${formatWavelength(current.wavelength_um_center)}.`}
      </p>

      <SourceDrawer subject={sourceFor} onClose={() => setSourceFor(null)} />
      <MoverSheet
        mover={activeMover}
        name={activeMover && moverName ? moverName(activeMover) : null}
        frames={frames}
        cdeltArcsec={wcs.cdelt_arcsec}
        onClose={() => setActiveMover(null)}
      />
    </section>
  );
}

function FrameImage({ epoch, letter, transform, failed }: { epoch: Epoch; letter: string; transform: string; failed: boolean }) {
  if (!canRender(epoch)) {
    return (
      <div className={styles.placeholder} role="img" aria-label={`Image ${letter} hidden: missing source`}>
        <strong>Missing source</strong>
        <span>This image stays hidden until we know which file it came from.</span>
      </div>
    );
  }
  if (failed) {
    return (
      <div className={styles.placeholder} role="img" aria-label={`Image ${letter} failed to load`}>
        <strong>Image unavailable</strong>
        <span>This image could not be loaded.</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-stretched cutouts must not be resampled
    <img
      className={styles.image}
      src={assetUrl(epoch.image.url)}
      alt={`SPHEREx infrared image ${letter}, taken ${formatUtcDate(epoch.time_utc)} at ${formatWavelength(epoch.wavelength_um_center)}`}
      style={{ transform }}
      draggable={false}
    />
  );
}

function WavelengthNote({ lambdaMatched, labelPlain }: { lambdaMatched: boolean | null; labelPlain: string | null }) {
  if (lambdaMatched === true) {
    return (
      <p className={styles.note} data-tone="ok">
        <span className={styles.noteIcon} aria-hidden="true">
          ✓
        </span>
        <span>
          <strong>Same wavelength.</strong> Both images were taken in the same infrared color, so brightness can be compared.
          {labelPlain && <span className="muted"> {labelPlain}</span>}
        </span>
      </p>
    );
  }
  const text =
    lambdaMatched === false
      ? "Different wavelengths: brightness changes are expected"
      : "These dates may be at different wavelengths, so brightness changes are expected";
  return (
    <details className={styles.note} data-tone="warn">
      <summary>
        <span className={styles.noteIcon} aria-hidden="true">
          !
        </span>
        <span>
          <strong>{text}.</strong> <span className={styles.why}>Why?</span>
        </span>
      </summary>
      <p>
        SPHEREx sees each spot on the sky through a filter whose color changes across the detector, so the same star is often
        photographed at a different infrared wavelength on each visit. Stars look brighter or fainter at different wavelengths.
        Look for dots that change <em>position</em>, not brightness.
        {labelPlain && <> {labelPlain}</>}
      </p>
    </details>
  );
}

function MoverSheet({
  mover,
  name,
  frames,
  cdeltArcsec,
  onClose,
}: {
  mover: Mover | null;
  name: string | null;
  frames: Epoch[];
  cdeltArcsec: number;
  onClose: () => void;
}) {
  const info = useMemo(() => {
    if (!mover) return null;
    const ids = new Set(frames.map((f) => f.epoch_id));
    const pts = mover.track.filter((t) => ids.has(t.epoch_id)).sort((a, b) => a.mjd - b.mjd);
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (!a || !b || a === b) return { pts };
    const px = Math.hypot(b.x_grid - a.x_grid, b.y_grid - a.y_grid);
    return { pts, px, arcsec: px * cdeltArcsec, interval: formatInterval(a.mjd, b.mjd) };
  }, [mover, frames, cdeltArcsec]);

  return (
    <Sheet open={!!mover} onClose={onClose} title={name ?? "This dot moved"}>
      {mover && info && (
        <div className={styles.sheetBody}>
          <ClassificationBadge value={mover.classification} size="lg" />
          <p className={styles.sheetLead}>{mover.label_plain}</p>
          <dl className={styles.facts}>
            {"px" in info && info.px !== undefined && (
              <div>
                <dt>Moved</dt>
                <dd>
                  about {Math.round(info.px)} {Math.round(info.px) === 1 ? "pixel" : "pixels"} (
                  <span className="mono">{Math.round(info.arcsec!)}</span> <Term term="arcsec">arcsec</Term>) in {info.interval}
                </dd>
              </div>
            )}
            {mover.rate_arcsec_per_hr !== null && (
              <div>
                <dt>Speed</dt>
                <dd>{formatRate(mover.rate_arcsec_per_hr)}</dd>
              </div>
            )}
            <div>
              <dt>Seen in</dt>
              <dd>
                {info.pts.length} of the images shown ({mover.track.length} in total)
              </dd>
            </div>
          </dl>
          <Link className="button button-primary" href={candidateHref(mover.candidate_id)}>
            See the full evidence →
          </Link>
        </div>
      )}
    </Sheet>
  );
}

/** Short picker text: "Jun 3, 08:03 → 21:11 · 13 h · same λ". The full detail shows below the picker. */
function optionLabel(s: Sequence): string {
  if (s.gapHours === null || s.epochs.length !== 2) return s.label;
  const [a, b] = s.epochs as [Epoch, Epoch];
  const sameDay = formatUtcDate(a.time_utc) === formatUtcDate(b.time_utc);
  const dates = sameDay
    ? `${formatUtcShortDate(a.time_utc)}, ${formatUtcTime(a.time_utc).replace(" UTC", "")} → ${formatUtcTime(b.time_utc).replace(" UTC", "")}`
    : `${formatUtcShortDate(a.time_utc)} → ${formatUtcShortDate(b.time_utc)}`;
  const gap = s.gapHours < 48 ? `${Math.round(s.gapHours)} h` : `${(s.gapHours / 24).toFixed(1)} d`;
  return `${dates} · ${gap}${s.lambdaMatched ? " · same λ" : ""}`;
}
