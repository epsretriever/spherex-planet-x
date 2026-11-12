"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getWriteupSpeech } from "./api";
import type { AiSubjectKind } from "./contract";

/** Write-up languages (same codes as the API's ?lang=), with their own names. */
export const WRITEUP_LANGUAGES: [code: string, name: string][] = [
  ["en", "English"],
  ["es", "Español"],
  ["fr", "Français"],
  ["pt", "Português"],
  ["de", "Deutsch"],
  ["hi", "हिन्दी"],
  ["zh", "中文"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["ar", "العربية"],
];

/** Languages the Workers AI voice (MeloTTS) reads; others use the browser's own voice. */
export const AI_VOICE_LANGUAGES = new Set(["en", "es", "fr", "zh", "ja", "ko"]);

export type ReadState = "idle" | "loading" | "playing";

/**
 * Reads the write-up aloud: MeloTTS clips from the API, played in order; when they aren't
 * available (no AI, language without an AI voice, an error), the browser's speech synthesis.
 */
export function useReadAloud(kind: AiSubjectKind, id: string) {
  const [state, setState] = useState<ReadState>("idle");
  const [voice, setVoice] = useState<"ai" | "browser" | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const run = useRef(0);

  const stop = useCallback(() => {
    run.current += 1;
    audio.current?.pause();
    audio.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setState("idle");
  }, []);

  useEffect(() => stop, [stop]);

  const browserSpeak = useCallback((texts: string[], lang: string, token: number) => {
    if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
      setState("idle");
      return false;
    }
    speechSynthesis.cancel();
    texts.forEach((t, i) => {
      const u = new SpeechSynthesisUtterance(t);
      u.lang = lang;
      if (i === texts.length - 1) u.onend = () => token === run.current && setState("idle");
      speechSynthesis.speak(u);
    });
    setVoice("browser");
    setState("playing");
    return true;
  }, []);

  const play = useCallback(
    async (texts: string[], lang: string) => {
      stop();
      const token = run.current;
      if (!AI_VOICE_LANGUAGES.has(lang)) {
        browserSpeak(texts, lang, token);
        return;
      }
      setState("loading");
      try {
        const speech = await getWriteupSpeech(kind, id, lang);
        if (token !== run.current) return;
        setVoice("ai");
        setState("playing");
        for (const clip of speech.clips) {
          if (token !== run.current) return;
          const a = new Audio(clip);
          audio.current = a;
          await new Promise<void>((resolve, reject) => {
            a.onended = () => resolve();
            a.onerror = () => reject(new Error("clip failed"));
            a.play().catch(reject);
          });
        }
        if (token === run.current) setState("idle");
      } catch {
        if (token !== run.current) return;
        browserSpeak(texts, lang, token);
      }
    },
    [kind, id, stop, browserSpeak],
  );

  return { state, voice, play, stop };
}
