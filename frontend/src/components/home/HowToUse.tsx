"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./HowToUse.module.css";

const KEY = "spx-howto-hidden";

const STEPS = [
  {
    title: "Watch something move",
    body: "Open a patch of sky and press Blink: stars hold still, moving objects jump.",
    href: "/objects/?view=patches",
    cta: "Pick a patch",
  },
  {
    title: "Read the evidence",
    body: "Every object has one report: is it a known asteroid, and could it be a glitch?",
    href: "/objects/",
    cta: "Browse objects",
  },
  {
    title: "See what's still unexplained",
    body: "The objects JPL can't explain, ranked, and where in the sky we haven't looked yet.",
    href: "/objects/?view=leads",
    cta: "Unexplained leads",
  },
];

/** A first-visit guide: three steps with links. Dismissing it is remembered in this browser. */
export function HowToUse() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(KEY) === "1";
    } catch {
      /* storage blocked: keep showing it */
    }
    if (!dismissed) return;
    const t = setTimeout(() => setHidden(true), 0);
    return () => clearTimeout(t);
  }, []);
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* fine: hidden for this visit */
    }
  };
  return (
    <section className={styles.strip} aria-labelledby="howto-title">
      <div className={styles.head}>
        <h2 id="howto-title">New here? How to use this site</h2>
        <button type="button" className={styles.close} onClick={dismiss} aria-label="Hide this guide">
          Got it ×
        </button>
      </div>
      <ol className={styles.steps}>
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className={`mono ${styles.no}`} aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <Link href={s.href} prefetch={false}>
                {s.cta} →
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
