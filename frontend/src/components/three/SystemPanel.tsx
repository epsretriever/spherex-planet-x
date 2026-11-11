"use client";

import Link from "next/link";
import { useData } from "@/lib/useData";
import { DataError } from "@/lib/api";
import { fmt } from "@/lib/format";
import { norm } from "@/lib/orbit";
import { objectHref } from "@/lib/routes";
import { planetRing, systemExtent, systemPlanets, systemReach, type SystemBody, type SystemData } from "@/lib/system";
import { WhenVisible } from "../WhenVisible";
import { Figure3D } from "./Figure3D";
import styles from "./Figure3D.module.css";

async function getSystem(signal: AbortSignal): Promise<SystemBody[]> {
  let res: Response;
  try {
    res = await fetch("/objects/system.json", { signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new DataError("unavailable", "Could not load the objects' positions.");
  }
  if (!res.ok) throw new DataError(res.status === 404 ? "not_found" : "unavailable", `The positions returned ${res.status}.`, res.status);
  const body = (await res.json()) as Partial<SystemData>;
  if (!Array.isArray(body.bodies)) throw new DataError("invalid", "The positions file has no list.");
  return body.bodies;
}

const S = 440;

/** The same scene from above the ecliptic, as SVG: the fallback without WebGL. */
export function SystemTopDown({ bodies }: { bodies: SystemBody[] }) {
  const reach = systemReach(bodies) * 1.05;
  const k = S / 2 / reach;
  const xy = (p: readonly number[]) => [S / 2 + p[0]! * k, S / 2 - p[1]! * k] as const;
  return (
    <svg
      viewBox={`0 0 ${S} ${S}`}
      className={styles.flat}
      role="img"
      aria-label={`Top-down view of the solar system with ${bodies.length} tracked objects, most between the orbits of Mars and Jupiter`}
    >
      {systemPlanets(Math.min(systemExtent(bodies), reach)).map((p) => {
        const ring = planetRing(p, 120);
        const d = ring.map((q, i) => `${i ? "L" : "M"}${xy(q)[0].toFixed(1)} ${xy(q)[1].toFixed(1)}`).join("") + "Z";
        const [lx, ly] = xy(ring[Math.round(ring.length * 0.62)]!);
        return (
          <g key={p.name}>
            <path d={d} fill="none" stroke="var(--text-muted)" strokeOpacity={0.5} />
            <text x={lx + 4} y={ly - 4}>
              {p.name}
            </text>
          </g>
        );
      })}
      <circle cx={S / 2} cy={S / 2} r={5} fill="var(--ir-7)" />
      {bodies.map((b) => {
        const [x, y] = xy(b.p);
        if (x < 0 || x > S || y < 0 || y > S) return null; // the few beyond the frame are in the 3D view and the Objects list
        return (
          <a key={b.id} href={objectHref(b.id)} aria-label={`${b.name}, about ${fmt(norm(b.p), 1)} AU from the Sun`}>
            <circle cx={x} cy={y} r={2.4} fill="var(--accent)" fillOpacity={0.9} />
          </a>
        );
      })}
    </svg>
  );
}

/**
 * "Where they are": every tracked object placed in the solar system from its fitted orbit.
 * The positions file and three.js load only when this section scrolls into view.
 */
export function SystemPanel() {
  return (
    <section className="card" aria-labelledby="system-title" style={{ padding: "var(--space-4)" }}>
      <h2 id="system-title" style={{ marginTop: 0 }}>
        The same objects, out in the solar system
      </h2>
      <p style={{ color: "var(--text-muted)", maxWidth: "70ch" }}>
        The map above shows where each object appeared on the sky. This view shows where its fitted orbit puts it in space when SPHEREx
        saw it, among the planets&apos; orbits. The direction to each object is measured; its distance is the uncertain part, because a
        day or two of sightings fits many orbits. Point at a dot to see the range.
      </p>
      <WhenVisible minHeight={420}>
        <SystemFigure />
      </WhenVisible>
      <p className={styles.caption}>
        Each dot is the position from the object&apos;s published preliminary orbit at the date of its sightings (objects were seen on
        different dates, so the planets are shown as orbits, not dots). Simulated test objects are left out.{" "}
        <Link href="/limits/">How well do these orbits work?</Link>
      </p>
    </section>
  );
}

function SystemFigure() {
  const state = useData("system-bodies", getSystem);
  if (state.status === "loading") return <div className={`skeleton ${styles.scene} ${styles.tall}`} role="status" aria-label="Loading the objects' positions" />;
  if (state.status === "error") {
    return (
      <p role="status" className={styles.caption}>
        The objects&apos; positions couldn&apos;t be loaded.{" "}
        <button type="button" className={styles.linkButton} onClick={state.retry}>
          Try again
        </button>
      </p>
    );
  }
  const bodies = state.data;
  if (bodies.length === 0) return <p className={styles.caption}>No object has an orbit yet, so there is nothing to place.</p>;
  return (
    <Figure3D
      load={() => import("./SolarSystemScene")}
      props={{ bodies }}
      flat={<SystemTopDown bodies={bodies} />}
      label="the solar-system view"
      tall
    />
  );
}
