"use client";

import { getCrossCheck } from "@/lib/api";
import { crossCheckTotals } from "@/lib/catalogs";
import { useData } from "@/lib/useData";
import styles from "./Catalogs.module.css";

const int = (n: number) => n.toLocaleString("en-US");

/**
 * The live totals of the catalog cross-check: "436 known objects · 210 confirmed by 2+ catalogs ·
 * re-checked continuously". Renders nothing until the API publishes every number it shows.
 */
export function CatalogCounter({ boxed = false }: { boxed?: boolean }) {
  const state = useData("cross-check", (signal) => getCrossCheck(signal));
  const t = state.status === "ok" ? crossCheckTotals(state.data) : null;
  if (!t) return null;
  const line = (
    <p className={styles.counter} data-testid="catalog-counter">
      <span>
        <strong>{int(t.known_total)}</strong> known {t.known_total === 1 ? "object" : "objects"}
      </span>
      <span>
        <strong>{int(t.agreeing_2plus)}</strong> confirmed by 2+ independent catalogs
      </span>
      {t.cross_checked < t.known_total && (
        <span>
          <strong>{int(t.cross_checked)}</strong> cross-checked so far
        </span>
      )}
      {t.disagreements > 0 && (
        <span>
          <strong>{int(t.disagreements)}</strong> where catalogs disagree
        </span>
      )}
      <span>re-checked continuously</span>
    </p>
  );
  if (!boxed) return line;
  return (
    <div className={styles.counterBox}>
      <p className={styles.counterLabel}>Right now</p>
      {line}
    </div>
  );
}
