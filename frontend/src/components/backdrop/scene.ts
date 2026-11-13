import * as THREE from "three";
import type { BackdropVariant } from "./variant";

/**
 * The 3D backdrop behind every page except home. Three scenes share one renderer and one set of
 * behaviours:
 * - the stars sit at three depths, so the view has real parallax as it turns;
 * - the pointer turns the view a little, and an object near the pointer gets a tracking reticle,
 *   the way the pipeline marks a moving source;
 * - a click on empty page background sends a comet across the sky;
 * - scrolling turns the scene and flies forward;
 * - a few objects leave "sightings" (mint dots, one per visit) as they move: the idea of the site.
 *
 * It never takes clicks (the canvas has pointer-events: none), pauses in background tabs, drops to
 * 30 fps on a slow device, and with reduced motion only follows the reader's own input.
 */

export interface Backdrop {
  setVariant(v: BackdropVariant): void;
  dispose(): void;
}

const MINT = new THREE.Color("#7cf0c8");
const COOL = new THREE.Color("#9cd4ff");
const SUN = new THREE.Color("#ffd27a");

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

function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
}

/** A soft radial glow, drawn once, for the sun, nebulae and comet heads. */
function glowTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A lumpy, flat-shaded rock: an icosahedron with every vertex pushed in or out a little. */
function rockGeometry(seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const r = seeded(seed);
  // Shared vertices must move together or the rock cracks open: key the jitter by position.
  const bump = new Map<string, number>();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!bump.has(key)) bump.set(key, 0.72 + r() * 0.5);
    v.multiplyScalar(bump.get(key)!);
    v.y *= 0.78;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Soft round points with optional twinkle; size is in pixels at 100 units away. */
function starMaterial(dpr: number, twinkle: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDpr: { value: dpr }, uTwinkle: { value: twinkle }, uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float phase;
      attribute vec3 color;
      uniform float uTime, uDpr, uTwinkle;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(size * uDpr * (100.0 / -mv.z), 1.0, 28.0 * uDpr);
        vColor = color;
        vAlpha = 1.0 - uTwinkle + uTwinkle * (0.55 + 0.45 * sin(uTime * 1.3 + phase));
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor, a * a * vAlpha * uFade);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function points(pos: number[], col: number[], size: number[], mat: THREE.ShaderMaterial) {
  const geo = new THREE.BufferGeometry();
  const r = seeded(pos.length);
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("size", new THREE.Float32BufferAttribute(size, 1));
  geo.setAttribute("phase", new THREE.Float32BufferAttribute(Array.from({ length: size.length }, () => r() * 6.283), 1));
  return new THREE.Points(geo, mat);
}

interface Rock {
  /** Where the rock is, in its parent's frame, at time t (seconds). */
  at: (t: number, out: THREE.Vector3) => void;
  scale: number;
  spin: THREE.Vector3;
  phase: number;
}

/** One built scene: its objects plus how to move them. */
interface Built {
  root: THREE.Group;
  update: (t: number, dt: number) => void;
  /** World positions the reticle may lock onto. */
  pickables: () => { pos: THREE.Vector3; size: number }[];
  dispose: () => void;
}

