"use client";

import type { DataErrorReason } from "@/lib/api";
import styles from "./DataState.module.css";

const COPY: Record<DataErrorReason, { title: string; body: string }> = {
  not_found: {
    title: "We couldn't find that",
    body: "It may have been renamed or removed. Try picking it again from the list.",
  },
  unavailable: {
    title: "We can't reach the sky data right now",
    body: "Our data service didn't respond. This is usually temporary, so please try again in a moment.",
  },
  invalid: {
    title: "This data didn't look right",
    body: "We received data in a format we didn't expect, so we're not showing it rather than risk showing something wrong.",
  },
};

export function ErrorState({
  reason,
  message,
  onRetry,
  compact,
}: {
  reason: DataErrorReason;
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const copy = COPY[reason];
  return (
    <div className={styles.box} data-compact={compact || undefined} role="alert">
      <div className={styles.glyph} aria-hidden="true" />
      <h2>{copy.title}</h2>
      <p>{copy.body}</p>
      {message && process.env.NODE_ENV !== "production" && <p className={`mono ${styles.detail}`}>{message}</p>}
      {onRetry && reason !== "not_found" && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className={styles.box} role="status">
      <div className={styles.glyph} aria-hidden="true" />
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function LoadingBlock({ label, height = 240 }: { label: string; height?: number }) {
  return (
    <div className={`skeleton ${styles.loading}`} style={{ minHeight: height }} role="status">
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
