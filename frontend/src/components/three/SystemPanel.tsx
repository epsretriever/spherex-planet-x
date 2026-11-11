"use client";

import Link from "next/link";
import { lazy, Suspense } from "react";
import { WhenVisible } from "../WhenVisible";
import styles from "./Figure3D.module.css";

// The figure (positions file, orbit math, three.js) is a separate chunk fetched when the section scrolls into view.
const SystemFigure = lazy(() => import("./SystemFigure"));

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
        <Suspense fallback={<div className={`skeleton ${styles.scene} ${styles.tall}`} role="status" aria-label="Loading the objects' positions" />}>
          <SystemFigure />
        </Suspense>
      </WhenVisible>
      <p className={styles.caption}>
        Each dot is the position from the object&apos;s published preliminary orbit at the date of its sightings (objects were seen on
        different dates, so the planets are shown as orbits, not dots). Simulated test objects are left out.{" "}
        <Link href="/limits/">How well do these orbits work?</Link>
      </p>
    </section>
  );
}

