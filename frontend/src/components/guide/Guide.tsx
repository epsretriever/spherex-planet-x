"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import styles from "./Guide.module.css";

// The chat panel and its code load only when someone opens it, so the button costs nothing on load.
const GuidePanel = dynamic(() => import("./GuidePanel"), { ssr: false });

/** "Ask Driftnet": a button on every page that opens the site-wide AI guide. */
export function Guide() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Shown once the page has loaded and the browser is idle, so it never competes with the first paint.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idle: number | undefined;
    const show = () => {
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(() => setReady(true), { timeout: 4000 });
      else timer = setTimeout(() => setReady(true), 1500);
    };
    if (document.readyState === "complete") show();
    else window.addEventListener("load", show, { once: true });
    return () => {
      window.removeEventListener("load", show);
      clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback(idle);
    };
  }, []);
  if (!ready) return null;
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
