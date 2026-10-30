"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Panel } from "@/components/report/Panel";
import reportStyles from "@/components/report/report.module.css";
import { WhenVisible } from "@/components/WhenVisible";
import type { ObjectDetail, OrbitalElements } from "@/lib/contract";
import { fmt, formatHours, formatUtcDate } from "@/lib/format";
import { ORBIT_STATUS, groupVisits } from "@/lib/objects";
import { PLANETS, isDrawable, mjdToDate, sampleClones, sigmas, type Elements } from "@/lib/orbit";
import { OrbitTopDown } from "./OrbitTopDown";
import type { SceneProps } from "./OrbitScene";
import styles from "./Orbit.module.css";

const ROWS: { key: keyof OrbitalElements; label: string; unit: string; digits: number }[] = [
  { key: "a_au", label: "Semi-major axis a", unit: "AU", digits: 3 },
  { key: "e", label: "Eccentricity e", unit: "", digits: 3 },
  { key: "i_deg", label: "Inclination i", unit: "°", digits: 2 },
  { key: "node_deg", label: "Ascending node Ω", unit: "°", digits: 2 },
  { key: "peri_deg", label: "Argument of perihelion ω", unit: "°", digits: 2 },
  { key: "mean_anomaly_deg", label: "Mean anomaly M", unit: "°", digits: 2 },
];

/** Clones from clones_url when it serves a list of elements; otherwise none. */
function useClonesFromUrl(url: string | null): Elements[] | null {
  const [clones, setClones] = useState<{ url: string; list: Elements[] } | null>(null);
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: unknown) => {
        const arr = Array.isArray(body) ? body : Array.isArray((body as { clones?: unknown })?.clones) ? (body as { clones: unknown[] }).clones : [];
        setClones({ url, list: (arr as Elements[]).filter((c) => c && isDrawable(c)) });
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [url]);
  return url && clones?.url === url ? clones.list : null;
}

/** Planets out to a bit beyond the object's farthest point; always Mercury through Jupiter. */
function planetsFor(el: Elements) {
  const Q = el.a_au * (1 + el.e);
  return PLANETS.filter((p) => p.a <= 5.3 || p.a <= Q * 1.6);
}

