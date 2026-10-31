"use client";

import { useEffect, useRef } from "react";
import styles from "./SpacetimeFabric.module.css";

/** A gravity well: a dip in the fabric at a screen position. */
interface Well {
  x: number;
  y: number;
  mass: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  tw: number;
  /** 0 far … 1 near: nearer stars drift more with scroll and the pointer. */
  layer: number;
}

interface Ripple {
  x: number;
  y: number;
  t0: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t0: number;
  life: number;
}

/** Planets around the fabric's star: orbit size (× base), angular speed, mass, look. */
const PLANETS = [
  { r: 0.45, speed: 2.4, phase: 0.6, mass: 0.18, size: 2.6, color: "#c3a6ff" },
  { r: 0.8, speed: 1.5, phase: 2.2, mass: 0.28, size: 3.4, color: "#7cc4ff" },
  { r: 1.2, speed: 0.95, phase: 4.1, mass: 0.42, size: 4.6, color: "#ffb07a" },
  { r: 1.75, speed: 0.6, phase: 5.3, mass: 0.32, size: 3.8, color: "#7cf0c8" },
];

type Pt = { x: number; y: number; depth: number; dip: number };

const GLOW = 4;
const DEPTH = 4;

/**
 * The home page's backdrop: a perspective grid ("spacetime fabric") over three depths of stars.
 * - Pointer: the fabric dips into a well under the pointer, the grid leans toward it and the
 *   star layers shift with parallax. A click or tap sends a ripple through the fabric.
 * - Scroll: you fly forward over the grid, the view pitches toward the horizon, the star layers
 *   drift at their own depths, the planet's orbit advances, and the grid dims behind the content.
 * - Now and then a shooting star crosses the sky.
 *
 * Fixed behind the page, it starts only after the page has loaded and gone idle, pauses in
 * background tabs and never takes clicks. With reduced motion it has no motion of its own (no
 * orbiting, twinkling or shooting stars) and only follows the reader's pointer, clicks and scroll.
 */
