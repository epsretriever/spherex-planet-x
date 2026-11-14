import { catalogChips } from "@/lib/catalogs";
import styles from "./Catalogs.module.css";

/**
 * "✓ JPL · SkyBoT": the independent catalogs that agree on an object's identification.
 * Renders nothing when the data doesn't say (older records, or nothing agrees).
 */
export function CatalogChips({ names, className }: { names: readonly string[] | null | undefined; className?: string }) {
  const chips = catalogChips(names);
  if (chips.length === 0) return null;
  return (
    <span className={`${styles.chips}${className ? ` ${className}` : ""}`} data-count={chips.length} data-testid="catalog-chips">
      <span className="visually-hidden">
        {chips.length === 1 ? "Identified by one catalog so far: " : `Confirmed by ${chips.length} independent catalogs: `}
      </span>
      <span className={styles.tick} aria-hidden="true">
        {chips.length >= 2 ? "✓" : "·"}
      </span>
      {chips.map((c, i) => (
        <span key={c} className={styles.chip}>
          {i > 0 && (
            <span className={styles.sep} aria-hidden="true">
              ·
            </span>
          )}
          {c}
          {i < chips.length - 1 && <span className="visually-hidden">, </span>}
        </span>
      ))}
    </span>
  );
}
