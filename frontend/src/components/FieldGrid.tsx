"use client";

import { useState } from "react";
import { getFields } from "@/lib/api";
import { useData } from "@/lib/useData";
import { EmptyState, ErrorState } from "./DataState";
import { FieldCard } from "./FieldCard";
import styles from "./FieldGrid.module.css";

/** Cards shown at first, and added per "Show more", when there is no fixed limit. */
export const FIELD_PAGE = 24;

/** The field picker: one card per patch of sky. */
export function FieldGrid({ limit }: { limit?: number }) {
  const state = useData("fields", (signal) => getFields(signal));
  // The survey has searched about a thousand patches; rendering every card at once made the
  // page hundreds of thousands of pixels tall on a phone. Show them a page at a time.
  const [shown, setShown] = useState(FIELD_PAGE);

  if (state.status === "loading") {
    return (
      <ul className={styles.grid} aria-busy="true" aria-label="Loading patches of sky">
        {Array.from({ length: limit ?? 3 }, (_, i) => (
          <li key={i} className={`skeleton ${styles.skeleton}`} />
        ))}
      </ul>
    );
  }
  // A missing list means nothing has been published yet, not a broken link.
  if (state.status === "error" && state.error.reason !== "not_found") {
    return <ErrorState reason={state.error.reason} message={state.error.message} onRetry={state.retry} />;
  }
  const all = state.status === "ok" ? state.data.fields : [];
  const fields = all.slice(0, limit ?? shown);
  if (!fields.length) {
    return (
      <EmptyState title="No patches of sky yet">
        <p>Our pipeline hasn&apos;t published any fields yet. Check back soon.</p>
      </EmptyState>
    );
  }
  const more = limit ? 0 : Math.min(FIELD_PAGE, all.length - fields.length);
  return (
    <>
      <ul className={`${styles.grid} fade-in`}>
        {fields.map((f) => (
          <FieldCard key={f.field_id} field={f} />
        ))}
      </ul>
      {more > 0 && (
        <>
          <p className={styles.count}>
            Showing <span className="mono">{fields.length.toLocaleString("en-US")}</span> of{" "}
            <span className="mono">{all.length.toLocaleString("en-US")}</span> patches of sky.
          </p>
          <button type="button" className="button" style={{ width: "100%" }} onClick={() => setShown((n) => n + FIELD_PAGE)}>
            Show {more} more
          </button>
        </>
      )}
    </>
  );
}