export function SpacetimeFabric() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dpr = 1;
    let w = 0;
    let h = 0;
    let stars: Star[] = [];
    // Grid density follows the screen: phones get fewer, larger cells (and far less work).
    let COLS = 46;
    let ROWS = 26;
    const ripples: Ripple[] = [];
    const meteors: Meteor[] = [];
    let nextMeteor = 3000;

    // Pointer and scroll, eased toward their targets so everything glides.
    const pointer = { x: -1, y: -1, tx: -1, ty: -1, strength: 0, target: 0, lean: 0, leanT: 0, tilt: 0, tiltT: 0 };
    const scroll = { y: window.scrollY, ty: window.scrollY };

    const resize = () => {
      w = Math.max(1, window.innerWidth);
      h = Math.max(1, window.innerHeight);
      // Cap the canvas at about 1.3 megapixels: it's a soft backdrop, and fill rate is what
      // limits the frame rate on large or high-density screens.
      dpr = Math.min(window.devicePixelRatio || 1, 1, Math.sqrt(1.3e6 / (w * h)));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      COLS = Math.max(22, Math.min(46, Math.round(w / 28)));
      ROWS = Math.round(COLS * 0.56);
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      stars = Array.from({ length: Math.round((w * h) / 3600) }, () => {
        const layer = rand();
        return { x: rand() * w, y: rand() * h, r: layer > 0.93 ? 1.5 : 0.45 + layer * 0.85, a: 0.25 + rand() * 0.6, tw: rand() * Math.PI * 2, layer };
      });
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      // Scroll position in screens; the fabric dims as content takes over.
      const sp = scroll.y / h;
      const fade = Math.max(0.32, 1 - sp * 0.55);

      // Stars at three depths: scroll and the pointer move the near ones more.
      const px = pointer.lean * 22;
      const py = pointer.tilt * 14;
      ctx.fillStyle = "rgb(243, 238, 249)";
      for (const s of stars) {
        const k = 0.15 + s.layer * 0.85;
        const x = (((s.x - px * k) % w) + w) % w;
        const y = (((s.y - scroll.y * 0.2 * k - py * k) % h) + h) % h;
        ctx.globalAlpha = reduce ? s.a : s.a * (0.72 + 0.28 * Math.sin(t * 0.0012 + s.tw));
        ctx.fillRect(x - s.r, y - s.r, s.r * 2, s.r * 2);
      }
      ctx.globalAlpha = 1;

      // Shooting stars.
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i]!;
        const age = (t - m.t0) / m.life;
        if (age >= 1) {
          meteors.splice(i, 1);
          continue;
        }
        const x = m.x + m.vx * age;
        const y = m.y + m.vy * age;
        const tx = x - m.vx * 0.2;
        const ty = y - m.vy * 0.2;
        const tail = ctx.createLinearGradient(x, y, tx, ty);
        tail.addColorStop(0, `rgba(255, 240, 220, ${(0.9 * Math.sin(age * Math.PI)).toFixed(3)})`);
        tail.addColorStop(1, "rgba(255, 138, 76, 0)");
        ctx.strokeStyle = tail;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }

      // The fabric: a plane tilted away from the viewer. Scrolling flies forward over it (rows
      // stream toward you) and pitches the view toward the horizon; the pointer leans it.
      const horizon = h * (0.36 - Math.min(0.2, sp * 0.12)) + py;
      const flow = (scroll.y * 0.0016 + (reduce ? 0 : t * 0.000015)) % (1 / ROWS);
      const lean = pointer.lean * 0.2;
      const project = (u: number, v: number) => {
        const depth = 0.3 + 0.7 * v;
        return {
          x: w / 2 + (u + lean * (1 - v)) * w * 0.95 * depth,
          y: horizon + Math.pow(v, 1.35) * (h - horizon + h * 0.14),
          depth,
        };
      };

      // Wells: a star, a planet orbiting it (scrolling advances the orbit), and the pointer.
      // On narrow screens the star sits lower, under the hero text rather than behind it.
      const narrow = w < 700;
      const star = project((narrow ? 0.3 : 0.42) - Math.min(0.5, sp * 0.25), narrow ? 0.78 : 0.42);
      const orbitR = Math.min(w, h) * 0.22;
      const spin = (reduce ? 0 : t * 0.00025) + scroll.y * 0.004;
      // Planets on nested orbits (flattened ellipses on the fabric), each with its own well.
      const planets = PLANETS.map((p) => {
        const a = p.phase + spin * p.speed;
        return { x: star.x + Math.cos(a) * orbitR * p.r * 1.35, y: star.y + Math.sin(a) * orbitR * p.r * 0.42, mass: p.mass, p };
      });
      const wells: Well[] = [{ x: star.x, y: star.y, mass: 1.0 }, ...planets];
      if (pointer.strength > 0.01) wells.push({ x: pointer.x, y: pointer.y, mass: 1.9 * pointer.strength });

      const reach = Math.min(w, h) * 0.32;
      const warp = (p: { x: number; y: number; depth: number }): Pt => {
        let dx = 0;
        let dy = 0;
        let dip = 0;
        for (const g of wells) {
          const ex = g.x - p.x;
          const ey = g.y - p.y;
          const f = g.mass * Math.exp(-(ex * ex + ey * ey) / (reach * reach * 0.35));
          // Pull toward the mass and sink below it: the fabric stretches into a funnel.
          dx += ex * f * 0.38;
          dy += ey * f * 0.38;
          dip += f;
        }
        // Ripples: a ring that travels outward and fades.
        for (const r of ripples) {
          const age = (t - r.t0) / 1000;
          const band = Math.hypot(p.x - r.x, p.y - r.y) - age * 520;
          if (age > 0 && Math.abs(band) < 90) {
            const amp = Math.cos((band / 90) * Math.PI * 0.5) * Math.max(0, 1 - age / 2.2);
            dy += amp * 40 * p.depth;
            dip += amp * 0.6;
          }
        }
        return { x: p.x + dx, y: p.y + dy + dip * reach * 0.42 * p.depth, depth: p.depth, dip };
      };

      const pts: Pt[][] = [];
      for (let j = 0; j <= ROWS; j++) {
        const v = Math.min(1, j / ROWS + flow);
        const row: Pt[] = [];
        for (let i = 0; i <= COLS; i++) row.push(warp(project(-1 + (2 * i) / COLS, v)));
        pts.push(row);
      }

      // Batch the ~2,000 segments into colour buckets: one stroke per bucket per frame.
      const buckets: Path2D[] = Array.from({ length: (GLOW + 1) * (DEPTH + 1) }, () => new Path2D());
      const seg = (a: Pt, b: Pt) => {
        const k = Math.round(Math.min(1, a.dip * 1.4) * GLOW) * (DEPTH + 1) + Math.round(((a.depth - 0.3) / 0.7) * DEPTH);
        const path = buckets[Math.max(0, Math.min(buckets.length - 1, k))]!;
        path.moveTo(a.x, a.y);
        path.lineTo(b.x, b.y);
      };
      for (let j = 0; j <= ROWS; j++) for (let i = 0; i < COLS; i++) seg(pts[j]![i]!, pts[j]![i + 1]!);
      for (let i = 0; i <= COLS; i++) for (let j = 0; j < ROWS; j++) seg(pts[j]![i]!, pts[j + 1]![i]!);
      ctx.lineWidth = 1;
      buckets.forEach((path, k) => {
        // Far lines fade into violet; lines in a well glow ember.
        const glow = Math.floor(k / (DEPTH + 1)) / GLOW;
        const depth = 0.3 + 0.7 * ((k % (DEPTH + 1)) / DEPTH);
        const alpha = Math.min(0.85, (0.08 + 0.42 * depth) * (0.75 + 0.6 * glow)) * fade;
        const r = Math.round(124 + (255 - 124) * glow);
        const g = Math.round(96 + (138 - 96) * glow);
        const b = Math.round(220 + (76 - 220) * glow);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        ctx.stroke(path);
      });

      // Each ripple's wavefront as a glowing ring, flattened to lie on the fabric.
      for (const r of ripples) {
        const age = (t - r.t0) / 1000;
        const a = Math.max(0, 1 - age / 2.2);
        // A click can land a moment after this frame's timestamp: nothing to draw yet.
        if (age <= 0 || a <= 0) continue;
        const rad = age * 520;
        ctx.strokeStyle = `rgba(255, 176, 122, ${(0.55 * a).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, rad, rad * 0.45, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.lineWidth = 1;

      // The star and the planet, sitting in their wells.
      const sw = warp(star);
      const halo = ctx.createRadialGradient(sw.x, sw.y, 0, sw.x, sw.y, reach * 0.5);
      halo.addColorStop(0, `rgba(247, 209, 61, ${(0.55 * fade).toFixed(3)})`);
      halo.addColorStop(0.25, `rgba(251, 155, 6, ${(0.22 * fade).toFixed(3)})`);
      halo.addColorStop(1, "rgba(207, 68, 70, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, reach * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff4cf";
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, 5, 0, Math.PI * 2);
      ctx.fill();

      for (const pl of planets) {
        // Faint orbit path, then the planet in its own dip.
        ctx.strokeStyle = `rgba(170, 159, 189, ${(0.18 * fade).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(sw.x, sw.y, orbitR * pl.p.r * 1.35, orbitR * pl.p.r * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
        const pw = warp({ x: pl.x, y: pl.y, depth: 0.6 });
        ctx.fillStyle = pl.p.color;
        ctx.beginPath();
        ctx.arc(pw.x, pw.y, pl.p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      if (pointer.strength > 0.01) {
        const glow = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 70);
        glow.addColorStop(0, `rgba(255, 138, 76, ${(0.45 * pointer.strength).toFixed(3)})`);
        glow.addColorStop(1, "rgba(255, 138, 76, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, 70, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    let frame = 0;
    let running = false;
    let tick = 0;
    let cost = 0;
    let halfRate = false;
    let lastInput = 0;
    const loop = (t: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.12;
      pointer.y += (pointer.ty - pointer.y) * 0.12;
      pointer.strength += (pointer.target - pointer.strength) * 0.06;
      pointer.lean += (pointer.leanT - pointer.lean) * 0.05;
      pointer.tilt += (pointer.tiltT - pointer.tilt) * 0.05;
      scroll.y += (scroll.ty - scroll.y) * 0.12;
      for (let i = ripples.length - 1; i >= 0; i--) if (t - ripples[i]!.t0 > 2200) ripples.splice(i, 1);
      if (!reduce && t > nextMeteor) {
        const fromLeft = Math.random() < 0.5;
        meteors.push({
          x: fromLeft ? Math.random() * w * 0.5 : w * (0.5 + Math.random() * 0.5),
          y: Math.random() * h * 0.35,
          vx: (fromLeft ? 1 : -1) * w * (0.25 + Math.random() * 0.2),
          vy: h * (0.12 + Math.random() * 0.1),
          t0: t,
          life: 900 + Math.random() * 500,
        });
        nextMeteor = t + 3500 + Math.random() * 5500;
      }
      // Reduced motion: no motion of its own, so stop once the reader stops interacting.
      if (reduce && performance.now() - lastInput > 1500) {
        running = false;
        draw(t);
        return;
      }
      // Schedule the next frame first: one bad frame must never freeze the backdrop.
      frame = requestAnimationFrame(loop);
      // On a slow device, draw every other frame (30 fps) rather than block the page.
      if (halfRate && ++tick % 2) return;
      const t0 = performance.now();
      try {
        draw(t);
      } catch (err) {
        console.warn("[spacetime] frame skipped", err);
      }
      cost = cost * 0.9 + (performance.now() - t0) * 0.1;
      if (!halfRate && cost > 9) halfRate = true;
    };
    const start = () => {
      if (running || document.hidden) return;
      running = true;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      pointer.tx = e.clientX;
      pointer.ty = e.clientY;
      if (pointer.x < 0) {
        pointer.x = pointer.tx;
        pointer.y = pointer.ty;
      }
      pointer.target = 1;
      lastInput = performance.now();
      start();
      pointer.leanT = (e.clientX / w) * 2 - 1;
      pointer.tiltT = (e.clientY / h) * 2 - 1;
    };
    const onLeave = () => {
      pointer.target = 0;
      pointer.leanT = 0;
      pointer.tiltT = 0;
    };
    const onDown = (e: PointerEvent) => {
      if (ripples.length < 6) ripples.push({ x: e.clientX, y: e.clientY, t0: performance.now() });
      lastInput = performance.now();
      start();
    };
    const onScroll = () => {
      scroll.ty = window.scrollY;
      lastInput = performance.now();
      start();
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const onResize = () => {
      resize();
      if (!running) draw(performance.now());
    };

    resize();
    draw(0);
    window.addEventListener("resize", onResize);
    // Always follow the reader's own input; with reduced motion that's the only thing that moves it.
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    // Begin animating only after the page has loaded and gone idle, so neither the first paint
    // nor the content's own loading competes with the animation.
    const win = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    let idle = 0;
    const whenIdle = () => {
      idle = win.requestIdleCallback ? win.requestIdleCallback(start, { timeout: 1200 }) : window.setTimeout(start, 800);
    };
    if (document.readyState === "complete") whenIdle();
    else window.addEventListener("load", whenIdle, { once: true });
    // The reader is here: start at once rather than wait for idle.
    const kick = () => start();
    window.addEventListener("pointermove", kick, { once: true, passive: true });
    window.addEventListener("scroll", kick, { once: true, passive: true });
    window.addEventListener("pointerdown", kick, { once: true, passive: true });

    return () => {
      window.removeEventListener("load", whenIdle);
      window.removeEventListener("pointermove", kick);
      window.removeEventListener("scroll", kick);
      window.removeEventListener("pointerdown", kick);
      stop();
      if (win.cancelIdleCallback) win.cancelIdleCallback(idle);
      else clearTimeout(idle);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className={styles.canvas} aria-hidden="true" data-fabric="" />;
}
