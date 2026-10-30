"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders children once their placeholder comes within `margin` of the viewport. Used for the
 * heavy parts of long pages (sky images, charts) so the first screen renders quickly. Without
 * IntersectionObserver it renders immediately.
 */
export function WhenVisible({
  children,
  minHeight,
  margin = "200px",
}: {
  children: React.ReactNode;
  /** Reserve roughly the final height so the page doesn't jump. */
  minHeight: number;
  margin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: margin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [margin]);

  if (visible) return <>{children}</>;
  return <div ref={ref} style={{ minHeight }} aria-hidden="true" />;
}

/** Calls `onSeen` once when this point comes within `margin` of the viewport. Renders nothing visible. */
export function Seen({ onSeen, margin = "400px" }: { onSeen: () => void; margin?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(onSeen);
  useEffect(() => {
    seen.current = onSeen;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      seen.current();
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          obs.disconnect();
          seen.current();
        }
      },
      { rootMargin: margin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [margin]);

  return <div ref={ref} aria-hidden="true" />;
}
