"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/useReducedMotion";
import styles from "./HeroBlink.module.css";

export interface HeroFrame {
  /** "A" or "B". */
  key: string;
  src: string;
  timeLabel: string;
  dateLabel: string;
  wavelengthLabel: string;
  sourceFile: string;
  archiveUrl: string | null;
  /** The moving object's position in this frame, in image pixels (top-left origin). */
  mover: { col: number; row: number };
}

export interface HeroBlinkProps {
  frames: [HeroFrame, HeroFrame];
  widthPx: number;
  heightPx: number;
  place: string;
  /** "13 hours". */
  interval: string;
  /** "about half the width of this patch of Aquarius". */
  shift: string;
  wavelengthMatched: boolean;
  fieldHref: string;
  objectHref: string | null;
}

const PERIOD_MS = 800;

/**
 * The home page's opening: two real SPHEREx images of one patch, blinked the way Tombaugh blinked
 * plates. It blinks on its own only while on screen and only without a reduced-motion preference;
 * otherwise the visitor flips it.
 */
export function HeroBlink({ frames, widthPx, heightPx, place, interval, shift, wavelengthMatched, fieldHref, objectHref }: HeroBlinkProps) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const ref = useRef<HTMLElement>(null);
  const playing = !reduced && !paused && visible;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.2 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => 1 - i);
    }, PERIOD_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  const now = frames[index]!;
  const then = frames[1 - index]!;
  const r = Math.max(5, widthPx * 0.045);

  return (
    <figure ref={ref} className={styles.figure} aria-labelledby="hero-blink-caption">
      <div className={styles.plate} style={{ aspectRatio: `${widthPx} / ${heightPx}` }}>
        {frames.map((f, i) => (
          // Both images stay in the page so the swap never waits on the network.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={f.key}
            src={f.src}
            width={widthPx}
            height={heightPx}
            alt={`SPHEREx infrared image ${f.key} of ${place}, ${f.dateLabel} ${f.timeLabel}, at ${f.wavelengthLabel}`}
            className={styles.image}
            data-shown={i === index}
            aria-hidden={i !== index}
            fetchPriority={i === 0 ? "high" : "low"}
            decoding="async"
          />
        ))}
        <svg className={styles.overlay} viewBox={`0 0 ${widthPx} ${heightPx}`} aria-hidden="true">
          <line
            x1={then.mover.col}
            y1={then.mover.row}
            x2={now.mover.col}
            y2={now.mover.row}
            className={styles.path}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={then.mover.col} cy={then.mover.row} r={r} className={styles.was} vectorEffect="non-scaling-stroke" />
          <circle cx={now.mover.col} cy={now.mover.row} r={r} className={styles.is} vectorEffect="non-scaling-stroke" />
        </svg>
        <p className={styles.frameTag} aria-live="off">
          <span className={styles.frameKey}>{now.key}</span>
          <span>
            {now.dateLabel}, {now.timeLabel}
          </span>
          <span className={styles.frameWave}>{now.wavelengthLabel}</span>
        </p>
      </div>

      <div className={styles.controls}>
        {reduced ? (
          <button type="button" className={`button ${styles.control}`} onClick={() => setIndex((i) => 1 - i)}>
            Show image {then.key}
          </button>
        ) : (
          <button type="button" className={`button ${styles.control}`} aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
            {paused ? "Resume blinking" : "Pause blinking"}
          </button>
        )}
        <Link href={fieldHref} className={styles.more}>
          Blink all images of this patch
        </Link>
      </div>

      <figcaption id="hero-blink-caption" className={styles.caption}>
        <p>
          The circled dot moved {shift} in {interval}. The stars didn&rsquo;t.
          {objectHref && (
            <>
              {" "}
              <Link href={objectHref}>See the evidence for it</Link>.
            </>
          )}
        </p>
        {!wavelengthMatched && (
          <p className={styles.note}>The two images were taken at different infrared wavelengths, so some stars change brightness.</p>
        )}
        <p className={styles.sources}>
          Source files:{" "}
          {frames.map((f, i) => (
            <span key={f.key}>
              {i > 0 && ", "}
              {f.archiveUrl ? (
                <a href={f.archiveUrl} title={f.sourceFile} rel="noopener">
                  image {f.key} ({f.dateLabel}, {f.timeLabel})
                </a>
              ) : (
                <span title={f.sourceFile}>
                  image {f.key} ({f.dateLabel}, {f.timeLabel})
                </span>
              )}
            </span>
          ))}
          , NASA/IPAC SPHEREx archive.
        </p>
      </figcaption>
    </figure>
  );
}
