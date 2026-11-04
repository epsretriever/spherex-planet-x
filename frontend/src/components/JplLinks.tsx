import type { JplLinks } from "@/lib/contract";
import { jplLinks } from "@/lib/jpl";
import styles from "./CandidateCard.module.css";

/**
 * A JPL-identified object's designation with links to JPL's own pages for its orbit (Small-Body
 * Database) and ephemerides (Horizons). We link to JPL rather than recompute either.
 */
export function JplLinksRow({
  matched,
  designation,
  published,
}: {
  matched: boolean;
  designation: string | null | undefined;
  /** The links the pipeline published (used as-is when present). */
  published?: JplLinks | null;
}) {
  const links = jplLinks({ matched, designation, jpl_links: published, checked: true, catalogs_checked: [], search_radius_arcsec: null });
  if (!links || !designation) return null;
  return (
    <p className={styles.jpl}>
      <span className={styles.jplName}>
        <span className="visually-hidden">Identified by JPL as </span>
        {designation}
      </span>
      <a href={links.sbdb_url} target="_blank" rel="noopener noreferrer">
        Orbit (JPL SBDB)<span className="visually-hidden">, opens in a new tab</span>
      </a>
      <a href={links.horizons_url} target="_blank" rel="noopener noreferrer">
        Ephemeris (Horizons)<span className="visually-hidden">, opens in a new tab</span>
      </a>
    </p>
  );
}
