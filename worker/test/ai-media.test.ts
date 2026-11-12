import { describe, expect, it } from "vitest";
import type { AiWriteup, FieldList } from "../src/contract";
import { GUIDE_PAGES, fallbackLinks, guideNumbers, validLinks } from "../src/ai/guide";
import { SPEECH_MODEL, TRANSCRIBE_MODEL, TRANSLATE_MODEL, numbersAllowed, numbersIn } from "../src/ai/media";
import { sqliteD1 } from "./d1";
import { candidate } from "./factory";
import { makeClient } from "./helpers";

const sim = candidate({ candidate_id: "test-field-sim01", classification: "injected", label_plain: "Simulated" });
const fieldList = { schema_version: "1.1", pipeline_version: "test", generated_utc: "2026-10-30T00:00:00Z", fields: [] } as unknown as FieldList;
const survey = {
  schema_version: "1.2",
  pipeline_version: "test",
  generated_utc: "2026-11-09T09:13:12Z",
  totals: { n_tiles: 14762, n_processed: 504, n_searched: 14630, n_empty: 14126, n_failed: 132, n_epochs: 255312, n_objects: 555, area_deg2_searched: 978.12, sky_fraction_searched: 0.0237103 },
  last_run: { finished_utc: "2026-11-09T09:13:08Z", n_tiles_processed: 672, n_new_objects: 17 },
};
const objects = {
  objects: [
    { classification: "unmatched", distance_class: "main_belt" },
    { classification: "unmatched", distance_class: "neo" },
    { classification: "likely_artifact", distance_class: "unknown" },
  ],
};
const files = { "/data/candidates/test-field-sim01.json": sim, "/data/fields.json": fieldList, "/data/survey.json": survey, "/data/objects.json": objects };

const goodWriteup = {
  verdict: "A simulated object planted to test the pipeline.",
  paragraphs: [
    "It was seen 3 times and moves 3 arcseconds per hour.",
    "It is not a real object, so it was not compared with JPL's catalog.",
    "The overall score is 0.73.",
  ],
  grounded_fields: ["motion.n_detections", "motion.rate_arcsec_per_hr", "scores.overall"],
};

