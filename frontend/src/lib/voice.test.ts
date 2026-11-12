import { describe, expect, it } from "vitest";
import { recordingType } from "./voice";
import { AI_VOICE_LANGUAGES, WRITEUP_LANGUAGES } from "./readAloud";

describe("voice input", () => {
  it("picks the first recording format the browser supports", () => {
    expect(recordingType((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(recordingType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(recordingType(() => false)).toBeNull();
  });

  it("offers an AI voice only for languages the write-up can be translated into", () => {
    const codes = new Set(WRITEUP_LANGUAGES.map(([c]) => c));
    for (const l of AI_VOICE_LANGUAGES) expect(codes.has(l)).toBe(true);
    expect(WRITEUP_LANGUAGES[0]![0]).toBe("en");
  });
});
