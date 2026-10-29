/** Small helpers for hand-drawn SVG charts. */

export function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

/** Evenly spaced round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const step = niceStep(max - min, count);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

export function extent(values: number[], pad = 0.08): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [0, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

export function scale(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  return (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
}

/** Color along the inferno-like ramp for t in [0, 1]. */
const STOPS = ["#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d"];
export function rampColor(t: number): string {
  const x = Math.min(0.9999, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = STOPS[i]!;
  const b = STOPS[i + 1]!;
  const ch = (hex: string, k: number) => parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16);
  const mix = (k: number) => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * f);
  return `rgb(${mix(0)} ${mix(1)} ${mix(2)})`;
}

/** Position of a wavelength on SPHEREx's 0.75–5 µm range, in log space. */
export function wavelengthT(um: number): number {
  return (Math.log(um) - Math.log(0.75)) / (Math.log(5) - Math.log(0.75));
}
