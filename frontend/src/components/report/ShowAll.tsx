"use client";

import { useState } from "react";
import styles from "./report.module.css";

/**
 * Shows the first `initial` items of a long list with a button for the rest, so the report
 * stays scannable on a phone. Returns how many items to render and the toggle to put after them.
 */
export function useShowAll(total: number, initial: number, noun: string) {
  const [all, setAll] = useState(false);
  const collapsible = total > initial + 2;
  const count = !collapsible || all ? total : initial;
  const toggle = collapsible ? (
    <button type="button" className={`button ${styles.showAll}`} aria-expanded={all} onClick={() => setAll((v) => !v)}>
      {all ? `Show fewer ${noun}` : `Show all ${total} ${noun}`}
    </button>
  ) : null;
  return { count, toggle };
}
