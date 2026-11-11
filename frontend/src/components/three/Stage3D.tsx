"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createStage, type Stage, type StageOptions } from "./stage";
import styles from "./Figure3D.module.css";

/**
 * Hosts one three.js scene. `build` fills the stage and may return a cleanup; it runs again when
 * `deps` change. `onFail` is called when WebGL can't start, so the caller shows its flat view.
 */
export function Stage3D({
  options,
  build,
  deps,
  onFail,
  children,
  tall = false,
}: {
  options: Omit<StageOptions, "tagClass">;
  build: (stage: Stage, host: HTMLDivElement) => void | (() => void);
  deps: unknown[];
  onFail: () => void;
  /** Overlays (a readout, extra buttons) drawn above the canvas. */
  children?: ReactNode;
  tall?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const failed = useRef(onFail);
  const builder = useRef(build);
  const opts = useRef(options);
  useEffect(() => {
    failed.current = onFail;
    builder.current = build;
    opts.current = options;
  });

  useEffect(() => {
    const el = host.current;
    const layer = labels.current;
    if (!el || !layer) return;
    const stage = createStage(el, layer, { ...opts.current, tagClass: styles.tag ?? "" });
    if (!stage) {
      failed.current();
      return;
    }
    stageRef.current = stage;
    const cleanup = builder.current(stage, el);
    return () => {
      cleanup?.();
      stageRef.current = null;
      stage.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return (
    <div ref={host} className={`${styles.scene} ${tall ? styles.tall : ""}`}>
      <div ref={labels} className={styles.tags} aria-hidden="true" />
      {children}
      <button type="button" className={styles.reset} onClick={() => stageRef.current?.reset()}>
        Reset view
      </button>
    </div>
  );
}
