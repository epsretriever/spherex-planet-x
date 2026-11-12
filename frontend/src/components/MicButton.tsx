"use client";

import type { VoiceState } from "@/lib/voice";
import styles from "./MicButton.module.css";

/** Press to record a question, press again to send it. Rendered only where recording works. */
export function MicButton({
  state,
  onStart,
  onStop,
  disabled,
}: {
  state: VoiceState;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
}) {
  const recording = state === "recording";
  const busy = state === "transcribing";
  return (
    <button
      type="button"
      className={styles.mic}
      data-state={state}
      aria-pressed={recording}
      aria-label={recording ? "Stop recording and send" : busy ? "Turning your voice into text" : "Ask by voice"}
      title={recording ? "Stop and send" : "Ask by voice"}
      disabled={disabled || busy}
      onClick={recording ? onStop : onStart}
    >
      {busy ? (
        <span className={styles.dots} aria-hidden="true">
          …
        </span>
      ) : recording ? (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      )}
    </button>
  );
}
