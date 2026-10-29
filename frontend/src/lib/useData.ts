"use client";

import { useCallback, useEffect, useState } from "react";
import { DataError, type DataErrorReason } from "./api";

export type DataState<T> =
  | { status: "loading"; data: null; error: null; retry: () => void }
  | { status: "ok"; data: T; error: null; retry: () => void }
  | { status: "error"; data: null; error: { reason: DataErrorReason; message: string }; retry: () => void };

/**
 * Runs a fetcher on the client and tracks loading / error state. Pass
 * `null` as the key to wait (for example until a query param is known).
 */
export function useData<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>): DataState<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string | null; attempt: number; data: T | null; error: DataState<T>["error"] }>(
    { key: null, attempt: -1, data: null, error: null },
  );
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    if (key === null) return;
    const ctrl = new AbortController();
    fetcher(ctrl.signal).then(
      (data) => setState({ key, attempt, data, error: null }),
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        const error =
          err instanceof DataError
            ? { reason: err.reason, message: err.message }
            : { reason: "unavailable" as const, message: err instanceof Error ? err.message : String(err) };
        if (!(err instanceof DataError)) console.error(err);
        setState({ key, attempt, data: null, error });
      },
    );
    return () => ctrl.abort();
    // The fetcher is identified by `key`; callers pass inline closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  if (key === null || state.key !== key || state.attempt !== attempt) {
    return { status: "loading", data: null, error: null, retry };
  }
  if (state.error) return { status: "error", data: null, error: state.error, retry };
  return { status: "ok", data: state.data as T, error: null, retry };
}
