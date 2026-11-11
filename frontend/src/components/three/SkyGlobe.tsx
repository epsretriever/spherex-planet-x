"use client";

import { useState } from "react";
import * as THREE from "three";
import type { PlanetNineRegion } from "@/lib/contract";
import { fieldHref } from "@/lib/routes";
import { credibleLevels, eclipticToEquatorial, galacticToEquatorial } from "@/lib/sky";
import type { SkyTile } from "../skyTile";
import { Stage3D } from "./Stage3D";
import { cssColor, type Stage } from "./stage";
import styles from "./Figure3D.module.css";

export interface SkyGlobeProps {
  tiles: SkyTile[];
  emptyCells?: [number, number][];
  planetNine?: PlanetNineRegion | null;
  tileName: (t: SkyTile) => string;
  onFail: () => void;
}

const D2R = Math.PI / 180;
/** Equatorial RA/Dec on a sphere of radius r; three.js is y-up, so the celestial pole is +y. */
function onSphere(raDeg: number, decDeg: number, r = 1): THREE.Vector3 {
  const a = raDeg * D2R;
  const d = decDeg * D2R;
  return new THREE.Vector3(r * Math.cos(d) * Math.cos(a), r * Math.sin(d), -r * Math.cos(d) * Math.sin(a));
}

function circle(points: THREE.Vector3[], material: THREE.Material) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
}

/**
 * The whole sky as a globe seen from outside: every patch searched (bright where a moving object
 * was found), the ecliptic, the Milky Way's plane and the published Planet Nine region. Hover or
 * tap a bright patch for its name; select it to open the patch.
 */
