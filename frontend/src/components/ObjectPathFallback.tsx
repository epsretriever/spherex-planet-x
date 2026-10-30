"use client";

import { useEffect } from "react";
import { queryRouteFor } from "@/lib/routes";

/**
 * On the 404 page: if the URL looks like an object page that wasn't prerendered (for example
 * an object published after the last build), load it from the API through its `?id=` route.
 */
export function ObjectPathFallback() {
  useEffect(() => {
    const to = queryRouteFor(window.location.pathname);
    if (to) window.location.replace(to);
  }, []);
  return null;
}
