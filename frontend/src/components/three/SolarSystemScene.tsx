"use client";

import { useState } from "react";
import * as THREE from "three";
import { norm, type Vec3 } from "@/lib/orbit";
import { objectHref } from "@/lib/routes";
import { planetRing, rangeSegment, systemExtent, systemPlanets, systemReach, type SystemBody } from "@/lib/system";
import { fmt } from "@/lib/format";
import { Stage3D } from "./Stage3D";
import { cssColor, type Stage } from "./stage";
import styles from "./Figure3D.module.css";

export interface SolarSystemProps {
  bodies: SystemBody[];
  onFail: () => void;
}

// three.js is y-up; the ecliptic plane is x–y with z north, so map (x, y, z) → (x, z, −y).
const toThree = ([x, y, z]: Vec3) => new THREE.Vector3(x, z, -y);

/**
 * Every tracked object where its fitted orbit puts it, among the planets' orbits. Point at a dot
 * for its name and its distance range (drawn as a bar along the line from the Sun); select it to
 * open its report.
 */
export default function SolarSystemScene({ bodies, onFail }: SolarSystemProps) {
  const [hot, setHot] = useState<SystemBody | null>(null);
  const reach = systemReach(bodies);

  const build = (stage: Stage, host: HTMLDivElement) => {
    const { scene } = stage;
    const accent = cssColor("--accent", "#ff8a4c");
    const muted = cssColor("--text-muted", "#aa9fbd");
    const gold = cssColor("--ir-7", "#f7d13d");

    const grid = new THREE.PolarGridHelper(reach * 1.05, 12, Math.max(2, Math.round(reach)), 96, muted, muted);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.1;
    scene.add(grid);
    stage.keep(grid.geometry);
    stage.keep(grid.material as THREE.Material);

    scene.add(new THREE.Mesh(new THREE.SphereGeometry(reach * 0.02, 24, 16), new THREE.MeshBasicMaterial({ color: gold })));
    stage.tag("Sun", new THREE.Vector3(), "sun");

    const ringMat = stage.keep(new THREE.LineBasicMaterial({ color: muted, transparent: true, opacity: 0.5 }));
    systemPlanets(systemExtent(bodies)).forEach((p, k) => {
      const ring = planetRing(p).map(toThree);
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), ringMat));
      // Label the ring, not a planet: the objects were seen on different dates.
      // Spread the labels around the Sun so neighbouring rings' labels don't sit on each other.
      stage.tag(p.name === "Earth" ? "Earth's orbit" : p.name, ring[Math.round(ring.length * ((0.3 + k * 0.17) % 1))]!, "plain");
    });

    const pts = bodies.map((b) => toThree(b.p));
    scene.add(
      new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.PointsMaterial({ color: accent, size: 5, sizeAttenuation: false, transparent: true, opacity: 0.9 }),
      ),
    );

    // The hovered object's distance range, along the line from the Sun through it.
    const barGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const bar = new THREE.Line(barGeo, new THREE.LineBasicMaterial({ color: gold }));
    bar.visible = false;
    scene.add(bar);
    const ringHot = new THREE.Mesh(new THREE.SphereGeometry(reach * 0.014, 16, 12), new THREE.MeshBasicMaterial({ color: gold }));
    ringHot.visible = false;
    scene.add(ringHot);

    let current = -1;
    const hover = stage.tag("", new THREE.Vector3(), "hover", () => current >= 0);
    let downAt: [number, number] | null = null;
    const point = (e: PointerEvent) => {
      const i = stage.pick(pts, e.clientX, e.clientY, 14);
      if (i === current) return;
      current = i;
      host.dataset.hot = i >= 0 ? "true" : "false";
      const b = i >= 0 ? bodies[i]! : null;
      if (b) {
        hover.pos.copy(pts[i]!);
        hover.el.textContent = b.name;
        ringHot.position.copy(pts[i]!);
        const seg = rangeSegment(b);
        if (seg) barGeo.setFromPoints(seg.map(toThree));
        bar.visible = !!seg;
      } else bar.visible = false;
      ringHot.visible = !!b;
      setHot(b);
      stage.invalidate();
    };
    const down = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY];
    };
    const up = (e: PointerEvent) => {
      const moved = downAt ? Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) : 99;
      downAt = null;
      if (moved > 5) return;
      const before = current;
      point(e);
      // Mouse: one click opens. Touch: the first tap names the object, the second opens it.
      if (current >= 0 && (e.pointerType === "mouse" || before === current)) window.location.assign(objectHref(bodies[current]!.id));
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
    <Stage3D options={{ reach, camera: [0, 1.15, 1.5], maxDistance: Math.max(reach * 6, systemExtent(bodies) * 3) }} build={build} deps={[bodies]} onFail={onFail} tall>
      <p className={styles.readout} aria-live="polite">
        {hot ? (
          <>
            <strong>{hot.name}</strong>: about {fmt(norm(hot.p), 1)} AU from the Sun on {hot.date}
            {hot.range ? ` (anywhere from ${fmt(hot.range[0], 1)} to ${fmt(hot.range[1], 1)} AU fits)` : ""}.{" "}
            <a href={objectHref(hot.id)}>Open its report →</a>
          </>
        ) : (
          "Point at a dot to name the object and see how uncertain its distance is."
        )}
      </p>
    </Stage3D>
  );
}
