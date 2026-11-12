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
  /** A smaller, quieter version (for the home page): no labels or readout, slow spin. */
  compact?: boolean;
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

/** A repeatable random stream, so the decorative star field is the same on every visit. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
}

/**
 * Soft round points that glow additively. Per point: colour, size (in pixels at DPR 1), and a
 * phase; `uPulse` scales how strongly a point breathes (0 = steady).
 */
function glowPoints(positions: THREE.Vector3[], colors: THREE.Color[], sizes: number[], opts: { pulse?: number; twinkle?: number; dpr: number; front?: boolean }) {
  const n = positions.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const phase = new Float32Array(n);
  const rand = seeded(n * 31 + 7);
  positions.forEach((p, i) => {
    pos.set([p.x, p.y, p.z], i * 3);
    col.set([colors[i]!.r, colors[i]!.g, colors[i]!.b], i * 3);
    size[i] = sizes[i]!;
    phase[i] = rand() * Math.PI * 2;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDpr: { value: opts.dpr },
      uPulse: { value: opts.pulse ?? 0 },
      uTwinkle: { value: opts.twinkle ?? 0 },
      // Only the half facing the camera: the globe hides the rest.
      uFront: { value: opts.front ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute float size;
      attribute float phase;
      uniform float uTime;
      uniform float uDpr;
      uniform float uPulse;
      uniform float uTwinkle;
      uniform float uFront;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        float facing = dot(normalize(world.xyz), normalize(cameraPosition));
        float wave = sin(uTime * 2.2 + phase);
        float breathe = 1.0 + uPulse * (0.5 + 0.5 * wave);
        float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * 1.3 + phase * 3.0));
        vColor = color;
        vAlpha = tw * mix(1.0, smoothstep(-0.05, 0.25, facing), uFront);
        vec4 mv = viewMatrix * world;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * breathe * uDpr;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        if (d > 1.0) discard;
        // A bright core with a soft halo.
        float a = smoothstep(1.0, 0.0, d);
        a = a * a * 0.85 + smoothstep(0.35, 0.0, d) * 0.6;
        gl_FragColor = vec4(vColor * a, a * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

/**
 * The whole sky as a globe seen from outside, drawn as a glowing model: the Milky Way as a band of
 * light, the ecliptic as a dashed ring, every patch searched as a point, and a pulsing beacon with a
 * light pillar wherever a moving object was found (taller for more objects). Hover or tap a beacon
 * for its name; select it to open the patch.
 */
export default function SkyGlobe({ tiles, emptyCells, planetNine, tileName, onFail, compact = false }: SkyGlobeProps) {
  const [hot, setHot] = useState<SkyTile | null>(null);

  const build = (stage: Stage, host: HTMLDivElement) => {
    const { scene } = stage;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const paper = cssColor("--text", "#f2f5f9");
    const muted = cssColor("--text-muted", "#a9bcd6");
    const sodium = cssColor("--sodium", "#ffcf5a");
    const track = cssColor("--track", "#7cf0c8");
    const cool = cssColor("--cool", "#9cd4ff");
    const gold = cssColor("--ir-7", "#f7d13d");
    const well = cssColor("--well", "#0b1f3a");
    const rand = seeded(20251104);

    const living: THREE.ShaderMaterial[] = [];
    const add = <T extends THREE.Object3D>(o: T) => {
      scene.add(o);
      if (o instanceof THREE.Points && o.material instanceof THREE.ShaderMaterial) living.push(o.material);
      return o;
    };

    // Far stars: a fixed backdrop that turns with the globe.
    {
      const pts: THREE.Vector3[] = [];
      const cols: THREE.Color[] = [];
      const sizes: number[] = [];
      for (let i = 0; i < (compact ? 900 : 2200); i++) {
        const v = new THREE.Vector3(gaussian(rand), gaussian(rand), gaussian(rand)).normalize().multiplyScalar(7 + rand() * 6);
        pts.push(v);
        cols.push(new THREE.Color().copy(paper).lerp(cool, rand() * 0.6).multiplyScalar(0.35 + rand() * 0.5));
        sizes.push(1.2 + rand() * rand() * 3.2);
      }
      add(glowPoints(pts, cols, sizes, { dpr, twinkle: 0.55 }));
    }

    // The globe: a dark body with a cool rim, so the far side's markings stay hidden.
    const rim = new THREE.ShaderMaterial({
      uniforms: { uBody: { value: well }, uRim: { value: cool } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - world.xyz);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uBody;
        uniform vec3 uRim;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float f = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.6);
          gl_FragColor = vec4(mix(uBody, uRim, f * 0.55), 1.0);
        }
      `,
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.998, 72, 48), rim));

    // A faint halo just outside the globe.
    const halo = new THREE.ShaderMaterial({
      uniforms: { uRim: { value: cool } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - world.xyz);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uRim;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float f = pow(1.0 - abs(dot(vNormal, vView)), 4.0);
          gl_FragColor = vec4(uRim * f, f * 0.5);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.12, 64, 40), halo));

    const gridMat = stage.keep(new THREE.LineBasicMaterial({ color: muted, transparent: true, opacity: 0.13 }));
    for (let dec = -60; dec <= 60; dec += 30) {
      scene.add(circle(Array.from({ length: 121 }, (_, i) => onSphere(i * 3, dec, 1.001)), gridMat));
    }
    for (let ra = 0; ra < 360; ra += 30) {
      scene.add(circle(Array.from({ length: 61 }, (_, i) => onSphere(ra, -90 + i * 3, 1.001)), gridMat));
    }

    // The Milky Way: thousands of points scattered about the galactic plane, densest toward the
    // centre (l = 0), warmer in the bulge.
    {
      const pts: THREE.Vector3[] = [];
      const cols: THREE.Color[] = [];
      const sizes: number[] = [];
      const warm = new THREE.Color("#ffe2b0");
      const n = compact ? 5000 : 9000;
      for (let i = 0; i < n; i++) {
        let l = rand() * 360;
        // More stars toward the galactic centre.
        if (rand() < 0.35) l = (gaussian(rand) * 35 + 360) % 360;
        const toCentre = Math.cos(l * D2R) * 0.5 + 0.5;
        const b = gaussian(rand) * (3 + 5 * toCentre * toCentre);
        const p = galacticToEquatorial(l, b);
        pts.push(onSphere(p.ra_deg, p.dec_deg, 1.004));
        cols.push(new THREE.Color().copy(cool).lerp(warm, toCentre * toCentre * 0.8).multiplyScalar(0.2 + rand() * 0.35));
        sizes.push(3 + rand() * 6);
      }
      add(glowPoints(pts, cols, sizes, { dpr, front: true }));
    }

    const near = (p: THREE.Vector3) => (cam: THREE.PerspectiveCamera) => p.dot(cam.position) > 1;
    const eclMat = stage.keep(new THREE.LineDashedMaterial({ color: sodium, dashSize: 0.035, gapSize: 0.025, transparent: true, opacity: 0.9 }));
    const ecl = circle(
      Array.from({ length: 241 }, (_, i) => {
        const p = eclipticToEquatorial(i * 1.5, 0);
        return onSphere(p.ra_deg, p.dec_deg, 1.006);
      }),
      eclMat,
    );
    ecl.computeLineDistances();
    scene.add(ecl);

    if (!compact) {
      for (const [text, pos, kind] of [
        ["North pole", onSphere(0, 90, 1.04), "plain"],
        ["South pole", onSphere(0, -90, 1.04), "plain"],
        ["Ecliptic", (() => { const p = eclipticToEquatorial(100, 0); return onSphere(p.ra_deg, p.dec_deg, 1.04); })(), "sun"],
        ["Ecliptic", (() => { const p = eclipticToEquatorial(280, 0); return onSphere(p.ra_deg, p.dec_deg, 1.04); })(), "sun"],
        ["Milky Way", (() => { const p = galacticToEquatorial(40, 0); return onSphere(p.ra_deg, p.dec_deg, 1.04); })(), "cool"],
        ["Milky Way", (() => { const p = galacticToEquatorial(220, 0); return onSphere(p.ra_deg, p.dec_deg, 1.04); })(), "cool"],
      ] as const) {
        stage.tag(text, pos, kind, near(pos));
      }
    }

    // Planet Nine region: the cells holding 95% of the predicted positions, brighter inside 68%.
    if (planetNine?.cells.length) {
      const levels = credibleLevels(planetNine.cells);
      const pts: THREE.Vector3[] = [];
      const cols: THREE.Color[] = [];
      const sizes: number[] = [];
      planetNine.cells.forEach((c, i) => {
        const level = levels[i];
        if (level === null || level === undefined) return;
        pts.push(onSphere(c.ra_deg, c.dec_deg, 1.003));
        cols.push(new THREE.Color().copy(gold).multiplyScalar(level <= 0.68 ? 0.45 : 0.18));
        sizes.push(Math.max(6, planetNine.cell_deg * 3));
      });
      add(glowPoints(pts, cols, sizes, { dpr, front: true }));
      if (!compact) {
        const peak = planetNine.cells.reduce((a, b) => (b.fraction > a.fraction ? b : a));
        const pp = onSphere(peak.ra_deg, peak.dec_deg, 1.04);
        stage.tag("Planet Nine search region", pp, "sun", near(pp));
      }
    }

    // Patches searched without a find: small, steady, paper-white.
    const emptyPts = [
      ...(emptyCells ?? []).map(([ra, dec]) => onSphere(ra, dec, 1.007)),
      ...tiles.filter((t) => t.status === "empty").map((t) => onSphere(t.center.ra_deg, t.center.dec_deg, 1.007)),
    ];
    if (emptyPts.length) {
      const c = new THREE.Color().copy(paper).multiplyScalar(0.32);
      add(glowPoints(emptyPts, emptyPts.map(() => c), emptyPts.map(() => 3.2), { dpr, front: true }));
    }

    // Patches with moving objects: pulsing beacons, each with a pillar of light whose height
    // grows with the number of objects found there.
    const found = tiles.filter((t) => t.status === "processed");
    const foundPts = found.map((t) => onSphere(t.center.ra_deg, t.center.dec_deg, 1.009));
    if (foundPts.length) {
      add(
        glowPoints(
          foundPts,
          found.map(() => track),
          found.map((t) => 7 + Math.min(8, t.n_candidates * 2)),
          { dpr, pulse: 0.55, front: true },
        ),
      );
      const seg = new Float32Array(found.length * 6);
      const segCol = new Float32Array(found.length * 6);
      found.forEach((t, i) => {
        const base = foundPts[i]!;
        const tip = base.clone().multiplyScalar(1 + 0.025 + Math.min(0.12, 0.03 * Math.sqrt(t.n_candidates)));
        seg.set([base.x, base.y, base.z, tip.x, tip.y, tip.z], i * 6);
        segCol.set([track.r, track.g, track.b, 0, 0, 0], i * 6);
      });
      const pillarGeo = new THREE.BufferGeometry();
      pillarGeo.setAttribute("position", new THREE.BufferAttribute(seg, 3));
      pillarGeo.setAttribute("color", new THREE.BufferAttribute(segCol, 3));
      scene.add(
        new THREE.LineSegments(
          pillarGeo,
          new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
        ),
      );
    }

    // SPHEREx's own path: a slow scan ring pole to pole, the way it sweeps the sky.
    const scanMat = new THREE.LineBasicMaterial({ color: paper, transparent: true, opacity: 0.22 });
    const scan = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 121 }, (_, i) => onSphere(0, -90 + i * 1.5, 1.02))),
      scanMat,
    );
    const scanPivot = new THREE.Group();
    scanPivot.add(scan);
    scene.add(scanPivot);

    stage.onFrame((t) => {
      for (const m of living) m.uniforms.uTime!.value = t;
      // One sweep of the sky every 40 seconds.
      scanPivot.rotation.y = (t / 40) * Math.PI * 2;
    });

    if (compact) return;

    // Hover or tap a beacon to name it; a second tap (or a click) opens it.
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
      options={{
        reach: 1,
        camera: compact ? [2.9, 1.1, 2.9] : [3.0, 1.35, 3.0],
        fov: 35,
        minDistance: 1.5,
        maxDistance: 6,
      }}
      build={build}
      deps={[tiles, emptyCells, planetNine, compact]}
      onFail={onFail}
      tall={!compact}
      plain={compact}
    >
      {!compact && (
        <p className={styles.readout} aria-live="polite" data-idle={!hot}>
          {hot ? (
            <>
              <strong>{tileName(hot)}</strong>: {hot.n_candidates} moving {hot.n_candidates === 1 ? "object" : "objects"}.{" "}
              {hot.field_id && <a href={fieldHref(hot.field_id)}>Open this patch</a>}
            </>
          ) : (
            "Green beacons mark patches where something moved; taller pillars, more objects. Point at one to name it; select it to open."
          )}
        </p>
      )}
    </Stage3D>
  );
}
