import type { JplLinks } from "@/lib/contract";
import { jplLinks } from "@/lib/jpl";
import { CatalogChips } from "./catalogs/CatalogChips";
import styles from "./CandidateCard.module.css";

/**
 * An identified object's designation, the independent catalogs that agree on it, and links to
 * JPL's pages for its orbit (Small-Body Database) and ephemerides (Horizons). We link to the
 * catalogs rather than recompute either.
 */
export function CatalogLinksRow({
  matched,
  designation,
  published,
  agreeing,
}: {
  matched: boolean;
  designation: string | null | undefined;
  /** The links the pipeline published (used as-is when present). */
  published?: JplLinks | null;
  /** Catalogs that agree on the identification, when the data lists them. */
  agreeing?: readonly string[] | null;
}) {
  const links = jplLinks({ matched, designation, jpl_links: published, checked: true, catalogs_checked: [], search_radius_arcsec: null });
  if (!links || !designation) return null;
  return (
    <p className={styles.jpl}>
      <span className={styles.jplName}>
        <span className="visually-hidden">Identified as </span>
        {designation}
      </span>
      <CatalogChips names={agreeing} />
      <a href={links.sbdb_url} target="_blank" rel="noopener noreferrer">
        Orbit (JPL SBDB)<span className="visually-hidden">, opens in a new tab</span>
      </a>
      <a href={links.horizons_url} target="_blank" rel="noopener noreferrer">
        Ephemeris (Horizons)<span className="visually-hidden">, opens in a new tab</span>
      </a>
    </p>
  );
}
