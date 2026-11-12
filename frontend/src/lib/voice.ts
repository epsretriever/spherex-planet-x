"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DataError, transcribeAudio } from "./api";

/** Longest question we record, in milliseconds. */
export const MAX_RECORDING_MS = 20_000;

/** Recording formats, best first; the first the browser supports is used. */
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4", "audio/mpeg"];

export function recordingType(isSupported: (t: string) => boolean): string | null {
  return TYPES.find((t) => isSupported(t)) ?? null;
}

export type VoiceState = "idle" | "recording" | "transcribing" | "error";

/**
 * Speak a question instead of typing it: records from the microphone (up to 20 s, or until
 * stop() is called), sends it to /api/transcribe (Whisper on Workers AI) and hands the text to
 * `onText`. `supported` is false until mounted, and stays false where MediaRecorder is missing.
 */
export function useVoiceInput(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      typeof window.MediaRecorder !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      recordingType((t) => MediaRecorder.isTypeSupported(t)) !== null;
    const id = setTimeout(() => setSupported(ok), 0);
    return () => {
      clearTimeout(id);
      clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
    };
  }, []);

  const stop = useCallback(() => {
    clearTimeout(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (state === "recording" || state === "transcribing") return;
    setMessage(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("error");
      setMessage("Microphone access was blocked. Allow it in your browser, or type your question.");
      return;
    }
    const mimeType = recordingType((t) => MediaRecorder.isTypeSupported(t)) ?? undefined;
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" });
      if (blob.size < 1000) {
        setState("error");
        setMessage("That was too short to hear. Hold the button a little longer.");
        return;
      }
      setState("transcribing");
      try {
        const t = await transcribeAudio(blob);
        setState("idle");
        onTextRef.current(t.text);
      } catch (err) {
        setState("error");
        setMessage(
          err instanceof DataError && err.detail ? err.detail : "Voice questions aren't available right now. Please type your question.",
        );
      }
    };
    recorder.current = rec;
    rec.start();
    setState("recording");
    timer.current = setTimeout(stop, MAX_RECORDING_MS);
  }, [state, stop]);

  return { supported, state, message, start, stop };
}
