import type { NeoLikelihood } from "@/lib/contract";
import { Panel } from "./Panel";
import styles from "./report.module.css";

const PARTS: { key: "neo" | "main_belt" | "outer"; label: string; plain: string; color: string }[] = [
  { key: "neo", label: "Near-Earth", plain: "comes close to Earth's orbit", color: "var(--danger)" },
  { key: "main_belt", label: "Main belt", plain: "between Mars and Jupiter", color: "var(--cool)" },
  { key: "outer", label: "Outer solar system", plain: "beyond Jupiter", color: "var(--status-pair)" },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Digest2-style odds for what kind of orbit the motion and parallax point to. */
export function NeoPanel({ neo }: { neo: NeoLikelihood }) {
  const vals = PARTS.map((p) => Math.max(0, Number.isFinite(neo[p.key]) ? neo[p.key] : 0));
  const sum = vals.reduce((a, b) => a + b, 0) || 1;
  const shares = vals.map((v) => v / sum);
  return (
    <Panel
      id="neo"
      title="Could it come near Earth?"
      kicker="Orbit odds"
      intro="From how fast and in which direction it moves, and its parallax, the odds of each kind of orbit. It isn't an orbit fit: short tracks leave a lot open."
    >
      <div className={styles.neoBar} role="img" aria-label={PARTS.map((p, i) => `${p.label} ${pct(shares[i]!)}`).join(", ")}>
        {PARTS.map((p, i) => (
          <span key={p.key} style={{ width: `${shares[i]! * 100}%`, background: p.color }} />
        ))}
      </div>
      <ul className={styles.neoLegend}>
        {PARTS.map((p, i) => (
          <li key={p.key}>
            <span className={styles.neoSwatch} style={{ background: p.color }} aria-hidden="true" />
            <strong className="mono">{pct(shares[i]!)}</strong> {p.label} <span className="muted">({p.plain})</span>
          </li>
        ))}
      </ul>
      <p className={styles.note}>
        Method <span className="mono">{neo.method}</span>
        {neo.validated_on
          ? `. On ${neo.validated_on.n} objects JPL has identified, the most likely class was right ${pct(neo.validated_on.accuracy)} of the time.`
          : ". Not yet checked against JPL-identified objects."}
      </p>
    </Panel>
  );
}
