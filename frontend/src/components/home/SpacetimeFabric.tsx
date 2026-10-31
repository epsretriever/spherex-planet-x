"use client";

import { useEffect, useRef } from "react";
import styles from "./SpacetimeFabric.module.css";

/** A gravity well: a dip in the fabric at a screen position. */
interface Well {
  x: number;
  y: number;
  mass: number;
}

const COLS = 46;
const ROWS = 24;

/**
 * Decorative hero background: a perspective grid ("spacetime fabric") that dips into gravity
 * wells around a central star, an orbiting planet and the reader's pointer, over a field of stars.
 *
 * It starts once the page is idle (never competing with the first paint), pauses while off screen
 * or in a background tab, and draws one still frame for readers who prefer reduced motion.
 */
export function SpacetimeFabric() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0;
    let h = 0;
    let stars: { x: number; y: number; r: number; a: number; tw: number }[] = [];

    // Pointer, eased toward its target so the dip glides instead of jumping.
    const pointer = { x: -1, y: -1, tx: -1, ty: -1, strength: 0, target: 0 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Deterministic star field, denser on wide screens.
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      stars = Array.from({ length: Math.round((w * h) / 2600) }, () => ({
        x: rand() * w,
        y: rand() * h,
        r: rand() < 0.08 ? 1.4 : 0.5 + rand() * 0.7,
        a: 0.25 + rand() * 0.6,
        tw: rand() * Math.PI * 2,
      }));
    };

    /** The fabric lies on a plane tilted away from the viewer; returns screen x, y and depth (0 far, 1 near). */
    const project = (u: number, v: number) => {
      // u in [-1, 1] across, v in [0, 1] from far to near.
      const depth = 0.32 + 0.68 * v;
      const x = w / 2 + u * w * 0.95 * depth;
      const y = h * 0.34 + Math.pow(v, 1.35) * h * 0.78;
      return { x, y, depth };
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);

      // Stars, with a slow twinkle.
      ctx.fillStyle = "rgb(243, 238, 249)";
      for (const s of stars) {
        ctx.globalAlpha = reduce ? s.a : s.a * (0.75 + 0.25 * Math.sin(t * 0.0012 + s.tw));
        ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
      }
      ctx.globalAlpha = 1;

      // Wells: a star near the right, a planet orbiting it, and the pointer.
      const star = project(0.42, 0.42);
      const orbitR = Math.min(w, h) * 0.22;
      const ang = reduce ? 2.2 : t * 0.00025;
      const wells: Well[] = [
        { x: star.x, y: star.y, mass: 1.0 },
        { x: star.x + Math.cos(ang) * orbitR * 1.35, y: star.y + Math.sin(ang) * orbitR * 0.42, mass: 0.35 },
      ];
      if (pointer.strength > 0.01) wells.push({ x: pointer.x, y: pointer.y, mass: 0.9 * pointer.strength });

      const reach = Math.min(w, h) * 0.32;
      const warp = (p: { x: number; y: number; depth: number }) => {
        let dx = 0;
        let dy = 0;
        let dip = 0;
        for (const g of wells) {
          const ex = g.x - p.x;
          const ey = g.y - p.y;
          const d2 = ex * ex + ey * ey;
          const f = g.mass * Math.exp(-d2 / (reach * reach * 0.35));
          // Pull toward the mass and sink below it: the fabric stretches into a funnel.
          dx += ex * f * 0.38;
          dy += ey * f * 0.38;
          dip += f;
        }
        return { x: p.x + dx, y: p.y + dy + dip * reach * 0.42 * p.depth, depth: p.depth, dip };
      };

      // Precompute the warped grid.
      const pts: { x: number; y: number; depth: number; dip: number }[][] = [];
      for (let j = 0; j <= ROWS; j++) {
        const row: { x: number; y: number; depth: number; dip: number }[] = [];
        for (let i = 0; i <= COLS; i++) row.push(warp(project(-1 + (2 * i) / COLS, j / ROWS)));
        pts.push(row);
      }

      // Batch the ~2,000 grid segments into a few colour buckets: one stroke per bucket per frame.
      const GLOW = 4;
      const DEPTH = 4;
      const buckets: Path2D[] = Array.from({ length: (GLOW + 1) * (DEPTH + 1) }, () => new Path2D());
      const bucketOf = (a: { depth: number; dip: number }) =>
        Math.round(Math.min(1, a.dip * 1.4) * GLOW) * (DEPTH + 1) + Math.round(((a.depth - 0.32) / 0.68) * DEPTH);
      const seg = (a: { x: number; y: number; depth: number; dip: number }, b: { x: number; y: number }) => {
        const path = buckets[bucketOf(a)]!;
        path.moveTo(a.x, a.y);
        path.lineTo(b.x, b.y);
      };
      for (let j = 0; j <= ROWS; j++) for (let i = 0; i < COLS; i++) seg(pts[j]![i]!, pts[j]![i + 1]!);
      for (let i = 0; i <= COLS; i++) for (let j = 0; j < ROWS; j++) seg(pts[j]![i]!, pts[j + 1]![i]!);
      ctx.lineWidth = 1;
      buckets.forEach((path, k) => {
        // Far lines fade into violet; lines in a well glow ember.
        const glow = Math.floor(k / (DEPTH + 1)) / GLOW;
        const depth = 0.32 + 0.68 * ((k % (DEPTH + 1)) / DEPTH);
        const alpha = Math.min(0.85, (0.08 + 0.42 * depth) * (0.75 + 0.6 * glow));
        const r = Math.round(124 + (255 - 124) * glow);
        const g = Math.round(96 + (138 - 96) * glow);
        const b = Math.round(220 + (76 - 220) * glow);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        ctx.stroke(path);
      });

      // The star and the planet, sitting in their wells.
      const sw = warp({ ...star, depth: 0.32 + 0.68 * 0.42 });
      const halo = ctx.createRadialGradient(sw.x, sw.y, 0, sw.x, sw.y, reach * 0.5);
      halo.addColorStop(0, "rgba(247, 209, 61, 0.55)");
      halo.addColorStop(0.25, "rgba(251, 155, 6, 0.22)");
      halo.addColorStop(1, "rgba(207, 68, 70, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, reach * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff4cf";
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, 5, 0, Math.PI * 2);
      ctx.fill();

      const pl = wells[1]!;
      const pw = warp({ x: pl.x, y: pl.y, depth: 0.6 });
      ctx.fillStyle = "#7cc4ff";
      ctx.beginPath();
      ctx.arc(pw.x, pw.y, 3.2, 0, Math.PI * 2);
      ctx.fill();

      if (pointer.strength > 0.01) {
        const glow = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 60);
        glow.addColorStop(0, `rgba(255, 138, 76, ${(0.28 * pointer.strength).toFixed(3)})`);
        glow.addColorStop(1, "rgba(255, 138, 76, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, 60, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    let frame = 0;
    let running = false;
    let visible = true;
    const loop = (t: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.12;
      pointer.y += (pointer.ty - pointer.y) * 0.12;
      pointer.strength += (pointer.target - pointer.strength) * 0.06;
      draw(t);
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || reduce || !visible || document.hidden) return;
      running = true;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    // Pointer anywhere over the hero (the canvas itself ignores events so links stay clickable).
    const host = canvas.parentElement ?? canvas;
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.tx = e.clientX - r.left;
      pointer.ty = e.clientY - r.top;
      if (pointer.x < 0) {
        pointer.x = pointer.tx;
        pointer.y = pointer.ty;
      }
      pointer.target = 1;
    };
    const onLeave = () => {
      pointer.target = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    resize();
    draw(0);
    const ro = new ResizeObserver(() => {
      resize();
      if (!running) draw(performance.now());
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(canvas);
    if (!reduce) {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
    }
    document.addEventListener("visibilitychange", onVisibility);

    // Begin animating once the page is idle, so the first paint never waits on it.
    const w8 = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const idle = w8.requestIdleCallback ? w8.requestIdleCallback(start, { timeout: 1500 }) : window.setTimeout(start, 600);

    return () => {
      stop();
      if (w8.cancelIdleCallback) w8.cancelIdleCallback(idle);
      else clearTimeout(idle);
      ro.disconnect();
      io.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className={styles.canvas} aria-hidden="true" />;
}
