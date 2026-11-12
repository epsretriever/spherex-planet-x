"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType } from "react";
import type { SkyGlobeProps } from "@/components/three/SkyGlobe";
import { Seen } from "@/components/WhenVisible";
import { getSurvey } from "@/lib/api";
import type { Survey } from "@/lib/contract";
import styles from "./HomeSky.module.css";

/**
 * The searched sky as a slowly turning 3D globe, beside a short note. Nothing loads (neither the
 * survey nor three.js) until the reader scrolls near it; without WebGL the section stays text only.
 */
export function HomeSky({ searched, withObjects }: { searched: number | null; withObjects: number | null }) {
  const [near, setNear] = useState(false);
  const [Globe, setGlobe] = useState<ComponentType<SkyGlobeProps> | null>(null);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!near) return;
    const ctl = new AbortController();
    import("@/components/three/SkyGlobe").then((m) => setGlobe(() => m.default), () => setFailed(true));
    getSurvey(ctl.signal).then(setSurvey, () => setFailed(true));
    return () => ctl.abort();
  }, [near]);

  return (
    <section className={`section ${styles.sky}`} aria-labelledby="home-sky-heading">
      <div className={styles.text}>
        <h2 id="home-sky-heading">Where we&apos;ve looked so far</h2>
        <p>
          {searched != null ? `${searched.toLocaleString("en-US")} patches of sky searched` : "Every patch of sky we've searched"}
          {withObjects != null ? `, ${withObjects.toLocaleString("en-US")} of them with something that moved. ` : ". "}
          Most of the search follows the ecliptic, the band where the planets travel and where a distant planet would most likely be.
        </p>
        <p>
          <Link href="/sky/">Turn the globe yourself on the sky map</Link>
        </p>
      </div>
      <div className={styles.globe} aria-hidden={!Globe || !survey}>
        {!near && <Seen onSeen={() => setNear(true)} margin="300px" />}
        {Globe && survey && !failed ? (
          <Globe
            tiles={survey.tiles}
            emptyCells={survey.empty_cells?.positions}
            planetNine={null}
            tileName={(t) => t.tile_id}
            onFail={() => setFailed(true)}
            compact
          />
        ) : (
          <div className={styles.placeholder} />
        )}
      </div>
    </section>
  );
}
