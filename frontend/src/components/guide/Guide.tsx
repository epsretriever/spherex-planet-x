"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import styles from "./Guide.module.css";

// The chat panel and its code load only when someone opens it, so the button costs nothing on load.
const GuidePanel = dynamic(() => import("./GuidePanel"), { ssr: false });

/** "Ask Driftnet": a button on every page that opens the site-wide AI guide. */
export function Guide() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!open && (
        <button
          type="button"
          className={styles.launcher}
          aria-haspopup="dialog"
          onPointerEnter={() => setLoaded(true)}
          onFocus={() => setLoaded(true)}
          onClick={() => {
            setLoaded(true);
            setOpen(true);
          }}
        >
          <span aria-hidden="true">✦</span> Ask Driftnet
        </button>
      )}
      {loaded && <GuidePanel open={open} onClose={() => setOpen(false)} />}
    </>
  );
}
