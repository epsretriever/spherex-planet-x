"use client";

import { useEffect, useState } from "react";

const cache = new Map<string, boolean>();

/**
 * True when any of the images has transparent pixels. Field images mark pixels outside the
 * SPHEREx detector as fully transparent (docs/api-contract.md, "Images and no-data pixels"),
 * so the viewer shows a legend for them only when they're actually there. Images are small
 * (~175 px), so reading them back through a canvas is cheap; results are cached per URL.
 */
export function useHasTransparency(urls: readonly string[]): boolean {
  const key = urls.join("\n");
  // Results that arrive asynchronously, tagged with the URL list they belong to.
  const [found, setFound] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const list = key ? key.split("\n") : [];
    for (const url of list) {
      if (cache.has(url)) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        let alpha = false;
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 3; i < data.length; i += 4) {
              if (data[i]! < 255) {
                alpha = true;
                break;
              }
            }
          }
        } catch {
          // A tainted canvas or missing 2D context: treat as opaque.
        }
        cache.set(url, alpha);
        if (alpha && !cancelled) setFound(key);
      };
      img.src = url;
    }
    return () => {
      cancelled = true;
    };
  }, [key]);

  return found === key || urls.some((u) => cache.get(u) === true);
}
