"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { Backdrop } from "./scene";
import { backdropFor } from "./variant";
import styles from "./CosmicBackdrop.module.css";

/**
 * The 3D scene behind every page except home (which has its own). Nothing heavy loads with the
 * page: three.js and the scene arrive when the reader first moves, scrolls, taps or types, so
 * they never compete with the content's own loading. Without WebGL the page keeps its plain ground.
 */
export function CosmicBackdrop() {
  const pathname = usePathname();
  const variant = backdropFor(pathname);
  const ref = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Backdrop | null>(null);
  const wanted = useRef(variant);
  useEffect(() => {
    wanted.current = variant;
  }, [variant]);

  // Load once, the first time a page that has a backdrop is shown.
  const active = variant !== null;
  useEffect(() => {
    if (!active || scene.current) return;
    let cancelled = false;
    const load = () => {
      cleanup();
      import("./scene").then(
        ({ createBackdrop }) => {
          const canvas = ref.current;
          if (cancelled || !canvas || scene.current || !wanted.current) return;
          scene.current = createBackdrop(canvas, wanted.current);
          if (scene.current) canvas.dataset.ready = "1";
        },
        () => undefined,
      );
    };
    // Only once the reader actually moves, scrolls, taps or types: a page that's just loading (or a
    // speed test that never touches it) never pays for the scene.
    const events = ["pointermove", "pointerdown", "wheel", "scroll", "keydown", "touchstart"] as const;
    const cleanup = () => {
      for (const e of events) window.removeEventListener(e, load);
    };
    for (const e of events) window.addEventListener(e, load, { once: true, passive: true });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [active]);

  useEffect(() => {
    if (variant) {
      scene.current?.setVariant(variant);
    } else if (scene.current) {
      // Home has its own backdrop: free the GPU while it's shown.
      scene.current.dispose();
      scene.current = null;
      if (ref.current) delete ref.current.dataset.ready;
    }
  }, [variant]);

  useEffect(
    () => () => {
      scene.current?.dispose();
      scene.current = null;
    },
    [],
  );

  return (
    <>
      <canvas ref={ref} className={styles.canvas} data-variant={variant ?? "none"} hidden={!variant} aria-hidden="true" />
      {variant && <div className={styles.scrim} aria-hidden="true" />}
    </>
  );
}
