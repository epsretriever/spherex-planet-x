import { describe, expect, it } from "vitest";
import type { InjectionStudy } from "./contract";
import { limitsSentence, summarizeLimits } from "./limits";

const study = (m50: { rate_arcsec_per_hr: number; m50_ab: number | null }[]) => ({ m50_by_rate: m50 }) as unknown as InjectionStudy;

describe("limits summary", () => {
  it("finds the deepest and shallowest m50 and the speeds that never reached 50%", () => {
    const s = summarizeLimits(
      study([
        { rate_arcsec_per_hr: 30, m50_ab: 18.9 },
        { rate_arcsec_per_hr: 1, m50_ab: null },
        { rate_arcsec_per_hr: 3, m50_ab: 18.7 },
      ]),
    );
    expect(s.deepest).toEqual({ rate_arcsec_per_hr: 30, m50_ab: 18.9 });
    expect(s.shallowest).toEqual({ rate_arcsec_per_hr: 3, m50_ab: 18.7 });
    expect(s.reachedRates).toEqual([3, 30]);
    expect(s.missedRates).toEqual([1]);
  });

  it("writes a sentence from the numbers only", () => {
    expect(
      limitsSentence(
        study([
          { rate_arcsec_per_hr: 1, m50_ab: null },
          { rate_arcsec_per_hr: 3, m50_ab: 18.7 },
          { rate_arcsec_per_hr: 30, m50_ab: 18.9 },
        ]),
      ),
    ).toBe(
      "For objects moving between 3″ and 30″ per hour, our pipeline finds at least half of them down to magnitude 18.7–18.9. Anything fainter is more likely to be missed. At 1″ per hour it never found half of them at any brightness we tried.",
    );
    expect(limitsSentence(study([{ rate_arcsec_per_hr: 10, m50_ab: 19 }]))).toBe(
      "For objects moving 10″ per hour, our pipeline finds at least half of them down to magnitude 19.0. Anything fainter is more likely to be missed.",
    );
    expect(limitsSentence(study([{ rate_arcsec_per_hr: 10, m50_ab: null }]))).toMatch(/never found half/);
  });
});
