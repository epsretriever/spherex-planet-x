"use client";

import { useEffect, useState } from "react";

export interface PreloadState {
  loaded: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  /** Every URL has finished, whether it loaded or failed. */
  done: boolean;
}

/**
 * Loads every image up front so blinking never flashes a blank frame.
 * Decoding before reporting "loaded" keeps the first swap smooth too.
 */
export function useImagePreload(urls: readonly string[]): PreloadState {
  const key = urls.join("\n");
  const [state, setState] = useState<{ key: string; loaded: Set<string>; failed: Set<string> }>(
    () => ({ key, loaded: new Set(), failed: new Set() }),
  );

  useEffect(() => {
    let cancelled = false;
    const loaded = new Set<string>();
    const failed = new Set<string>();
    const unique = Array.from(new Set(key ? key.split("\n") : []));
    const publish = () => {
      if (!cancelled) setState({ key, loaded: new Set(loaded), failed: new Set(failed) });
    };
    publish();

    for (const url of unique) {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        const finish = () => {
          loaded.add(url);
          publish();
        };
        if (typeof img.decode === "function") img.decode().then(finish, finish);
        else finish();
      };
      img.onerror = () => {
        failed.add(url);
        publish();
      };
      img.src = url;
    }

    return () => {
      cancelled = true;
    };
  }, [key]);

  // Ignore results that belong to a previous URL list.
  const current = state.key === key ? state : { loaded: new Set<string>(), failed: new Set<string>() };
  const total = new Set(urls).size;
  return {
    loaded: current.loaded,
    failed: current.failed,
    done: current.loaded.size + current.failed.size >= total,
  };
}
