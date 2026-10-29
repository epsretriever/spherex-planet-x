import styles from "./SpectralStrip.module.css";

/**
 * Diagram of SPHEREx's 102 spectral channels: six detectors of 17 channels
 * each, spanning 0.75 to 5.0 µm. Channel edges are approximate and spaced
 * evenly in log-wavelength within each detector; it's a picture of the
 * instrument, not data.
 */
const DETECTORS: [number, number][] = [
  [0.75, 1.09],
  [1.1, 1.62],
  [1.63, 2.41],
  [2.42, 3.82],
  [3.83, 4.41],
  [4.42, 5.0],
];
const PER_DETECTOR = 17;
const STOPS = ["#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d"];

function rampColor(t: number) {
  const x = Math.min(0.9999, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = STOPS[i]!;
  const b = STOPS[i + 1]!;
  const ch = (hex: string, k: number) => parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16);
  const mix = (k: number) => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * f);
  return `rgb(${mix(0)} ${mix(1)} ${mix(2)})`;
}

const LMIN = Math.log(0.75);
const LMAX = Math.log(5.0);

export const CHANNELS = DETECTORS.flatMap(([lo, hi], d) =>
  Array.from({ length: PER_DETECTOR }, (_, k) => {
    const center = Math.exp(Math.log(lo) + ((k + 0.5) / PER_DETECTOR) * (Math.log(hi) - Math.log(lo)));
    return { detector: d + 1, center, color: rampColor((Math.log(center) - LMIN) / (LMAX - LMIN)) };
  }),
);

export function SpectralStrip() {
  return (
    <figure className={styles.figure}>
      <div className={styles.strip} role="img" aria-label="Diagram: SPHEREx splits infrared light from 0.75 to 5 microns into 102 channels across six detectors.">
        {DETECTORS.map((_, d) => (
          <div key={d} className={styles.detector}>
            {CHANNELS.filter((c) => c.detector === d + 1).map((c, k) => (
              <span
                key={k}
                className={styles.channel}
                style={{ background: c.color, animationDelay: `${(d * PER_DETECTOR + k) * 18}ms` }}
              />
            ))}
            <span className={`mono ${styles.det}`}>D{d + 1}</span>
          </div>
        ))}
      </div>
      <figcaption className={styles.caption}>
        <span className="mono">0.75 µm</span>
        <span>102 infrared channels · 6 detectors</span>
        <span className="mono">5.0 µm</span>
      </figcaption>
    </figure>
  );
}
