"use client";

import { useId, useState } from "react";
import styles from "./Term.module.css";

export const GLOSSARY: Record<string, string> = {
  arcsec: "An arcsecond is a tiny angle on the sky: 1/3600 of a degree. The full Moon is about 1,800 arcseconds wide.",
  snr: "Signal-to-noise ratio: how far a source stands out above the random noise in the image. Above about 5 is a solid detection.",
  mjd: "Modified Julian Date: a running day count astronomers use so time differences are easy to compute.",
  "position angle": "The direction of motion on the sky, in degrees measured from north toward east.",
  ecliptic: "The path the Sun, Moon and planets follow across our sky. Most asteroids are found near it.",
  epoch: "One observation: a single SPHEREx exposure of this patch of sky at a particular time.",
  µjy: "Microjansky, a unit of brightness for faint sources. Bigger is brighter.",
  wavelength: "The color of infrared light, measured in microns (µm). SPHEREx sees from 0.75 to 5 µm, all invisible to our eyes.",
  "rule-based score": "A 0 to 1 ranking built from fixed rules about motion, signal strength and artifact checks. It is not a probability.",
};

/** A term with a plain-language definition on hover, focus or tap. */
export function Term({ term, children }: { term: keyof typeof GLOSSARY | string; children?: React.ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const text = GLOSSARY[term.toLowerCase()];
  if (!text) return <>{children ?? term}</>;
  return (
    <span className={styles.wrap} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className={styles.term}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      >
        {children ?? term}
      </button>
      {open && (
        <span role="tooltip" id={id} className={styles.tip}>
          {text}
        </span>
      )}
    </span>
  );
}
