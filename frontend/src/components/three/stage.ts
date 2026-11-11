import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** CSS custom property as a three.js colour, so every scene follows the site palette. */
export function cssColor(name: string, fallback: string): THREE.Color {
  const v = typeof window === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try {
    return new THREE.Color(v || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

/** Whether this browser can start WebGL, asked quietly (three.js logs an error when it can't). */
export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

export interface StageOptions {
  /** Rough radius of the content, in scene units: sets the camera range and zoom limits. */
  reach: number;
  /** Camera position, in units of `reach`. */
  camera?: [number, number, number];
  fov?: number;
  /** Turn slowly until the reader touches it (never with reduced motion). */
  spin?: boolean;
  minDistance?: number;
  maxDistance?: number;
  /** Tag class from the caller's CSS module. */
  tagClass: string;
}

export interface Tag {
  el: HTMLSpanElement;
  pos: THREE.Vector3;
  /** Extra visibility test (for example: on the near side of a globe). */
  shown?: (camera: THREE.PerspectiveCamera) => boolean;
}

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
  /** Track something to dispose with the stage (materials, shared geometries). */
  keep<T extends { dispose: () => void }>(x: T): T;
  /** An HTML label that follows a point in the scene. */
  tag(text: string, pos: THREE.Vector3, kind: string, shown?: Tag["shown"]): Tag;
  /** The index of the point nearest the pointer within `radiusPx`, or -1. */
  pick(points: THREE.Vector3[], clientX: number, clientY: number, radiusPx?: number, shown?: (i: number) => boolean): number;
  /** Ask for a redraw (the stage draws only when something changed). */
  invalidate(): void;
  reset(): void;
  dispose(): void;
}

/**
 * One WebGL scene in `host`, with drag-to-turn controls, HTML labels and on-demand rendering:
 * frames are drawn only while the view is changing and the figure is on screen, so a 3D figure
 * further down a page costs nothing until the reader reaches it. Returns null when WebGL cannot
 * start; the caller then shows its flat fallback.
 */
export function createStage(host: HTMLElement, labelLayer: HTMLElement, opts: StageOptions): Stage | null {
  if (!hasWebGL()) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  host.prepend(canvas);

  const { reach } = opts;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 40, 1, reach / 200, reach * 40);
  const home = new THREE.Vector3(...(opts.camera ?? [0, 1.25, 1.6])).multiplyScalar(reach);
  camera.position.copy(home);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = opts.minDistance ?? reach * 0.15;
  controls.maxDistance = opts.maxDistance ?? reach * 6;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotate = (opts.spin ?? true) && !reduce;
  controls.autoRotateSpeed = 0.4;

  const kept: { dispose: () => void }[] = [];
  const tags: Tag[] = [];
  let onScreen = true;
  let dirty = true;
  let frames = 0;

  const draw = () => {
    // Damping and auto-rotation need a few more frames after the last change.
    const moved = controls.update();
    if (!onScreen || (!dirty && !moved && frames <= 0)) return;
    frames = dirty || moved ? 30 : frames - 1;
    dirty = false;
    renderer.render(scene, camera);
    const w = host.clientWidth;
    const h = host.clientHeight;
    const v = new THREE.Vector3();
    for (const t of tags) {
      v.copy(t.pos).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05 && (t.shown ? t.shown(camera) : true);
      t.el.style.display = visible ? "" : "none";
      if (visible) t.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
    }
  };
  renderer.setAnimationLoop(draw);

  const stopSpin = () => {
    controls.autoRotate = false;
  };
  canvas.addEventListener("pointerdown", stopSpin);
  const invalidate = () => {
    dirty = true;
  };
  controls.addEventListener("change", invalidate);

  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const io =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
          onScreen = entries.some((e) => e.isIntersecting);
          if (onScreen) dirty = true;
        });
  io?.observe(host);

  const proj = new THREE.Vector3();
  return {
    scene,
    camera,
    controls,
    canvas,
    keep(x) {
      kept.push(x);
      return x;
    },
    tag(text, pos, kind, shown) {
      const el = document.createElement("span");
      el.textContent = text;
      el.className = opts.tagClass;
      el.dataset.kind = kind;
      labelLayer.appendChild(el);
      const t: Tag = { el, pos, shown };
      tags.push(t);
      dirty = true;
      return t;
    },
    pick(points, clientX, clientY, radiusPx = 14, shown) {
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      let best = -1;
      let bestD = radiusPx * radiusPx;
      for (let i = 0; i < points.length; i++) {
        if (shown && !shown(i)) continue;
        proj.copy(points[i]!).project(camera);
        if (proj.z >= 1) continue;
        const dx = ((proj.x + 1) / 2) * rect.width - px;
        const dy = ((1 - proj.y) / 2) * rect.height - py;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    invalidate,
    reset() {
      camera.position.copy(home);
      controls.target.set(0, 0, 0);
      controls.update();
      dirty = true;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io?.disconnect();
      canvas.removeEventListener("pointerdown", stopSpin);
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Line || o instanceof THREE.Points || o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.Material | THREE.Material[];
          (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
        }
      });
      kept.forEach((d) => d.dispose());
      renderer.dispose();
      canvas.remove();
      tags.forEach((t) => t.el.remove());
    },
  };
}
