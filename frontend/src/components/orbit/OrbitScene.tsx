"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { orbitPoints, planetElements, positionAt, type Elements, type Planet, type Vec3 } from "@/lib/orbit";
import styles from "./Orbit.module.css";

export interface SceneProps {
  object: Elements;
  clones: Elements[];
  planets: Planet[];
  epochMjd: number;
  objectLabel: string;
  /** More orbits to draw beside the main one (the comparison page), each with its own label. */
  others?: { elements: Elements; label: string }[];
  /** Called when WebGL can't start, so the caller can show the 2D view instead. */
  onFail: () => void;
}

/** CSS custom property as a three.js colour, so the scene follows the site palette. */
function cssColor(name: string, fallback: string): THREE.Color {
  const v = typeof window === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try {
    return new THREE.Color(v || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

// three.js is y-up; the ecliptic plane is x–y with z north, so map (x, y, z) → (x, z, −y).
const toThree = ([x, y, z]: Vec3) => new THREE.Vector3(x, z, -y);

function line(points: Vec3[], material: THREE.LineBasicMaterial) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(toThree)), material);
}

/**
 * Interactive 3D orbit: the Sun, the planets on their orbits at the orbit's epoch, the object's
 * orbit, and its uncertainty cloud (one faint orbit and one dot per clone). Drag to turn, pinch
 * or scroll to zoom. Turns slowly on its own unless the reader prefers reduced motion.
 */
export default function OrbitScene({ object, clones, planets, epochMjd, objectLabel, others, onFail }: SceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const failed = useRef(onFail);
  useEffect(() => {
    failed.current = onFail;
  });

  useEffect(() => {
    const el = host.current;
    const labelLayer = labels.current;
    if (!el || !labelLayer) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      failed.current();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.prepend(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    const reach = Math.max(object.a_au * (1 + object.e), ...(others ?? []).map((o) => o.elements.a_au * (1 + o.elements.e)), ...planets.map((p) => p.a * (1 + p.e)), 1.5);
    const camera = new THREE.PerspectiveCamera(40, 1, reach / 200, reach * 20);
    camera.position.set(0, reach * 1.25, reach * 1.6);

    const accent = cssColor("--accent", "#ff8a4c");
    const muted = cssColor("--text-muted", "#aa9fbd");
    const cool = cssColor("--cool", "#7cc4ff");
    const disposables: { dispose: () => void }[] = [];
    const mat = <T extends { dispose: () => void }>(m: T) => (disposables.push(m), m);

    // The ecliptic plane, faintly.
    const grid = new THREE.PolarGridHelper(reach * 1.05, 12, Math.max(2, Math.round(reach)), 96, muted, muted);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.12;
    scene.add(grid);

    const sun = new THREE.Mesh(new THREE.SphereGeometry(reach * 0.018, 24, 16), mat(new THREE.MeshBasicMaterial({ color: cssColor("--ir-7", "#f7d13d") })));
    scene.add(sun);

    const tags: { text: string; pos: THREE.Vector3; kind: "sun" | "planet" | "object" | "second" }[] = [{ text: "Sun", pos: new THREE.Vector3(), kind: "sun" }];

    const planetLine = mat(new THREE.LineBasicMaterial({ color: muted, transparent: true, opacity: 0.45 }));
    const planetDot = mat(new THREE.MeshBasicMaterial({ color: cool }));
    const dotGeo = new THREE.SphereGeometry(reach * 0.009, 12, 8);
    disposables.push(dotGeo);
    for (const p of planets) {
      const el0 = planetElements(p, epochMjd);
      scene.add(line(orbitPoints(el0, 160), planetLine));
      const pos = toThree(positionAt(el0));
      const dot = new THREE.Mesh(dotGeo, planetDot);
      dot.position.copy(pos);
      scene.add(dot);
      tags.push({ text: p.name, pos, kind: "planet" });
    }

    // Uncertainty cloud: faint orbits and the clones' positions at the epoch.
    if (clones.length) {
      const cloneLine = mat(new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: Math.max(0.03, Math.min(0.12, 6 / clones.length)) }));
      for (const c of clones) scene.add(line(orbitPoints(c, 120), cloneLine));
      const pts = new THREE.BufferGeometry().setFromPoints(clones.map((c) => toThree(positionAt(c))));
      disposables.push(pts);
      scene.add(new THREE.Points(pts, mat(new THREE.PointsMaterial({ color: accent, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.7 }))));
    }

    scene.add(line(orbitPoints(object, 240), mat(new THREE.LineBasicMaterial({ color: accent }))));
    const objPos = toThree(positionAt(object));
    const obj = new THREE.Mesh(new THREE.SphereGeometry(reach * 0.013, 16, 12), mat(new THREE.MeshBasicMaterial({ color: accent })));
    obj.position.copy(objPos);
    scene.add(obj);
    tags.push({ text: objectLabel, pos: objPos, kind: "object" });

    for (const other of others ?? []) {
      scene.add(line(orbitPoints(other.elements, 240), mat(new THREE.LineBasicMaterial({ color: cool }))));
      const pos = toThree(positionAt(other.elements));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(reach * 0.013, 16, 12), mat(new THREE.MeshBasicMaterial({ color: cool })));
      dot.position.copy(pos);
      scene.add(dot);
      tags.push({ text: other.label, pos, kind: "second" });
    }

    // HTML labels, positioned each frame.
    const tagEls = tags.map((t) => {
      const span = document.createElement("span");
      span.textContent = t.text;
      span.className = styles.tag ?? "";
      span.dataset.kind = t.kind;
      labelLayer.appendChild(span);
      return span;
    });

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = reach * 0.15;
    controls.maxDistance = reach * 6;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    controls.autoRotate = !reduce;
    controls.autoRotateSpeed = 0.4;
    const stopSpin = () => (controls.autoRotate = false);
    renderer.domElement.addEventListener("pointerdown", stopSpin);

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const v = new THREE.Vector3();
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
      const w = el.clientWidth;
      const h = el.clientHeight;
      tags.forEach((t, i) => {
        v.copy(t.pos).project(camera);
        const span = tagEls[i]!;
        const visible = v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05;
        span.style.display = visible ? "" : "none";
        if (visible) span.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      });
    });

    const reset = () => {
      camera.position.set(0, reach * 1.25, reach * 1.6);
      controls.target.set(0, 0, 0);
      controls.update();
    };
    el.addEventListener("orbit-reset", reset);

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      el.removeEventListener("orbit-reset", reset);
      renderer.domElement.removeEventListener("pointerdown", stopSpin);
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Line || o instanceof THREE.Points || o instanceof THREE.Mesh) o.geometry.dispose();
      });
      (grid.material as THREE.Material).dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      tagEls.forEach((s) => s.remove());
    };
  }, [object, clones, planets, epochMjd, objectLabel, others]);

  return (
    <div ref={host} className={styles.scene}>
      <div ref={labels} className={styles.tags} aria-hidden="true" />
      <button type="button" className={styles.reset} onClick={() => host.current?.dispatchEvent(new Event("orbit-reset"))}>
        Reset view
      </button>
    </div>
  );
}
