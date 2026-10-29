"use client";

import { getFields } from "@/lib/api";
import { useData } from "@/lib/useData";
import { EmptyState, ErrorState } from "./DataState";
import { FieldCard } from "./FieldCard";
import styles from "./FieldGrid.module.css";

/** The field picker: one card per patch of sky. */
export function FieldGrid({ limit }: { limit?: number }) {
  const state = useData("fields", (signal) => getFields(signal));

  if (state.status === "loading") {
    return (
      <ul className={styles.grid} aria-busy="true" aria-label="Loading patches of sky">
        {Array.from({ length: limit ?? 3 }, (_, i) => (
          <li key={i} className={`skeleton ${styles.skeleton}`} />
        ))}
      </ul>
    );
  }
  if (state.status === "error") {
    return <ErrorState reason={state.error.reason} message={state.error.message} onRetry={state.retry} />;
  }
  const fields = limit ? state.data.fields.slice(0, limit) : state.data.fields;
  if (!fields.length) {
    return (
      <EmptyState title="No patches of sky yet">
        <p>Our pipeline hasn&apos;t published any fields yet. Check back soon.</p>
      </EmptyState>
    );
  }
  return (
    <ul className={`${styles.grid} fade-in`}>
      {fields.map((f) => (
        <FieldCard key={f.field_id} field={f} />
      ))}
    </ul>
  );
}
