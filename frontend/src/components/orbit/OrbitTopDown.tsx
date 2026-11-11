import { orbitPoints, planetElements, positionAt, type Elements, type Planet, type Vec3 } from "@/lib/orbit";
import styles from "./Orbit.module.css";

const S = 400;

/** The orbit seen from above the ecliptic (north up): used when WebGL isn't available. */
export function OrbitTopDown({
  object,
  clones,
  planets,
  epochMjd,
  objectLabel,
  others = [],
}: {
  object: Elements;
  clones: Elements[];
  planets: Planet[];
  epochMjd: number;
  objectLabel: string;
  others?: { elements: Elements; label: string }[];
}) {
  const reach = Math.max(object.a_au * (1 + object.e), ...others.map((o) => o.elements.a_au * (1 + o.elements.e)), ...planets.map((p) => p.a * (1 + p.e)), 1.5) * 1.08;
  const k = S / 2 / reach;
  const xy = ([x, y]: Vec3) => [S / 2 + x * k, S / 2 - y * k] as const;
  const path = (pts: Vec3[]) => pts.map((p, i) => `${i ? "L" : "M"}${xy(p)[0].toFixed(1)} ${xy(p)[1].toFixed(1)}`).join("") + "Z";
  const obj = xy(positionAt(object));
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className={styles.topDown} role="img" aria-label={`Top-down view of the ${others.length ? `orbits of ${[objectLabel, ...others.map((o) => o.label)].join(" and ")}` : `orbit of ${objectLabel}`} among the planets`}>
      <circle cx={S / 2} cy={S / 2} r={5} className={styles.sun} />
      {planets.map((p) => {
        const el = planetElements(p, epochMjd);
        const [x, y] = xy(positionAt(el));
        return (
          <g key={p.name}>
            <path d={path(orbitPoints(el, 120))} className={styles.planetOrbit} />
            <circle cx={x} cy={y} r={3.5} className={styles.planet} />
            <text x={x + 6} y={y - 6} className={styles.svgTag}>
              {p.name}
            </text>
          </g>
        );
      })}
      {clones.map((c, i) => (
        <path key={i} d={path(orbitPoints(c, 90))} className={styles.cloneOrbit} />
      ))}
      {clones.map((c, i) => {
        const [x, y] = xy(positionAt(c));
        return <circle key={`p${i}`} cx={x} cy={y} r={1.6} className={styles.clone} />;
      })}
      {others.map((o) => {
        const [x, y] = xy(positionAt(o.elements));
        return (
          <g key={o.label}>
            <path d={path(orbitPoints(o.elements, 200))} className={styles.secondOrbit} />
            <circle cx={x} cy={y} r={5} className={styles.second} />
            <text x={x > S * 0.6 ? x - 8 : x + 8} y={y + 16} textAnchor={x > S * 0.6 ? "end" : "start"} className={styles.svgTag} data-kind="second">
              {o.label}
            </text>
          </g>
        );
      })}
      <path d={path(orbitPoints(object, 200))} className={styles.objectOrbit} />
      <circle cx={obj[0]} cy={obj[1]} r={5} className={styles.object} />
      <text
        x={obj[0] > S * 0.6 ? obj[0] - 8 : obj[0] + 8}
        y={obj[1] - 10}
        textAnchor={obj[0] > S * 0.6 ? "end" : "start"}
        className={styles.svgTag}
        data-kind="object"
      >
        {objectLabel}
      </text>
    </svg>
  );
}
