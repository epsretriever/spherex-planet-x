import Link from "next/link";
import { CATALOGS, CHECKED_CATALOGS, MATCH_RULE } from "@/lib/catalogs";
import { CatalogCounter } from "./CatalogCounter";
import styles from "./Catalogs.module.css";

/**
 * "How we identify known objects": which catalogs, why more than one, the 15″ rule, the rolling
 * re-check and what a disagreement means. The short form (Limits page) links to the full one.
 */
export function CatalogMethod({ short = false }: { short?: boolean }) {
  if (short) {
    return (
      <div className={styles.method}>
        <p>
          Calling an object &ldquo;known&rdquo; is only as good as the catalog behind it, so every moving object is checked against
          several independent catalogs: {CHECKED_CATALOGS.map((f) => CATALOGS[f].name).join(" and ")}. {MATCH_RULE}
        </p>
        <CatalogCounter boxed />
        <p>
          The limits: a catalogued object with a poorly known orbit can fall outside 15″ and look unexplained, and when only one catalog
          has answered, the identification is not yet independently confirmed. We run on very little computing power, so objects are
          re-checked on a rolling schedule: unexplained ones about daily, known ones about monthly.{" "}
          <Link href="/about/#catalogs">How we identify known objects</Link>
        </p>
      </div>
    );
  }
  return (
    <div className={styles.method}>
      <p>
        Every moving object we find is checked against several independent asteroid and comet catalogs, not one. Each row of an
        object&apos;s <strong>Catalog check</strong> shows what one of them answered.
      </p>
      <CatalogCounter boxed />
      <ul className={styles.dbs}>
        {CHECKED_CATALOGS.map((f) => {
          const c = CATALOGS[f];
          return (
            <li key={f}>
              <h3>
                <a href={c.home} target="_blank" rel="noopener noreferrer">
                  {c.name}
                </a>
              </h3>
              <p className={styles.dbWho}>{c.who}</p>
              <p>{c.role}</p>
            </li>
          );
        })}
      </ul>
      <ul className={styles.points}>
        <li>
          <strong>Why independent catalogs matter.</strong> Each service computes its own orbits and predictions. One catalog can be
          out of date, have a poor orbit for a faint object, or simply fail to answer. When two built by different teams put the
          same object at our measured position, a coincidence or a single bad orbit is far less likely.
        </li>
        <li>
          <strong>The 15″ rule.</strong> {MATCH_RULE}
        </li>
        <li>
          <strong>A slow, rotating re-check.</strong> We run on very little computing power and the catalogs limit how fast anyone may
          ask, so we don&apos;t re-check everything at once. Every object is revisited on a rolling schedule: unexplained objects about
          daily, known ones about monthly. Each catalog row shows the date of its last answer, and a new object may show &ldquo;Not
          checked yet&rdquo; until its turn comes.
        </li>
        <li>
          <strong>What &ldquo;Catalogs disagree&rdquo; means.</strong> One catalog places a different object at our position than
          another does. That can happen when two asteroids pass close together on the sky, or when one catalog&apos;s orbit is poor. We
          show both answers, mark the identification as uncertain, and check again; we do not pick a winner. If only one catalog has
          answered, we say so instead of calling the object confirmed.
        </li>
      </ul>
    </div>
  );
}
