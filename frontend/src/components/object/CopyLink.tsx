"use client";

import { useEffect, useState } from "react";

/**
 * Copies a link to the clipboard (the current page unless `path` is given) and says so. Uses the
 * system share sheet where there is one (phones), the clipboard elsewhere.
 */
export function CopyLink({ path, title, label = "Copy link" }: { path?: string; title?: string; label?: string }) {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(t);
  }, [note]);

  async function share() {
    const url = path ? new URL(path, window.location.origin).toString() : window.location.href;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    try {
      if (coarse && typeof navigator.share === "function") {
        await navigator.share({ url, title: title ?? document.title });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNote("Link copied");
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // the share sheet was dismissed
      setNote("Copy the address from your browser's address bar");
    }
  }

  return (
    <>
      <button type="button" className="button" onClick={share}>
        {label}
      </button>
      <span role="status" aria-live="polite" style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
        {note}
      </span>
    </>
  );
}