/** Fake Workers AI: a handler per model; records every call. */
function fakeAi(handlers: Record<string, (input: Record<string, unknown>) => unknown>) {
  const calls: { model: string; input: Record<string, unknown> }[] = [];
  return {
    calls,
    async run(model: string, input: Record<string, unknown>) {
      calls.push({ model, input });
      const h = handlers[model] ?? handlers["*"];
      if (!h) throw new Error(`no fake for ${model}`);
      const out = h(input);
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

const llm = (body: unknown) => () => ({ response: JSON.stringify(body) });
/** A "translation" that keeps every number and marks the text. */
const echoTranslate = (input: Record<string, unknown>) => ({ translated_text: `[${input.target_lang}] ${input.text}` });

async function client(ai?: ReturnType<typeof fakeAi>) {
  const c = makeClient({ files });
  if (ai) c.env.AI = ai;
  c.env.DB = (await sqliteD1()).d1;
  const post = (path: string, body: BodyInit, headers: Record<string, string>) => c.get(path, { method: "POST", body, headers });
  return { ...c, post };
}

describe("numbers in translations", () => {
  it("reads decimal commas, thousands separators and other digit systems", () => {
    expect(numbersIn("se mueve 3,2 segundos")).toEqual([3.2]);
    expect(numbersIn("14 762 parcelas")).toContain(14762);
    expect(numbersIn("١٤ صورة")).toEqual([14]);
    expect(numbersIn("०.७३")).toEqual([0.73]);
  });

  it("accepts translations that keep the numbers, and rejects changed ones", () => {
    const src = numbersIn("It moves 3.2 arcseconds per hour across 14,762 patches; score 0.73.");
    expect(numbersAllowed("Se mueve 3,2 segundos por hora en 14.762 parcelas; 0,73.", src)).toBe(true);
    expect(numbersAllowed("Il se déplace de 3,2 secondes sur 14 762 zones.", src)).toBe(true);
    expect(numbersAllowed("Se mueve 32 segundos por hora.", src)).toBe(false);
    expect(numbersAllowed("Se mueve 3,2 segundos durante 9 horas.", src)).toBe(false);
  });
});

describe("GET /api/candidates/:id/writeup?lang=", () => {
  it("translates a checked write-up and caches the translation", async () => {
    const ai = fakeAi({ "@cf/meta/llama-3.3-70b-instruct-fp8-fast": llm(goodWriteup), [TRANSLATE_MODEL]: echoTranslate });
    const c = await client(ai);
    const r = await c.get("/api/candidates/test-field-sim01/writeup?lang=es");
    expect(r.status).toBe(200);
    const w = (await r.json()) as AiWriteup & { lang: string; translation: { numeric_check: string } };
    expect(w.lang).toBe("es");
    expect(w.verdict.startsWith("[es] ")).toBe(true);
    expect(w.paragraphs).toHaveLength(3);
    expect(w.translation.numeric_check).toBe("passed");
    expect(w.label_plain).toContain("Español");
    const n = ai.calls.length;
    await c.get("/api/candidates/test-field-sim01/writeup?lang=es");
    expect(ai.calls.length).toBe(n); // write-up and translation both cached
  });

  it("serves English when the translation changes a number", async () => {
    const ai = fakeAi({
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast": llm(goodWriteup),
      [TRANSLATE_MODEL]: (i) => ({ translated_text: String(i.text).replace(/\b3\b/g, "30") }),
    });
    const c = await client(ai);
    const r = await c.get("/api/candidates/test-field-sim01/writeup?lang=fr");
    const w = (await r.json()) as AiWriteup & { lang: string; translation: { numeric_check: string } };
    expect(w.lang).toBe("en");
    expect(w.translation.numeric_check).toBe("failed");
    expect(w.paragraphs[0]).toBe(goodWriteup.paragraphs[0]);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("serves English when the model reports an error", async () => {
    const ai = fakeAi({ "@cf/meta/llama-3.3-70b-instruct-fp8-fast": llm(goodWriteup), [TRANSLATE_MODEL]: () => ({ translated_text: "ERROR: invalid target_lang" }) });
    const w = (await (await (await client(ai)).get("/api/candidates/test-field-sim01/writeup?lang=de")).json()) as { lang: string };
    expect(w.lang).toBe("en");
  });

  it("rejects unknown languages and leaves English unchanged", async () => {
    const ai = fakeAi({ "@cf/meta/llama-3.3-70b-instruct-fp8-fast": llm(goodWriteup) });
    const c = await client(ai);
    expect((await c.get("/api/candidates/test-field-sim01/writeup?lang=xx")).status).toBe(400);
    const w = (await (await c.get("/api/candidates/test-field-sim01/writeup?lang=en")).json()) as Record<string, unknown>;
    expect(w.lang).toBeUndefined();
    expect(w.source).toBe("ai");
  });
});

describe("GET /api/candidates/:id/writeup/speech", () => {
  const mp3 = "SUQz".padEnd(200, "A");

  it("returns one MP3 clip per paragraph and caches them", async () => {
    const ai = fakeAi({ "@cf/meta/llama-3.3-70b-instruct-fp8-fast": llm(goodWriteup), [SPEECH_MODEL]: () => ({ audio: mp3 }) });
    const c = await client(ai);
    const r = await c.get("/api/candidates/test-field-sim01/writeup/speech");
    expect(r.status).toBe(200);
    const s = (await r.json()) as { clips: string[]; lang: string; cached: boolean };
    expect(s.clips).toHaveLength(4);
    expect(s.clips[0]).toBe(`data:audio/mpeg;base64,${mp3}`);
    expect(ai.calls.filter((x) => x.model === SPEECH_MODEL).map((x) => x.input.lang)).toEqual(["en", "en", "en", "en"]);
    const again = (await (await c.get("/api/candidates/test-field-sim01/writeup/speech")).json()) as { cached: boolean };
    expect(again.cached).toBe(true);
  });

  it("reads the checked translation aloud in its language", async () => {
    const ai = fakeAi({
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast": llm(goodWriteup),
      [TRANSLATE_MODEL]: echoTranslate,
      [SPEECH_MODEL]: () => ({ audio: mp3 }),
    });
    const c = await client(ai);
    const r = await c.get("/api/candidates/test-field-sim01/writeup/speech?lang=es");
    expect(r.status).toBe(200);
    const spoken = ai.calls.filter((x) => x.model === SPEECH_MODEL);
    expect(spoken[0]!.input).toMatchObject({ lang: "es" });
    expect(String(spoken[0]!.input.prompt).startsWith("[es] ")).toBe(true);
  });

  it("400s for languages MeloTTS can't speak and 503s when the model fails", async () => {
    const ai = fakeAi({ "@cf/meta/llama-3.3-70b-instruct-fp8-fast": llm(goodWriteup), [SPEECH_MODEL]: () => new Error("capacity") });
    const c = await client(ai);
    expect((await c.get("/api/candidates/test-field-sim01/writeup/speech?lang=hi")).status).toBe(400);
    const r = await c.get("/api/candidates/test-field-sim01/writeup/speech");
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/transcribe", () => {
  const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);

  it("returns Whisper's text for a short recording", async () => {
    const ai = fakeAi({ [TRANSCRIBE_MODEL]: () => ({ text: "  How fast is it   moving? ", transcription_info: { language: "en" } }) });
    const c = await client(ai);
    const r = await c.post("/api/transcribe", audio, { "content-type": "audio/webm;codecs=opus" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ text: "How fast is it moving?", model: TRANSCRIBE_MODEL, language: "en" });
    expect(typeof ai.calls[0]!.input.audio).toBe("string"); // base64, as the turbo model requires
  });

  it("validates the recording", async () => {
    const c = await client(fakeAi({ [TRANSCRIBE_MODEL]: () => ({ text: "" }) }));
    expect((await c.post("/api/transcribe", "hello", { "content-type": "text/plain" })).status).toBe(400);
    expect((await c.post("/api/transcribe", new Uint8Array(0), { "content-type": "audio/webm" })).status).toBe(400);
    expect((await c.post("/api/transcribe", audio, { "content-type": "audio/webm" })).status).toBe(422);
    const big = new Uint8Array(1_600_000);
    expect((await c.post("/api/transcribe", big, { "content-type": "audio/webm" })).status).toBe(413);
  });
});

describe("POST /api/guide", () => {
  const req = (question: string) => JSON.stringify({ question, session_id: "session-abc123" });
  const json = { "content-type": "application/json" };

  it("answers from the notes and live totals, with links to real pages", async () => {
    const ai = fakeAi({
      "*": llm({ answer: "Driftnet has searched 978 square degrees, about 2.37% of the sky.", links: ["/sky/", "/not-a-page/"], answered_from_data: true }),
    });
    const c = await client(ai);
    const r = await c.post("/api/guide", req("How much of the sky have you searched?"), json);
    expect(r.status).toBe(200);
    const a = (await r.json()) as { answer: string; links: { href: string }[]; source: string; numeric_check: string };
    expect(a.source).toBe("ai");
    expect(a.numeric_check).toBe("passed");
    expect(a.links.map((l) => l.href)).toEqual(["/sky/"]);
    const user = (ai.calls[0]!.input.messages as { content: string }[])[1]!.content;
    expect(user).toContain('"sky_area_searched_deg2":978.12');
    expect(user).toContain('"objects_unmatched":2');
  });

  it("refuses invented numbers and discovery claims", async () => {
    for (const out of [
      { answer: "We have found 9000 asteroids.", links: [], answered_from_data: true },
      { answer: "We may have discovered Planet X.", links: [], answered_from_data: true },
    ]) {
      const a = (await (await (await client(fakeAi({ "*": llm(out) }))).post("/api/guide", req("What did you find?"), json)).json()) as {
        source: string;
        numeric_check: string;
        links: unknown[];
      };
      expect(a).toMatchObject({ source: "fallback", numeric_check: "failed" });
      expect(a.links.length).toBeGreaterThan(0);
    }
  });

  it("points to the right pages without the AI binding", async () => {
    const a = (await (await (await client()).post("/api/guide", req("Can you see Planet X?"), json)).json()) as { links: { href: string }[]; source: string };
    expect(a.source).toBe("fallback");
    expect(a.links[0]!.href).toBe("/limits/");
  });

  it("validates the request", async () => {
    const c = await client();
    expect((await c.post("/api/guide", JSON.stringify({ question: "", session_id: "session-abc123" }), json)).status).toBe(400);
    expect((await c.post("/api/guide", JSON.stringify({ question: "hi", session_id: "x" }), json)).status).toBe(400);
  });

  it("only links to pages in the allow-list, and allows only known numbers", () => {
    expect(validLinks(["/limits/", "javascript:alert(1)", "https://evil.example/"])).toEqual([{ href: "/limits/", label: GUIDE_PAGES["/limits/"] }]);
    expect(fallbackLinks("who built this?")[0]!.href).toBe("/about/");
    const nums = guideNumbers({ a: 555 });
    expect(numbersAllowed("We track 555 objects in 102 colors.", nums)).toBe(true);
    expect(numbersAllowed("We track 556 objects.", nums)).toBe(false);
  });
});
