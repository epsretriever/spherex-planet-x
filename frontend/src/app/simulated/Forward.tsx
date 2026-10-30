"use client";

import Link from "next/link";
import { useEffect } from "react";

export function Forward() {
  useEffect(() => {
    window.location.replace(`/limits/${window.location.search}`);
  }, []);
  return (
    <p role="status" className="muted">
      This page moved to <Link href="/limits/">Detection limits</Link>.
    </p>
  );
}
