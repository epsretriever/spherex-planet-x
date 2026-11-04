"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { TOUR_KEY, TOUR_START, startTour } from "./events";

// The panel and its data code load only once someone starts the tour (or resumes it after a page change).
const TourPanel = dynamic(() => import("./TourPanel"), { ssr: false });

function savedStep(): boolean {
  try {
    return sessionStorage.getItem(TOUR_KEY) !== null;
  } catch {
    return false;
  }
}

export function Tour() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const resume = savedStep() ? setTimeout(() => setOn(true), 0) : undefined;
    const onStart = () => {
      try {
        sessionStorage.setItem(TOUR_KEY, "0");
      } catch {
        /* the panel still starts at step 1 */
      }
      setOn(true);
    };
    window.addEventListener(TOUR_START, onStart);
    return () => {
      clearTimeout(resume);
      window.removeEventListener(TOUR_START, onStart);
    };
  }, []);
  return on ? <TourPanel /> : null;
}

export function TourButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className ?? "button"} onClick={startTour}>
      Take the 2-minute tour
    </button>
  );
}
