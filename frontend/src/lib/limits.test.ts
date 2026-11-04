import { describe, expect, it } from "vitest";
import type { InjectionStudy } from "./contract";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  blindSpeeds,
  falseAlarms,
  hopelessMags,
  limitsSentence,
  planetVerdict,
  poissonInterval,
  poolRecovery,
  sigFig,
  summarizeLimits,
  type LimitsStudy,
} from "./limits";

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


const real = JSON.parse(readFileSync(join(__dirname, "__fixtures__/injection-study.json"), "utf8")) as LimitsStudy;

describe("headline numbers", () => {
  it("pools bright, asteroid-speed cells and ignores distance (parallax) cells", () => {
    const core = poolRecovery(real, 17, 10, 30)!;
    expect(core.rates).toEqual([10, 30]);
    expect(core.n_injected).toBe(1200);
    expect(core.fraction).toBeGreaterThan(0.9);
    expect(core.cell_min).toBeGreaterThanOrEqual(0.89);
    expect(core.cell_max).toBeLessThanOrEqual(0.97);
    expect(core.ci_low).toBeLessThan(core.fraction);
    expect(core.ci_high).toBeGreaterThan(core.fraction);
    expect(poolRecovery(real, 17, 3, 30)!.rates).toEqual([3, 10, 30]);
  });

  it("names the intentionally hopeless parts of the grid", () => {
    expect(hopelessMags(real)).toEqual([18, 18.5, 19, 19.5, 20]);
    const b = blindSpeeds(real);
    expect(b.slowNeverHalf).toEqual([0.3, 1]);
    expect(b.fastNeverHalf).toEqual([100]);
  });
});

describe("false alarms", () => {
  it("gives the exact Poisson 95% interval for a count", () => {
    const [lo2, hi2] = poissonInterval(2);
    expect(lo2).toBeCloseTo(0.2422, 3);
    expect(hi2).toBeCloseTo(7.2247, 3);
    const [lo0, hi0] = poissonInterval(0);
    expect(lo0).toBe(0);
    expect(hi0).toBeCloseTo(3.6889, 3);
  });

  it("does not round a small per-deg² interval to zero", () => {
    const fa = falseAlarms(real);
    expect(fa.count).toBe(2);
    expect(sigFig(fa.per_deg2_ci[0], 2)).toBe("0.0014");
    expect(sigFig(fa.per_deg2_ci[1], 2)).toBe("0.041");
    expect(sigFig(175.5, 4)).toBe("175.5");
    expect(sigFig(0, 2)).toBe("0");
  });
});

describe("planet verdicts", () => {
  it("never leaves an n/a row as 'could be missed': too-slow rows say so", () => {
    const v = real.planet_context!.rows.map((r) => [r.distance_au, planetVerdict(real, r)]);
    expect(v).toEqual([
      [30, "too_slow"],
      [100, "too_slow"],
      [300, "too_slow"],
      [500, "too_slow"],
      [700, "too_slow"],
      [1000, "too_slow"],
    ]);
  });

  it("compares brightness with m50 when m50 exists", () => {
    const s = { ...real, m50_by_distance: [] } as LimitsStudy;
    const row = { distance_au: 5, predicted_mag_ab: 17, m50_ab: 17.5, verdict: "missed" as const };
    expect(planetVerdict(s, row)).toBe("detected");
    expect(planetVerdict(s, { ...row, predicted_mag_ab: 18 })).toBe("too_faint");
    expect(planetVerdict(s, { ...row, m50_ab: null })).toBe("not_tested");
  });
});
