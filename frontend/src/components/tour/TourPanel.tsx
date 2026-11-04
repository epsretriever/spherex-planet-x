"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { findInjectionStudyId, getInjectionStudy, getObjects, getSurvey } from "@/lib/api";
import { getLeadSeeds } from "@/lib/leadsClient";
import { tourSteps, type TourData, type TourStep } from "@/lib/tour";
import { TOUR_KEY as KEY, TOUR_START } from "./events";
import styles from "./Tour.module.css";


function readStep(): number | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function writeStep(step: number | null) {
  try {
    if (step === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, String(step));
  } catch {
    /* the tour still works for this page */
  }
}

async function loadTourData(): Promise<TourData> {
  const settle = <T,>(p: Promise<T>) => p.catch(() => null);
  const ctrl = new AbortController();
  const [survey, objects, leads, study] = await Promise.all([
    settle(getSurvey(ctrl.signal)),
    settle(getObjects(ctrl.signal)),
    settle(getLeadSeeds(ctrl.signal)),
    settle(findInjectionStudyId(ctrl.signal).then((id) => getInjectionStudy(id, ctrl.signal))),
  ]);
  return { survey, objects, leads, study };
}

/**
 * The 2-minute guided tour: a panel that walks through six pages, with captions written from the
 * live data. Its step is kept in sessionStorage so it survives the page changes.
 */
export default function TourPanel() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [step, setStep] = useState<number | null>(null);
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const ensureData = useCallback(() => {
    if (steps) return;
    setSteps(tourSteps({ survey: null, objects: null, leads: null, study: null }));
    loadTourData().then((d) => setSteps(tourSteps(d)));
  }, [steps]);

  // Resume after a navigation, or start on request.
  useEffect(() => {
    // After hydration (the static HTML never shows the tour).
    const saved = readStep();
    const resume =
      saved !== null && Number.isFinite(saved)
        ? setTimeout(() => {
            setStep(saved);
            ensureData();
          }, 0)
        : undefined;
    const onStart = () => {
      writeStep(0);
      setStep(0);
      ensureData();
    };
    window.addEventListener(TOUR_START, onStart);
    return () => {
      clearTimeout(resume);
      window.removeEventListener(TOUR_START, onStart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = step !== null && steps ? steps[Math.min(step, steps.length - 1)] : null;

  // Go to the step's page when it isn't the one on screen.
  useEffect(() => {
    if (!current) return;
    const [want, query = ""] = current.href.split("?");
    const here = typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "";
    if (pathname !== want || here !== query) router.push(current.href);
  }, [current, pathname, router]);

  useEffect(() => {
    if (current) panel.current?.focus();
  }, [current]);

  const go = (n: number | null) => {
    writeStep(n);
    setStep(n);
    if (n !== null) window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") go(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  if (!current || step === null || !steps) return null;
  const last = step >= steps.length - 1;
  return (
    <div ref={panel} className={styles.panel} role="dialog" aria-modal="false" aria-labelledby="tour-title" tabIndex={-1}>
      <p className={`mono ${styles.count}`}>
        Tour · step {step + 1} of {steps.length}
      </p>
      <h2 id="tour-title" className={styles.title}>
        {current.title}
      </h2>
      <p className={styles.caption} aria-live="polite">
        {current.caption}
      </p>
      <div className={styles.dots} aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s.title} data-on={i === step ? "" : undefined} />
        ))}
      </div>
      <div className={styles.actions}>
        <button type="button" className="button" onClick={() => go(null)}>
          Exit
        </button>
        <span className={styles.spacer} />
        {step > 0 && (
          <button type="button" className="button" onClick={() => go(step - 1)}>
            Back
          </button>
        )}
        {last ? (
          <Link href="/objects/?view=leads" className="button button-primary" onClick={() => go(null)}>
            Finish
          </Link>
        ) : (
          <button type="button" className="button button-primary" onClick={() => go(step + 1)}>
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