export default function SkyGlobe({ tiles, emptyCells, planetNine, tileName, onFail }: SkyGlobeProps) {
  const [hot, setHot] = useState<SkyTile | null>(null);

  const build = (stage: Stage, host: HTMLDivElement) => {
    const { scene } = stage;
    const accent = cssColor("--accent", "#ff8a4c");
    const muted = cssColor("--text-muted", "#aa9fbd");
    const cool = cssColor("--cool", "#7cc4ff");
    const gold = cssColor("--ir-7", "#f7d13d");
    const surface = cssColor("--surface-2", "#1b1526");

    // The globe itself hides whatever is on the far side.
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.999, 64, 40), new THREE.MeshBasicMaterial({ color: surface })));

    const gridMat = stage.keep(new THREE.LineBasicMaterial({ color: muted, transparent: true, opacity: 0.22 }));
    for (let dec = -60; dec <= 60; dec += 30) {
      scene.add(circle(Array.from({ length: 121 }, (_, i) => onSphere(i * 3, dec, 1.001)), gridMat));
    }
    for (let ra = 0; ra < 360; ra += 30) {
      scene.add(circle(Array.from({ length: 61 }, (_, i) => onSphere(ra, -90 + i * 3, 1.001)), gridMat));
    }

    const near = (p: THREE.Vector3) => (cam: THREE.PerspectiveCamera) => p.dot(cam.position) > 1;
    const eclMat = stage.keep(new THREE.LineDashedMaterial({ color: accent, dashSize: 0.04, gapSize: 0.025 }));
    const ecl = circle(
      Array.from({ length: 181 }, (_, i) => {
        const p = eclipticToEquatorial(i * 2, 0);
        return onSphere(p.ra_deg, p.dec_deg, 1.003);
      }),
      eclMat,
    );
    ecl.computeLineDistances();
    scene.add(ecl);
    const galMat = stage.keep(new THREE.LineBasicMaterial({ color: cool, transparent: true, opacity: 0.55 }));
    scene.add(
      circle(
        Array.from({ length: 181 }, (_, i) => {
          const p = galacticToEquatorial(i * 2, 0);
          return onSphere(p.ra_deg, p.dec_deg, 1.003);
        }),
        galMat,
      ),
    );
    for (const [text, pos, kind] of [
      ["North pole", onSphere(0, 90, 1.03), "plain"],
      ["South pole", onSphere(0, -90, 1.03), "plain"],
      ["Ecliptic", (() => { const p = eclipticToEquatorial(100, 0); return onSphere(p.ra_deg, p.dec_deg, 1.03); })(), "accent"],
      ["Ecliptic", (() => { const p = eclipticToEquatorial(280, 0); return onSphere(p.ra_deg, p.dec_deg, 1.03); })(), "accent"],
      ["Milky Way", (() => { const p = galacticToEquatorial(40, 0); return onSphere(p.ra_deg, p.dec_deg, 1.03); })(), "cool"],
      ["Milky Way", (() => { const p = galacticToEquatorial(220, 0); return onSphere(p.ra_deg, p.dec_deg, 1.03); })(), "cool"],
    ] as const) {
      stage.tag(text, pos, kind, near(pos));
    }

    // Planet Nine region: the cells holding 95% of the predicted positions, brighter inside 68%.
    if (planetNine?.cells.length) {
      const levels = credibleLevels(planetNine.cells);
      const inner: THREE.Vector3[] = [];
      const outer: THREE.Vector3[] = [];
      planetNine.cells.forEach((c, i) => {
        const level = levels[i];
        if (level === null || level === undefined) return;
        (level <= 0.68 ? inner : outer).push(onSphere(c.ra_deg, c.dec_deg, 1.002));
      });
      const px = Math.max(3, planetNine.cell_deg * 1.6);
      scene.add(
        new THREE.Points(new THREE.BufferGeometry().setFromPoints(outer), new THREE.PointsMaterial({ color: gold, size: px, sizeAttenuation: false, transparent: true, opacity: 0.16 })),
        new THREE.Points(new THREE.BufferGeometry().setFromPoints(inner), new THREE.PointsMaterial({ color: gold, size: px, sizeAttenuation: false, transparent: true, opacity: 0.4 })),
      );
      const peak = planetNine.cells.reduce((a, b) => (b.fraction > a.fraction ? b : a));
      const pp = onSphere(peak.ra_deg, peak.dec_deg, 1.03);
      stage.tag("Planet Nine search region", pp, "sun", near(pp));
    }

    const emptyPts = [
      ...(emptyCells ?? []).map(([ra, dec]) => onSphere(ra, dec, 1.004)),
      ...tiles.filter((t) => t.status === "empty").map((t) => onSphere(t.center.ra_deg, t.center.dec_deg, 1.004)),
    ];
    if (emptyPts.length) {
      scene.add(
        new THREE.Points(new THREE.BufferGeometry().setFromPoints(emptyPts), new THREE.PointsMaterial({ color: cool, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.6 })),
      );
    }
    const found = tiles.filter((t) => t.status === "processed");
    const foundPts = found.map((t) => onSphere(t.center.ra_deg, t.center.dec_deg, 1.006));
    if (foundPts.length) {
      scene.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(foundPts), new THREE.PointsMaterial({ color: accent, size: 6, sizeAttenuation: false })));
    }

    // Hover or tap a bright patch to name it; a second tap (or a click) opens it.
    const hover = stage.tag("", new THREE.Vector3(), "hover", () => current >= 0);
    let current = -1;
    let downAt: [number, number] | null = null;
    const visible = (i: number) => foundPts[i]!.dot(stage.camera.position) > 1;
    const point = (e: PointerEvent) => {
      const i = stage.pick(foundPts, e.clientX, e.clientY, 16, visible);
      if (i === current) return;
      current = i;
      host.dataset.hot = i >= 0 ? "true" : "false";
      if (i >= 0) {
        hover.pos.copy(foundPts[i]!);
        hover.el.textContent = tileName(found[i]!);
      }
      setHot(i >= 0 ? found[i]! : null);
      stage.invalidate();
    };
    const down = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY];
    };
    const up = (e: PointerEvent) => {
      const moved = downAt ? Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) : 99;
      downAt = null;
      if (moved > 5) return; // a drag, not a click
      const before = current;
      point(e);
      const t = current >= 0 ? found[current] : undefined;
      // Mouse: one click opens. Touch: the first tap names the patch, the second opens it.
      if (t?.field_id && (e.pointerType === "mouse" || before === current)) window.location.assign(fieldHref(t.field_id));
    };
    stage.canvas.addEventListener("pointermove", point);
    stage.canvas.addEventListener("pointerdown", down);
    stage.canvas.addEventListener("pointerup", up);
    return () => {
      stage.canvas.removeEventListener("pointermove", point);
      stage.canvas.removeEventListener("pointerdown", down);
      stage.canvas.removeEventListener("pointerup", up);
    };
  };

  return (
    <Stage3D
      options={{ reach: 1, camera: [2.35, 1.0, 2.35], fov: 35, minDistance: 1.5, maxDistance: 6 }}
      build={build}
      deps={[tiles, emptyCells, planetNine]}
      onFail={onFail}
      tall
    >
      <p className={styles.readout} aria-live="polite">
        {hot ? (
          <>
            <strong>{tileName(hot)}</strong>: {hot.n_candidates} moving {hot.n_candidates === 1 ? "object" : "objects"}.{" "}
            {hot.field_id && <a href={fieldHref(hot.field_id)}>Open this patch →</a>}
          </>
        ) : (
          "Point at a bright patch to name it; select it to open the patch."
        )}
      </p>
    </Stage3D>
  );
}
