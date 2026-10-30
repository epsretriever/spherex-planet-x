"use client";

import { startTransition, useEffect, useState } from "react";

/**
 * Mounts heavy content in a React transition after the first paint. Transition renders are
 * time-sliced, so a big report or viewer no longer blocks the main thread in one long task;
 * the page header shows immediately and the rest streams in a moment later.
 */
export function Deferred({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    startTransition(() => setReady(true));
  }, []);
  return <>{ready ? children : fallback}</>;
}
