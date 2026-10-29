"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container" role="alert">
      <h1>Something went wrong</h1>
      <p className="muted">This page hit an unexpected error. Trying again usually helps.</p>
      <button type="button" className="button button-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
