import { describe, expect, it } from "vitest";
import { MJD_J2000, PLANETS, cholesky, isDrawable, norm, orbitPoints, planetElements, positionAt, sampleClones, sigmas, solveKepler, type Elements } from "./orbit";

const EL: Elements = { a_au: 2.5, e: 0.2, i_deg: 10, node_deg: 80, peri_deg: 30, mean_anomaly_deg: 45 };

describe("solveKepler", () => {
  it("satisfies Kepler's equation across eccentricities", () => {
    for (const e of [0, 0.1, 0.5, 0.9, 0.99]) {
      for (const M of [0.1, 1, 2.5, 3.1, -2]) {
        const E = solveKepler(M, e);
        const m = Math.atan2(Math.sin(M), Math.cos(M));
        expect(E - e * Math.sin(E)).toBeCloseTo(m, 10);
      }
    }
  });
});

describe("positions", () => {
  it("puts perihelion at q = a(1 − e) and aphelion at Q = a(1 + e)", () => {
    expect(norm(positionAt(EL, 0))).toBeCloseTo(2.0, 10);
    expect(norm(positionAt(EL, 180))).toBeCloseTo(3.0, 10);
  });

  it("keeps a circular orbit at constant radius, in its plane", () => {
    const pts = orbitPoints({ ...EL, e: 0, i_deg: 0 }, 36);
    for (const p of pts) {
      expect(norm(p)).toBeCloseTo(2.5, 10);
      expect(p[2]).toBeCloseTo(0, 10);
    }
    expect(pts[0]![0]).toBeCloseTo(pts[36]![0], 10);
  });

  it("rises above the ecliptic by up to a·sin(i) for a circular inclined orbit", () => {
    const zs = orbitPoints({ ...EL, e: 0 }, 360).map((p) => p[2]);
    expect(Math.max(...zs)).toBeCloseTo(2.5 * Math.sin((10 * Math.PI) / 180), 4);
  });

  it("places Earth where it was at J2000 (about −0.18, 0.97, 0 AU)", () => {
    const earth = PLANETS.find((p) => p.name === "Earth")!;
    const [x, y, z] = positionAt(planetElements(earth, MJD_J2000));
    expect(x).toBeCloseTo(-0.177, 2);
    expect(y).toBeCloseTo(0.967, 2);
    expect(Math.abs(z)).toBeLessThan(1e-4);
  });

  it("rejects open or broken orbits", () => {
    expect(isDrawable(EL)).toBe(true);
    expect(isDrawable({ ...EL, e: 1.2 })).toBe(false);
    expect(isDrawable({ ...EL, a_au: -1 })).toBe(false);
    expect(isDrawable({ ...EL, i_deg: Number.NaN })).toBe(false);
  });
});

describe("uncertainty", () => {
  const cov = [
    [0.04, 0.001, 0, 0, 0, 0],
    [0.001, 0.0004, 0, 0, 0, 0],
    [0, 0, 0.25, 0, 0, 0],
    [0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 0, 4],
  ];

  it("factors the covariance", () => {
    const L = cholesky(cov)!;
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        const v = L[i]!.reduce((s, x, k) => s + x * L[j]![k]!, 0);
        expect(v).toBeCloseTo(cov[i]![j]!, 8);
      }
    }
    expect(cholesky([[1, 2], [2, 1]])).toBeNull();
  });

  it("samples clones that scatter by the covariance, reproducibly", () => {
    const clones = sampleClones(EL, cov, 2000, 7);
    expect(clones.length).toBe(2000);
    const mean = clones.reduce((s, c) => s + c.a_au, 0) / clones.length;
    const sd = Math.sqrt(clones.reduce((s, c) => s + (c.a_au - mean) ** 2, 0) / clones.length);
    expect(mean).toBeCloseTo(2.5, 1);
    expect(sd).toBeCloseTo(0.2, 1);
    expect(sampleClones(EL, cov, 3, 7)).toEqual(sampleClones(EL, cov, 3, 7));
  });

  it("drops clones that would not be ellipses", () => {
    const wide = cov.map((r, i) => r.map((v, j) => (i === 1 && j === 1 ? 1 : i === 1 || j === 1 ? 0 : v)));
    const clones = sampleClones(EL, wide, 500, 3);
    expect(clones.length).toBeLessThan(500);
    expect(clones.every((c) => c.e >= 0 && c.e < 1)).toBe(true);
  });

  it("reads one-sigma values", () => {
    expect(sigmas(cov)).toEqual([0.2, 0.02, 0.5, 1, 1, 2]);
    expect(sigmas(null)).toEqual([null, null, null, null, null, null]);
  });
});