export function OrbitPanel({ object, label }: { object: ObjectDetail; label: string }) {
  const orbit = object.orbit;
  const drawable = !!orbit && isDrawable(orbit);
  const fromUrl = useClonesFromUrl(drawable ? (orbit!.clones_url ?? null) : null);
  const sampled = useMemo(
    () => (drawable && orbit!.covariance ? sampleClones(orbit!, orbit!.covariance, Math.min(orbit!.n_clones || 100, 200), 1) : []),
    [drawable, orbit],
  );
  const clones = fromUrl && fromUrl.length ? fromUrl : sampled;
  const cloudSource = fromUrl && fromUrl.length ? "published clones" : sampled.length ? "sampled from the orbit's uncertainty" : null;

  if (!orbit || !drawable) {
    const visits = groupVisits(object.detections);
    const nights = new Set(object.detections.map((d) => d.time_utc.slice(0, 10))).size;
    return (
      <Panel id="orbit" title="Orbit" kicker={ORBIT_STATUS[object.orbit_status]}>
        <p className={styles.noOrbit}>
          {orbit && !drawable
            ? "The orbit fit didn't give a closed orbit we can draw, so it isn't shown."
            : `No orbit yet. Working out an orbit needs sightings spread over more nights. So far this object was seen on ${visits.length} ${
                visits.length === 1 ? "visit" : "visits"
              } across ${nights} ${nights === 1 ? "day" : "days"}, ${formatHours(arcHours(object))} in all.`}
        </p>
        <p className={reportStyles.note}>When the pipeline fits an orbit, a 3D view with the planets and its uncertainty appears here.</p>
      </Panel>
    );
  }

  const planets = planetsFor(orbit);
  const sig = sigmas(orbit.covariance);
  const epoch = formatUtcDate(mjdToDate(orbit.epoch_mjd).toISOString());
  return (
    <Panel
      id="orbit"
      title="Orbit"
      kicker={ORBIT_STATUS[object.orbit_status]}
      intro={`Where this object goes around the Sun, with the planets where they were on ${epoch}. ${
        cloudSource ? `The faint orbits and dots are ${clones.length} possible orbits ${cloudSource}: the wider the cloud, the less certain the orbit.` : "No uncertainty was published for this orbit."
      }`}
    >
      <WhenVisible minHeight={360}>
        <OrbitView object={orbit} clones={clones} planets={planets} epochMjd={orbit.epoch_mjd} objectLabel={label} />
      </WhenVisible>
      <ul className={styles.legend}>
        <li>
          <span className={styles.swObject} aria-hidden="true" /> {label}
        </li>
        {clones.length > 0 && (
          <li>
            <span className={styles.swClone} aria-hidden="true" /> Possible orbits (uncertainty)
          </li>
        )}
        <li>
          <span className={styles.swPlanet} aria-hidden="true" /> Planets (approximate positions)
        </li>
      </ul>

      <div className={styles.cols}>
        <div className={reportStyles.tableWrap}>
          <table className={reportStyles.table}>
            <caption className="visually-hidden">Orbital elements</caption>
            <thead>
              <tr>
                <th scope="col">Element</th>
                <th scope="col">Value</th>
                <th scope="col">± 1σ</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, i) => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  <td className="mono">
                    {fmt(orbit[r.key] as number, r.digits)}
                    {r.unit && r.unit !== "°" ? ` ${r.unit}` : r.unit}
                  </td>
                  <td className="mono">{sig[i] === null ? "—" : fmt(sig[i], r.digits)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Perihelion q</th>
                <td className="mono">{fmt(orbit.q_au, 3)} AU</td>
                <td className="mono">—</td>
              </tr>
            </tbody>
          </table>
        </div>
        <dl className={reportStyles.facts}>
          <div>
            <dt>Fitted from</dt>
            <dd>
              {orbit.n_detections} sightings over {formatHours(orbit.arc_hours)}
            </dd>
          </div>
          <div>
            <dt>Method</dt>
            <dd className="mono">{orbit.method}</dd>
          </div>
          <div>
            <dt>Fit scatter</dt>
            <dd className="mono">{fmt(orbit.rms_arcsec, 2)}″ RMS</dd>
          </div>
          <div>
            <dt>Elements at</dt>
            <dd>{epoch} (heliocentric ecliptic J2000)</dd>
          </div>
        </dl>
      </div>

      {orbit.jpl_comparison && (
        <div className={styles.jpl}>
          <h3 className={styles.subhead}>Checked against JPL</h3>
          <p>
            JPL&apos;s orbit for <strong>{orbit.jpl_comparison.designation}</strong> differs from ours by{" "}
            <span className="mono">{fmt(orbit.jpl_comparison.delta_a_au, 3)} AU</span> in a,{" "}
            <span className="mono">{fmt(orbit.jpl_comparison.delta_e, 3)}</span> in e and{" "}
            <span className="mono">{fmt(orbit.jpl_comparison.delta_i_deg, 2)}°</span> in i. Thirty days on, the two predict positions{" "}
            <span className="mono">{fmt(orbit.jpl_comparison.position_error_arcsec_30d, 1)}″</span> apart.
          </p>
        </div>
      )}
    </Panel>
  );
}

function arcHours(o: ObjectDetail) {
  const ts = o.detections.map((d) => d.mjd);
  return ts.length ? (Math.max(...ts) - Math.min(...ts)) * 24 : 0;
}

/** Loads three.js only when the orbit comes into view; falls back to a 2D view without WebGL. */
function OrbitView(props: Omit<SceneProps, "onFail">) {
  const [Scene, setScene] = useState<ComponentType<SceneProps> | null>(null);
  const [flat, setFlat] = useState(false);
  useEffect(() => {
    let live = true;
    import("./OrbitScene").then(
      (m) => live && setScene(() => m.default),
      () => live && setFlat(true),
    );
    return () => {
      live = false;
    };
  }, []);
  if (flat) return <OrbitTopDown {...props} />;
  if (!Scene) return <div className={`skeleton ${styles.scene}`} role="status" aria-label="Loading the 3D orbit" />;
  return (
    <figure className={styles.figure}>
      <Scene {...props} onFail={() => setFlat(true)} />
      <figcaption className={reportStyles.note}>
        3D view: drag to turn, pinch or scroll to zoom.{" "}
        <button type="button" className={styles.linkButton} onClick={() => setFlat(true)}>
          Show a flat view instead
        </button>
      </figcaption>
    </figure>
  );
}
