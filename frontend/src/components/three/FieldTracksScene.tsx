"use client";

import * as THREE from "three";
import type { FieldTracks } from "@/lib/fieldTracks";
import { formatUtcShortDate } from "@/lib/format";
import { Stage3D } from "./Stage3D";
import { cssColor, type Stage } from "./stage";

export interface FieldTracksProps {
  data: FieldTracks;
  onFail: () => void;
}

/** Sky x → scene x, time → up, sky y (north) → away from the viewer. */
const at = (x: number, y: number, t: number) => new THREE.Vector3(x, t * 2 - 1, -y);
const square = (t: number) => [at(-1, -1, t), at(1, -1, t), at(1, 1, t), at(-1, 1, t), at(-1, -1, t)];

/**
 * A patch of sky with time running upward: each SPHEREx visit is a faint frame, a star would be
 * a vertical line, and every moving object is a line that leans across the stack.
 */
export default function FieldTracksScene({ data, onFail }: FieldTracksProps) {
  const build = (stage: Stage) => {
    const { scene } = stage;
    const accent = cssColor("--accent", "#ff8a4c");
    const muted = cssColor("--text-muted", "#aa9fbd");
    const cool = cssColor("--cool", "#7cc4ff");
    const line = (pts: THREE.Vector3[], mat: THREE.Material) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);

    const frame = stage.keep(new THREE.LineBasicMaterial({ color: muted, transparent: true, opacity: 0.6 }));
    const faint = stage.keep(new THREE.LineBasicMaterial({ color: muted, transparent: true, opacity: 0.16 }));
    scene.add(line(square(0), frame), line(square(1), frame));
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) scene.add(line([at(x, y, 0), at(x, y, 1)], faint));
    // At most 40 visit frames: enough to show the cadence without filling the box.
    const step = Math.max(1, Math.ceil(data.visits.length / 40));
    data.visits.forEach((t, i) => {
      if (i % step === 0 && t > 0.01 && t < 0.99) scene.add(line(square(t), faint));
    });

    // What standing still looks like.
    const star = line([at(0.8, -0.8, 0), at(0.8, -0.8, 1)], stage.keep(new THREE.LineDashedMaterial({ color: muted, dashSize: 0.06, gapSize: 0.05 })));
    star.computeLineDistances();
    scene.add(star);
    stage.tag("A star would stay put", at(0.8, -0.8, 0.5), "plain");

    const dotGeo = stage.keep(new THREE.SphereGeometry(0.022, 10, 8));
    for (const tr of data.tracks) {
      const color = tr.simulated ? cool : accent;
      const pts = tr.pts.map((p) => at(p.x, p.y, p.t));
      scene.add(line(pts, stage.keep(new THREE.LineBasicMaterial({ color }))));
      // Its path on the sky alone, drawn on the floor.
      scene.add(line(tr.pts.map((p) => at(p.x, p.y, 0)), stage.keep(new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }))));
      const dotMat = stage.keep(new THREE.MeshBasicMaterial({ color }));
      for (const p of pts) {
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.copy(p);
        scene.add(dot);
      }
      stage.tag(tr.simulated ? `${tr.name} (SIMULATED)` : tr.name, pts.at(-1)!, tr.simulated ? "cool" : "accent");
    }

    stage.tag(`${formatUtcShortDate(data.firstUtc)}: first image`, at(-1, -1, 0), "plain");
    stage.tag(`${formatUtcShortDate(data.lastUtc)}: last image`, at(-1, -1, 1), "plain");
    stage.tag("North", at(0, 1.08, 0), "plain");
    stage.tag("East", at(-1.12, 0, 0), "plain");
  };

  return <Stage3D options={{ reach: 1.5, camera: [1.9, 1.2, 2.9], minDistance: 1.6, maxDistance: 9 }} build={build} deps={[data]} onFail={onFail} />;
}