export function createBackdrop(canvas: HTMLCanvasElement, initial: BackdropVariant): Backdrop | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "low-power" });
  } catch {
    return null;
  }
  // A software renderer (no GPU) draws every frame on the CPU: show one still frame instead.
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  const software = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
  const reduce = software || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
  const world = new THREE.Group();
  scene.add(world);

  let w = 1;
  let h = 1;
  let dpr = 1;
  let small = false;
  const resize = () => {
    w = Math.max(1, window.innerWidth);
    h = Math.max(1, window.innerHeight);
    small = w < 700;
    // A soft backdrop: cap it near 1.6 megapixels, fill rate is what costs.
    dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1.6e6 / (w * h)));
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Narrow screens: pull back so the scene still fits.
    camera.fov = small ? 70 : 55;
    camera.updateProjectionMatrix();
    starMat.uniforms.uDpr!.value = dpr;
    sightMat.uniforms.uDpr!.value = dpr;
  };

  // ---------- shared: stars at three depths, two faint nebulae ----------
  const starMat = starMaterial(1, reduce ? 0 : 0.5);
  const stars = (() => {
    const r = seeded(11);
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const n = window.innerWidth < 700 ? 1400 : 2600;
    const warm = new THREE.Color("#ffe2b8");
    const white = new THREE.Color("#f2f5f9");
    for (let i = 0; i < n; i++) {
      // Three shells: near (strong parallax), middle, far.
      const shell = r();
      const dist = shell < 0.15 ? 40 + r() * 40 : shell < 0.5 ? 90 + r() * 80 : 200 + r() * 150;
      const u = r() * 2 - 1;
      const a = r() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos.push(Math.cos(a) * s * dist, u * dist * 0.8, Math.sin(a) * s * dist);
      const c = r() < 0.18 ? warm : r() < 0.3 ? COOL : white;
      const k = 0.55 + r() * 0.45;
      col.push(c.r * k, c.g * k, c.b * k);
      size.push((r() < 0.04 ? 4.2 : 1.4 + r() * 1.6) * (dist / 100));
    }
    return points(pos, col, size, starMat);
  })();
  scene.add(stars);

  const nebulaTex = glowTexture([
    [0, "rgba(255,255,255,0.55)"],
    [0.4, "rgba(255,255,255,0.18)"],
    [1, "rgba(255,255,255,0)"],
  ]);
  const nebulae = [
    { c: "#5a3fa0", p: [-120, 50, -260], s: 260, o: 0.22 },
    { c: "#1f7a8c", p: [150, -60, -300], s: 300, o: 0.18 },
  ].map(({ c, p, s, o }) => {
    const m = new THREE.SpriteMaterial({ map: nebulaTex, color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending });
    const sp = new THREE.Sprite(m);
    sp.position.set(p[0]!, p[1]!, p[2]!);
    sp.scale.setScalar(s);
    scene.add(sp);
    return sp;
  });

  const sunTex = glowTexture([
    [0, "rgba(255,248,225,1)"],
    [0.12, "rgba(255,214,130,0.85)"],
    [0.35, "rgba(251,155,60,0.25)"],
    [1, "rgba(207,68,70,0)"],
  ]);

  // Lights shared by the rock scenes (the sun's position is set per scene).
  const sunLight = new THREE.PointLight(SUN, 3.2, 0, 0);
  const fill = new THREE.HemisphereLight("#9cc8ff", "#1a2440", 0.55);
  scene.add(sunLight, fill);

  // Rock geometry: a few shapes, reused by instancing.
  const rockGeos = [rockGeometry(1), rockGeometry(2), rockGeometry(3)];
  const rockMat = new THREE.MeshStandardMaterial({ color: "#a7b4c8", roughness: 0.95, metalness: 0.05, flatShading: true });

  /** Instanced rocks, split across the shapes. */
  function rockField(rocks: Rock[], parent: THREE.Object3D) {
    const meshes = rockGeos.map((g, k) => {
      const count = rocks.filter((_, i) => i % rockGeos.length === k).length;
      const m = new THREE.InstancedMesh(g, rockMat, Math.max(1, count));
      m.count = count;
      m.frustumCulled = false;
      parent.add(m);
      return m;
    });
    const tint = new THREE.Color();
    const r = seeded(rocks.length);
    rocks.forEach((_, i) => {
      const m = meshes[i % meshes.length]!;
      const v = 0.75 + r() * 0.35;
      tint.setRGB(v, v * (0.95 + r() * 0.08), v * (0.92 + r() * 0.12));
      m.setColorAt(Math.floor(i / meshes.length), tint);
    });
    const tmp = new THREE.Object3D();
    const p = new THREE.Vector3();
    const worldPos = rocks.map(() => new THREE.Vector3());
    return {
      update(t: number) {
        rocks.forEach((rk, i) => {
          rk.at(t, p);
          tmp.position.copy(p);
          tmp.rotation.set(rk.phase + t * rk.spin.x, rk.phase * 2 + t * rk.spin.y, t * rk.spin.z);
          tmp.scale.setScalar(rk.scale);
          tmp.updateMatrix();
          meshes[i % meshes.length]!.setMatrixAt(Math.floor(i / meshes.length), tmp.matrix);
        });
        for (const m of meshes) m.instanceMatrix.needsUpdate = true;
      },
      worldPositions() {
        parent.updateWorldMatrix(true, false);
        rocks.forEach((rk, i) => {
          rk.at(time, worldPos[i]!);
          worldPos[i]!.applyMatrix4(parent.matrixWorld);
        });
        return worldPos.map((pos, i) => ({ pos, size: rocks[i]!.scale }));
      },
      dispose() {
        for (const m of meshes) {
          parent.remove(m);
          m.dispose();
        }
      },
    };
  }

  // ---------- sightings: one mint dot per "visit", fading, for a few tracked objects ----------
  const SIGHT_MAX = 64;
  const sightMat = starMaterial(1, 0);
  sightMat.blending = THREE.AdditiveBlending;
  const sightGeo = new THREE.BufferGeometry();
  const sightPos = new Float32Array(SIGHT_MAX * 3);
  const sightCol = new Float32Array(SIGHT_MAX * 3);
  const sightSize = new Float32Array(SIGHT_MAX);
  sightGeo.setAttribute("position", new THREE.BufferAttribute(sightPos, 3));
  sightGeo.setAttribute("color", new THREE.BufferAttribute(sightCol, 3));
  sightGeo.setAttribute("size", new THREE.BufferAttribute(sightSize, 1));
  sightGeo.setAttribute("phase", new THREE.BufferAttribute(new Float32Array(SIGHT_MAX), 1));
  const sightPts = new THREE.Points(sightGeo, sightMat);
  sightPts.frustumCulled = false;
  scene.add(sightPts);
  const sightings: { pos: THREE.Vector3; t0: number }[] = [];
  const addSighting = (p: THREE.Vector3) => {
    sightings.push({ pos: p.clone(), t0: time });
    if (sightings.length > SIGHT_MAX) sightings.shift();
  };
  const drawSightings = () => {
    sightSize.fill(0);
    sightings.forEach((s, i) => {
      const age = (time - s.t0) / 7;
      const a = Math.max(0, 1 - age);
      sightPos.set([s.pos.x, s.pos.y, s.pos.z], i * 3);
      sightCol.set([MINT.r * a, MINT.g * a, MINT.b * a], i * 3);
      sightSize[i] = 3.2 * Math.max(4, -s.pos.z) / 20;
    });
    for (const k of ["position", "color", "size"]) sightGeo.getAttribute(k).needsUpdate = true;
  };

  // ---------- reticle: corner brackets that lock onto the object nearest the pointer ----------
  const reticle = (() => {
    const k = 0.38;
    const segs: number[] = [];
    // Each corner is two short strokes pointing inward.
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      segs.push(sx, sy, 0, sx * (1 - k), sy, 0, sx, sy, 0, sx, sy * (1 - k), 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(segs, 3));
    const m = new THREE.LineBasicMaterial({ color: MINT, transparent: true, opacity: 0, depthTest: false });
    const l = new THREE.LineSegments(g, m);
    l.renderOrder = 10;
    scene.add(l);
    return { obj: l, mat: m, geo: g, target: null as THREE.Vector3 | null, size: 1, shown: 0, spin: 0 };
  })();

  // ---------- comets: a click on empty background sends one ----------
  const cometTex = glowTexture([
    [0, "rgba(255,255,255,1)"],
    [0.3, "rgba(200,240,255,0.5)"],
    [1, "rgba(156,212,255,0)"],
  ]);
  interface Comet {
    head: THREE.Sprite;
    tail: THREE.Points;
    from: THREE.Vector3;
    vel: THREE.Vector3;
    t0: number;
    life: number;
  }
  const TAIL = 22;
  const tailMat = starMaterial(1, 0);
  const comets: Comet[] = [];
  const launch = (ndcX: number, ndcY: number) => {
    if (comets.length > 4) return;
    const from = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(45).add(camera.position);
    const dir = new THREE.Vector3(ndcX > 0 ? -1 : 1, -0.3 - Math.random() * 0.3, -0.15).normalize();
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: cometTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    head.scale.setScalar(7);
    // The tail: a run of glowing points, brightest and largest at the head.
    const tg = new THREE.BufferGeometry();
    const col: number[] = [];
    const size: number[] = [];
    for (let i = 0; i < TAIL; i++) {
      const k = 1 - i / TAIL;
      col.push(0.75 * k + 0.1, 0.9 * k + 0.05, 1 * k);
      size.push(2 + 8 * k * k);
    }
    tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TAIL * 3), 3));
    tg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    tg.setAttribute("size", new THREE.Float32BufferAttribute(size, 1));
    tg.setAttribute("phase", new THREE.Float32BufferAttribute(new Array(TAIL).fill(0), 1));
    const mat = tailMat.clone();
    mat.uniforms.uDpr!.value = dpr;
    const tail = new THREE.Points(tg, mat);
    tail.frustumCulled = false;
    scene.add(head, tail);
    comets.push({ head, tail, from, vel: dir.multiplyScalar(30), t0: time, life: 2.2 });
  };
  const drawComets = () => {
    for (let i = comets.length - 1; i >= 0; i--) {
      const c = comets[i]!;
      const age = (time - c.t0) / c.life;
      if (age >= 1) {
        scene.remove(c.head, c.tail);
        (c.head.material as THREE.Material).dispose();
        c.tail.geometry.dispose();
        (c.tail.material as THREE.Material).dispose();
        comets.splice(i, 1);
        continue;
      }
      const a = Math.min(1, age * 6) * (1 - age * age);
      const el = age * c.life;
      const p = c.from.clone().addScaledVector(c.vel, el);
      c.head.position.copy(p);
      (c.head.material as THREE.SpriteMaterial).opacity = a;
      const tp = c.tail.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let j = 0; j < TAIL; j++) {
        // The tail trails behind the head along its path (never ahead of where it started).
        const back = Math.min(el, (j / TAIL) * 0.55);
        tp.setXYZ(j, p.x - c.vel.x * back, p.y - c.vel.y * back, p.z - c.vel.z * back);
      }
      tp.needsUpdate = true;
      (c.tail.material as THREE.ShaderMaterial).uniforms.uFade!.value = a;
    }
  };

  // ---------- the three scenes ----------
  const sunGroup = () => {
    const g = new THREE.Group();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(34);
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), new THREE.MeshBasicMaterial({ color: "#fff4cf" }));
    g.add(glow, core);
    return {
      g,
      dispose: () => {
        (glow.material as THREE.Material).dispose();
        core.geometry.dispose();
        (core.material as THREE.Material).dispose();
      },
    };
  };

  /** Objects and pages: a tilted asteroid belt around a distant sun. */
  function buildBelt(): Built {
    const root = new THREE.Group();
    const sun = sunGroup();
    const sunAt = small ? new THREE.Vector3(14, 22, -105) : new THREE.Vector3(46, 16, -100);
    sun.g.position.copy(sunAt);
    root.add(sun.g);
    sunLight.position.copy(sunAt);
    const plane = new THREE.Group();
    plane.position.copy(sunAt);
    plane.rotation.set(1.18, 0.25, -0.38);
    root.add(plane);
    const r = seeded(5);
    const n = small ? 170 : 340;
    const rocks: Rock[] = Array.from({ length: n }, () => {
      const rad = 46 + gauss(r) * 7;
      const a0 = r() * Math.PI * 2;
      const zj = gauss(r) * 1.6;
      const speed = (reduce ? 0 : 0.035) * Math.pow(46 / rad, 1.5);
      const big = r() < 0.06;
      return {
        at: (t, o) => o.set(Math.cos(a0 + t * speed) * rad, Math.sin(a0 + t * speed) * rad, zj),
        scale: big ? 0.9 + r() * 0.8 : 0.18 + r() * 0.45,
        spin: new THREE.Vector3(r() * 0.6, r() * 0.6, r() * 0.3),
        phase: r() * 6,
      };
    });
    // Dust in the belt: many points too small to be rocks.
    const dustMat = starMaterial(dpr, 0);
    const dp: number[] = [];
    const dc: number[] = [];
    const ds: number[] = [];
    for (let i = 0; i < (small ? 900 : 1800); i++) {
      const rad = 46 + gauss(r) * 9;
      const a = r() * Math.PI * 2;
      dp.push(Math.cos(a) * rad, Math.sin(a) * rad, gauss(r) * 2);
      const k = 0.25 + r() * 0.3;
      dc.push(0.75 * k, 0.82 * k, 0.95 * k);
      ds.push(0.9 + r() * 0.8);
    }
    const dust = points(dp, dc, ds, dustMat);
    plane.add(dust);
    // A faint guide ring, like an orbit plotted on a chart.
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 160 }, (_, i) => new THREE.Vector3(Math.cos((i / 160) * 6.283) * 46, Math.sin((i / 160) * 6.283) * 46, 0))),
      new THREE.LineBasicMaterial({ color: COOL, transparent: true, opacity: 0.12 }),
    );
    plane.add(ring);
    const field = rockField(rocks, plane);
    const tracked = [3, 41, 88, 130, 160].filter((i) => i < n);
    let nextSight = 0;
    const tmp = new THREE.Vector3();
    return {
      root,
      update(t) {
        if (!reduce) dust.rotation.z = t * 0.012;
        field.update(t);
        if (!reduce && t > nextSight) {
          nextSight = t + 1.1;
          plane.updateWorldMatrix(true, false);
          for (const i of tracked) {
            rocks[i]!.at(t, tmp);
            addSighting(tmp.applyMatrix4(plane.matrixWorld));
          }
        }
      },
      pickables: () => field.worldPositions(),
      dispose() {
        field.dispose();
        sun.dispose();
        dust.geometry.dispose();
        dustMat.dispose();
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
      },
    };
  }

  /** Explore and sky pages: still stars, a few rocks drifting past, sightings marking each jump. */
  function buildField(): Built {
    const root = new THREE.Group();
    sunLight.position.set(-160, 120, 40);
    const r = seeded(9);
    const n = small ? 26 : 48;
    const rocks: Rock[] = Array.from({ length: n }, () => {
      const z = -22 - r() * 90;
      const span = -z * 1.2;
      const x0 = (r() * 2 - 1) * span;
      const y0 = (r() * 2 - 1) * span * 0.55;
      const vx = (reduce ? 0 : 1) * (0.4 + r() * 1.1) * (r() < 0.5 ? -1 : 1);
      const vy = (reduce ? 0 : 1) * (r() - 0.5) * 0.5;
      return {
        // Drift across and wrap around, so the field never empties.
        at: (t, o) => {
          const x = ((((x0 + vx * t + span) % (2 * span)) + 2 * span) % (2 * span)) - span;
          o.set(x, y0 + vy * t * 0.3, z);
        },
        scale: (0.3 + r() * 0.8) * (-z / 50),
        spin: new THREE.Vector3(r() * 0.5, r() * 0.5, r() * 0.2),
        phase: r() * 6,
      };
    });
    const field = rockField(rocks, root);
    const tracked = [0, 5, 11, 17, 23].filter((i) => i < n);
    let nextSight = 0;
    const tmp = new THREE.Vector3();
    return {
      root,
      update(t) {
        field.update(t);
        if (!reduce && t > nextSight) {
          nextSight = t + 0.9;
          for (const i of tracked) {
            rocks[i]!.at(t, tmp);
            addSighting(tmp);
          }
        }
      },
      pickables: () => field.worldPositions(),
      dispose: () => field.dispose(),
    };
  }

  /** About, limits and the rest: the planets' orbits, an asteroid belt and the Kuiper belt. */
  function buildOrbits(): Built {
    const root = new THREE.Group();
    const sun = sunGroup();
    const center = small ? new THREE.Vector3(6, 16, -105) : new THREE.Vector3(50, 4, -96);
    const sys = new THREE.Group();
    sys.position.copy(center);
    sys.rotation.set(1.12, 0, -0.32);
    sys.scale.setScalar(0.82);
    root.add(sys);
    sun.g.position.copy(center);
    root.add(sun.g);
    sunLight.position.copy(center);

    const PLANETS = [
      { a: 6, size: 0.45, color: "#b9b0a6", period: 8 },
      { a: 9, size: 0.85, color: "#e8cf9a", period: 14 },
      { a: 12.5, size: 0.9, color: "#6fa8ff", period: 20 },
      { a: 16, size: 0.6, color: "#e0805a", period: 30 },
      { a: 30, size: 2.6, color: "#d8b48a", period: 80 },
      { a: 40, size: 2.2, color: "#e6d29c", period: 120, ring: true },
      { a: 50, size: 1.5, color: "#9fe0e8", period: 180 },
      { a: 59, size: 1.45, color: "#5f86ff", period: 240 },
    ];
    const disposables: { dispose: () => void }[] = [];
    const orbitMat = new THREE.LineBasicMaterial({ color: COOL, transparent: true, opacity: 0.2 });
    disposables.push(orbitMat);
    const sphere = new THREE.SphereGeometry(1, 28, 18);
    disposables.push(sphere);
    const r = seeded(3);
    const planets = PLANETS.map((p) => {
      const e = 0.03 + r() * 0.05;
      const b = p.a * Math.sqrt(1 - e * e);
      const off = p.a * e;
      const orbit = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(Array.from({ length: 200 }, (_, i) => new THREE.Vector3(Math.cos((i / 200) * 6.283) * p.a - off, Math.sin((i / 200) * 6.283) * b, 0))),
        orbitMat,
      );
      disposables.push(orbit.geometry);
      sys.add(orbit);
      const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.85, metalness: 0 });
      disposables.push(mat);
      const mesh = new THREE.Mesh(sphere, mat);
      mesh.scale.setScalar(p.size);
      sys.add(mesh);
      if (p.ring) {
        const rg = new THREE.RingGeometry(1.4, 2.3, 48);
        const rm = new THREE.MeshBasicMaterial({ color: "#e6d29c", transparent: true, opacity: 0.45, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(rg, rm);
        ring.rotation.x = 0.5;
        mesh.add(ring);
        disposables.push(rg, rm);
      }
      const phase = r() * Math.PI * 2;
      const speed = reduce ? 0 : (Math.PI * 2) / (p.period * 6);
      return { mesh, at: (t: number, o: THREE.Vector3) => o.set(Math.cos(phase + t * speed) * p.a - off, Math.sin(phase + t * speed) * b, 0), size: p.size };
    });

    // Main belt (rocks) between Mars and Jupiter; Kuiper belt (dust) beyond Neptune.
    const rocks: Rock[] = Array.from({ length: small ? 90 : 170 }, () => {
      const rad = 22 + gauss(r) * 2;
      const a0 = r() * Math.PI * 2;
      const zj = gauss(r) * 0.6;
      const speed = reduce ? 0 : 0.016 * Math.pow(22 / rad, 1.5);
      return {
        at: (t, o) => o.set(Math.cos(a0 + t * speed) * rad, Math.sin(a0 + t * speed) * rad, zj),
        scale: 0.12 + r() * 0.3,
        spin: new THREE.Vector3(r(), r(), r() * 0.3),
        phase: r() * 6,
      };
    });
    const field = rockField(rocks, sys);
    const kMat = starMaterial(dpr, reduce ? 0 : 0.35);
    disposables.push(kMat);
    const kp: number[] = [];
    const kc: number[] = [];
    const ks: number[] = [];
    for (let i = 0; i < (small ? 900 : 1700); i++) {
      const rad = 68 + Math.abs(gauss(r)) * 10;
      const a = r() * Math.PI * 2;
      kp.push(Math.cos(a) * rad, Math.sin(a) * rad, gauss(r) * 3);
      const k = 0.2 + r() * 0.3;
      kc.push(0.7 * k, 0.85 * k, 1 * k);
      ks.push(1 + r() * 0.8);
    }
    const kuiper = points(kp, kc, ks, kMat);
    disposables.push(kuiper.geometry);
    sys.add(kuiper);

    const tmp = new THREE.Vector3();
    let nextSight = 0;
    return {
      root,
      update(t) {
        for (const p of planets) {
          p.at(t, tmp);
          p.mesh.position.copy(tmp);
          p.mesh.rotation.y = t * 0.3;
        }
        if (!reduce) kuiper.rotation.z = t * 0.004;
        field.update(t);
        if (!reduce && t > nextSight) {
          nextSight = t + 1.4;
          sys.updateWorldMatrix(true, false);
          // The outer planets leave sightings, a reminder of how slowly distant things move.
          for (const p of planets.slice(4)) addSighting(p.mesh.getWorldPosition(tmp));
        }
      },
      pickables: () => {
        sys.updateWorldMatrix(true, true);
        return [...planets.map((p) => ({ pos: p.mesh.getWorldPosition(new THREE.Vector3()), size: p.size * 1.2 })), ...field.worldPositions()];
      },
      dispose() {
        field.dispose();
        sun.dispose();
        for (const d of disposables) d.dispose();
      },
    };
  }

  // ---------- input and the frame loop ----------
  let time = 0;
  let built: Built | null = null;
  let variant: BackdropVariant = initial;
  const pointer = { x: -1, y: -1, active: false, lean: 0, tilt: 0, leanT: 0, tiltT: 0 };
  const scroll = { y: window.scrollY, ty: window.scrollY };

  const build = (v: BackdropVariant) => {
    if (built) {
      world.remove(built.root);
      built.dispose();
    }
    sightings.length = 0;
    reticle.target = null;
    built = v === "belt" ? buildBelt() : v === "field" ? buildField() : buildOrbits();
    world.add(built.root);
  };

  const proj = new THREE.Vector3();
  const pickNearest = () => {
    if (!built || !pointer.active) return null;
    let best: { pos: THREE.Vector3; size: number } | null = null;
    let bestD = small ? 60 : 80;
    for (const c of built.pickables()) {
      proj.copy(c.pos).project(camera);
      if (proj.z > 1 || proj.z < -1) continue;
      const sx = (proj.x * 0.5 + 0.5) * w;
      const sy = (-proj.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx - pointer.x, sy - pointer.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };

  let last = performance.now();
  const draw = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!reduce) time += dt;

    pointer.lean += (pointer.leanT - pointer.lean) * 0.05;
    pointer.tilt += (pointer.tiltT - pointer.tilt) * 0.05;
    scroll.y += (scroll.ty - scroll.y) * 0.1;
    const sp = Math.min(4, scroll.y / h);

    // Pointer turns the view; scrolling turns the scene and flies a little way in.
    camera.rotation.set(-pointer.tilt * 0.06, -pointer.lean * 0.1, 0);
    camera.position.set(0, 0, -sp * 5);
    world.rotation.y = sp * 0.07 + (reduce ? 0 : time * 0.004);
    stars.rotation.y = sp * 0.03 + (reduce ? 0 : time * 0.002);
    for (const n of nebulae) n.material.rotation = time * 0.01;
    starMat.uniforms.uTime!.value = time;

    built?.update(time, dt);
    drawSightings();
    drawComets();

    // Reticle: ease toward the nearest object, keep a constant size on screen.
    const hit = pickNearest();
    if (hit) {
      reticle.target = hit.pos.clone();
      reticle.size = hit.size;
    }
    const want = hit ? 1 : 0;
    reticle.shown += (want - reticle.shown) * 0.15;
    if (reticle.target && reticle.shown > 0.01) {
      const dist = reticle.target.distanceTo(camera.position);
      reticle.obj.position.lerp(reticle.target, 0.35);
      reticle.obj.quaternion.copy(camera.quaternion);
      reticle.spin += dt * 0.8;
      reticle.obj.rotateZ(Math.sin(reticle.spin) * 0.08);
      const s = Math.max(reticle.size * 2.2, dist * 0.022) * (1.25 - 0.25 * reticle.shown);
      reticle.obj.scale.setScalar(s);
      reticle.mat.opacity = 0.85 * reticle.shown;
      reticle.obj.visible = true;
    } else {
      reticle.obj.visible = false;
    }

    renderer.render(scene, camera);
  };

  let frame = 0;
  let running = false;
  let lastInput = performance.now();
  let halfRate = false;
  let tick = 0;
  let cost = 0;
  let slowFrames = 0;
  let gaveUp = false;
  const loop = () => {
    if (reduce && performance.now() - lastInput > 1500) {
      running = false;
      draw();
      return;
    }
    frame = requestAnimationFrame(loop);
    if (halfRate && ++tick % 2) return;
    const t0 = performance.now();
    try {
      draw();
    } catch (err) {
      console.warn("[backdrop] frame skipped", err);
    }
    cost = cost * 0.9 + (performance.now() - t0) * 0.1;
    if (!halfRate && cost > 10) halfRate = true;
    // Still too slow at 30 fps: this device can't afford it. Keep the last frame, stop animating.
    if (halfRate && cost > 22 && ++slowFrames > 20) {
      stop();
      gaveUp = true;
    }
  };
  const start = () => {
    if (running || gaveUp || document.hidden) return;
    running = true;
    last = performance.now();
    frame = requestAnimationFrame(loop);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(frame);
  };

  const onMove = (e: PointerEvent) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = e.pointerType === "mouse" || e.pointerType === "pen";
    pointer.leanT = (e.clientX / w) * 2 - 1;
    pointer.tiltT = (e.clientY / h) * 2 - 1;
    lastInput = performance.now();
    start();
  };
  const onLeave = () => {
    pointer.active = false;
    pointer.leanT = 0;
    pointer.tiltT = 0;
  };
  const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role=button],[role=tab],[contenteditable],canvas,img,svg,video";
  const onDown = (e: PointerEvent) => {
    lastInput = performance.now();
    start();
    const t = e.target as Element | null;
    if (t?.closest?.(INTERACTIVE)) return;
    // Only on empty background, not on text someone is selecting.
    if (t && t !== document.body && t.closest("p,li,dd,dt,h1,h2,h3,h4,td,th,pre,code")) return;
    launch((e.clientX / w) * 2 - 1, -(e.clientY / h) * 2 + 1);
  };
  const onScroll = () => {
    scroll.ty = window.scrollY;
    lastInput = performance.now();
    start();
  };
  const onVisibility = () => (document.hidden ? stop() : start());
  const onResize = () => {
    const wasSmall = small;
    resize();
    if (wasSmall !== small) build(variant);
    if (!running) draw();
  };

  resize();
  build(variant);
  draw();
  window.addEventListener("resize", onResize);
  window.addEventListener("pointermove", onMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  start();
  // An occasional comet on its own, so an idle page still has a little life.
  const autoComet = window.setInterval(() => {
    if (!reduce && running && !document.hidden) launch(Math.random() < 0.5 ? -0.9 : 0.9, 0.6 + Math.random() * 0.3);
  }, 11000);

  return {
    setVariant(v) {
      if (v === variant) return;
      variant = v;
      build(v);
      if (!running) draw();
    },
    dispose() {
      stop();
      window.clearInterval(autoComet);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      built?.dispose();
      stars.geometry.dispose();
      starMat.dispose();
      sightGeo.dispose();
      sightMat.dispose();
      reticle.geo.dispose();
      reticle.mat.dispose();
      for (const n of nebulae) n.material.dispose();
      for (const g of rockGeos) g.dispose();
      rockMat.dispose();
      nebulaTex.dispose();
      sunTex.dispose();
      cometTex.dispose();
      tailMat.dispose();
      renderer.dispose();
    },
  };
}
