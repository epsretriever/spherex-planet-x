"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import styles from "./Figure3D.module.css";

/**
 * A 3D figure that costs nothing until it is needed: three.js and the scene are imported only
 * when this mounts (put it inside WhenVisible), a skeleton holds the space meanwhile, and the
 * flat view is shown instead when WebGL can't start, the import fails, or the reader asks.
 */
export function Figure3D<P extends object>({
  load,
  props,
  flat,
  label,
  hint = "3D view: drag to turn, pinch or scroll to zoom.",
  tall = false,
}: {
  load: () => Promise<{ default: ComponentType<P & { onFail: () => void }> }>;
  props: P;
  /** The same information without WebGL. */
  flat: ReactNode;
  /** What the figure shows, for the loading state. */
  label: string;
  hint?: string;
  tall?: boolean;
}) {
  const [Scene, setScene] = useState<ComponentType<P & { onFail: () => void }> | null>(null);
  const [useFlat, setUseFlat] = useState(false);
  useEffect(() => {
    let live = true;
    load().then(
      (m) => live && setScene(() => m.default),
      () => live && setUseFlat(true),
    );
    return () => {
      live = false;
    };
    // The loader is a static import() for one figure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (useFlat) {
    return (
      <figure className={styles.figure}>
        {flat}
        {Scene && (
          <figcaption className={styles.caption}>
            Flat view.{" "}
            <button type="button" className={styles.linkButton} onClick={() => setUseFlat(false)}>
              Show the 3D view
            </button>
          </figcaption>
        )}
      </figure>
    );
  }
  if (!Scene) return <div className={`skeleton ${styles.scene} ${tall ? styles.tall : ""}`} role="status" aria-label={`Loading ${label}`} />;
  return (
    <figure className={styles.figure}>
      <Scene {...props} onFail={() => setUseFlat(true)} />
      <figcaption className={styles.caption}>
        {hint}{" "}
        <button type="button" className={styles.linkButton} onClick={() => setUseFlat(true)}>
          Show a flat view instead
        </button>
      </figcaption>
    </figure>
  );
}
