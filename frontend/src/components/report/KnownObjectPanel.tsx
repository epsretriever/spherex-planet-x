import type { Detection, KnownObject } from "@/lib/contract";
import { fmt, formatUtcDateTime, formatUtcShortDate } from "@/lib/format";
import { jplLinks } from "@/lib/jpl";
import { Panel } from "./Panel";
import styles from "./report.module.css";

export function KnownObjectPanel({
  known,
  detections,
  minimal = false,
}: {
  known: KnownObject;
  detections: Detection[];
  /** The record is minimal: JPL identified it, so stamps and our own orbit were not kept. */
  minimal?: boolean;
}) {
  const links = jplLinks(known);
  const byEpoch = new Map(detections.map((d, i) => [d.epoch_id, { d, i }]));
  let headline: React.ReactNode;
  if (!known.checked && known.enrichment === "pending") {
    headline = (
      <div className={styles.callout} role="status" aria-live="polite">
        <span className={styles.pulse} aria-hidden="true" />
        <p>
          <strong>Checking JPL&apos;s catalog now.</strong> We&apos;re asking NASA JPL which known asteroids and comets were at
          these positions, as seen from SPHEREx. This page updates by itself when the answer arrives, usually within a minute.
        </p>
      </div>
    );
  } else if (!known.checked) {
    headline = (
      <div className={styles.callout} data-tone="warn">
        <p>
          <strong>Not checked.</strong> We couldn&apos;t compare this object with known asteroids and comets
          {known.not_checked_reason ? `: ${known.not_checked_reason}` : "."} Until it is checked, &ldquo;no match&rdquo; tells us
          nothing.
        </p>
      </div>
    );
  } else if (known.matched) {
    headline = (
      <div className={styles.callout}>
        <div>
        <p>
          <strong>Yes: matches {known.designation ?? "a catalogued object"}.</strong> JPL&apos;s predicted position for this
          object agrees with ours at every sighting
          {known.search_radius_arcsec !== null ? `, within ${fmt(known.search_radius_arcsec, 0)} arcsec` : ""}.
        </p>
        {links && (
          <p className={styles.jplLinks}>
            Orbit and ephemerides from JPL:{" "}
            <a href={links.sbdb_url} target="_blank" rel="noopener noreferrer">
              Small-Body Database
            </a>{" "}
            ·{" "}
            <a href={links.horizons_url} target="_blank" rel="noopener noreferrer">
              Horizons
            </a>
          </p>
        )}
        {minimal && (
          <p>
            <small>
              Because JPL already knows this object, we keep a short record: our measurements, JPL&apos;s match and these links.
              Close-up stamps and our own orbit fit are kept only for objects JPL can&apos;t explain.
            </small>
          </p>
        )}
        </div>
      </div>
    );
  } else {
    headline = (
      <div className={styles.callout} data-tone="warn">
        <p>
          <strong>No match.</strong> No catalogued asteroid or comet was predicted within{" "}
          {known.search_radius_arcsec !== null ? `${fmt(known.search_radius_arcsec, 0)} arcsec` : "our search radius"} of these
          positions. That does not make it new: catalogs are incomplete, and it could still be an artifact.
        </p>
      </div>
    );
  }

  return (
    <Panel
      id="known"
      title="Known-object match"
      kicker={known.checked ? (known.matched ? "matched" : "no match") : known.enrichment === "pending" ? "checking…" : "not checked"}
    >
      {headline}
      <dl className={styles.facts} style={{ marginTop: "var(--space-4)" }}>
        <div>
          <dt>Catalogs checked</dt>
          <dd>{known.catalogs_checked.length ? known.catalogs_checked.join(", ") : "—"}</dd>
        </div>
        <div>
          <dt>Search radius</dt>
          <dd>
            {fmt(known.search_radius_arcsec, 0)} <small>arcsec</small>
          </dd>
        </div>
        {known.matched && known.predicted_vmag != null && (
          <div>
            <dt>Predicted brightness</dt>
            <dd>
              V = {fmt(known.predicted_vmag, 1)} <small>mag</small>
            </dd>
          </div>
        )}
        {!known.matched && known.nearest && (
          <div>
            <dt>Nearest known object</dt>
            <dd>
              {known.nearest.designation} <small>{fmt(known.nearest.separation_arcsec, 1)}″ away</small>
            </dd>
          </div>
        )}
        {known.query_utc && (
          <div>
            <dt>Queried</dt>
            <dd>
              <small>{formatUtcDateTime(known.query_utc)}</small>
            </dd>
          </div>
        )}
      </dl>
      {known.per_epoch && known.per_epoch.length > 0 && (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Predicted versus measured positions">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Sighting</th>
                <th scope="col">Date</th>
                <th scope="col">Predicted RA °</th>
                <th scope="col">Predicted Dec °</th>
                <th scope="col">Offset ″</th>
              </tr>
            </thead>
            <tbody>
              {known.per_epoch.map((p) => {
                const hit = byEpoch.get(p.epoch_id);
                return (
                  <tr key={p.epoch_id}>
                    <td>{hit ? `#${hit.i + 1}` : p.epoch_id}</td>
                    <td>{hit ? formatUtcShortDate(hit.d.time_utc) : "—"}</td>
                    <td>{fmt(p.predicted_ra_deg, 5)}</td>
                    <td>{fmt(p.predicted_dec_deg, 5)}</td>
                    <td>{fmt(p.separation_arcsec, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {known.observer && <p className={styles.note} style={{ marginTop: "var(--space-3)" }}>Predictions computed for observer: {known.observer}.</p>}
    </Panel>
  );
}
