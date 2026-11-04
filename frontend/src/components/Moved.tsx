"use client";

import Link from "next/link";
import { useEffect } from "react";
import { movedTo } from "@/lib/routes";

/**
 * An old URL after the site was reorganized: forwards to the new page, keeping the query string
 * and the #section. The host also redirects these paths (vercel.json); this covers every other
 * host and in-app navigation.
 */
export function Moved({ to, label }: { to: string; label: string }) {
  useEffect(() => {
    window.location.replace((movedTo(window.location.pathname, window.location.search) ?? to) + window.location.hash);
  }, [to]);
  return (
    <div className="container">
      <p role="status" className="muted" style={{ padding: "var(--space-8) 0" }}>
        This page moved to <Link href={to}>{label}</Link>.
      </p>
    </div>
  );
}
