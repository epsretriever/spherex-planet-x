"use client";

import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState } from "@/components/DataState";
import { StudySkeleton } from "@/components/Skeletons";
import { DEPTH_RANGE, SkyMap, depthColor, hasSourcedRegion } from "@/components/SkyMap";
import { getFields, getSurvey } from "@/lib/api";
import type { Survey, SurveyTile } from "@/lib/contract";
import { fmt, formatUtcDate, formatUtcDateTime } from "@/lib/format";
import { fieldHref } from "@/lib/routes";
import { useData } from "@/lib/useData";
import styles from "./SkyView.module.css";

/** The whole sky is 4π steradians: 41,252.96 square degrees. */
const SKY_DEG2 = 41252.96;

const STATUS: Record<SurveyTile["status"], string> = {
  processed: "Searched",
  pending: "Waiting",
  no_data: "No SPHEREx data",
};

function percent(area: number): string {
  const p = (100 * area) / SKY_DEG2;
  if (p === 0) return "0%";
  if (p < 0.001) return "under 0.001%";
  return `${p < 0.1 ? p.toPrecision(1) : p.toFixed(1)}%`;
}

/** Rows shown before "Show all": the table is a reference, the map is the overview. */
const TABLE_ROWS = 30;

/** The survey footprint: as published at build time, then as the API serves it now. */
export function SkyView({ initial, fieldNames }: { initial: Survey | null; fieldNames: Record<string, string> }) {
  const [showAll, setShowAll] = useState(false);
  const state = useData("survey", (signal) => getSurvey(signal));
  const fields = useData("fields", (signal) => getFields(signal));
  const survey = state.status === "ok" ? state.data : initial;
  const names: Record<string, string> =
    fields.status === "ok" ? { ...fieldNames, ...Object.fromEntries(fields.data.fields.map((f) => [f.field_id, f.name])) } : fieldNames;

  if (!survey) {
    if (state.status === "loading") return <StudySkeleton />;
    if (state.status === "error" && state.error.reason === "not_found") {
      return (
        <EmptyState title="No survey published yet">
          <p>Once our pipeline searches its first patch of sky, it will appear on this map.</p>
        </EmptyState>
      );
    }
    if (state.status === "error") return <ErrorState reason={state.error.reason} message={state.error.message} onRetry={state.retry} />;
    return null;
  }

  const name = (t: SurveyTile) => (t.field_id ? names[t.field_id] : undefined);
  const tiles = [...survey.tiles].sort((a, b) => a.ecliptic_lon_deg - b.ecliptic_lon_deg);
  const p9 = hasSourcedRegion(survey.planet_nine) ? survey.planet_nine : null;
  const anyDepth = tiles.some((t) => t.m50_ab !== null);
  const statuses = new Set(tiles.map((t) => t.status));
  const t = survey.totals;
  // Tiles with moving objects first, then the rest by longitude.
  const rows = [...tiles].sort((a, b) => Number(b.n_candidates > 0) - Number(a.n_candidates > 0));
  const shown = showAll ? rows : rows.slice(0, TABLE_ROWS);

  return (
    <div className={styles.stack}>
      <dl className={styles.stats}>
        <div>
          <dt>Tiles searched</dt>
          <dd className="mono">
            {t.n_processed}
            {t.n_tiles > t.n_processed && <small> of {t.n_tiles}</small>}
          </dd>
        </div>
        <div>
          <dt>Sky searched</dt>
          <dd className="mono">
            {fmt(t.area_deg2_processed, t.area_deg2_processed < 10 ? 2 : 0)} deg²
          </dd>
          <dd className={styles.statNote}>{percent(t.area_deg2_processed)} of the whole sky</dd>
        </div>
        <div>
          <dt>Images</dt>
          <dd className="mono">{t.n_epochs}</dd>
        </div>
        <div>
          <dt>Moving objects</dt>
          <dd className="mono">{t.n_objects}</dd>
        </div>
      </dl>

      <figure className={`card ${styles.mapCard}`}>
        <SkyMap tiles={tiles} planetNine={p9} tileName={name} />
        <figcaption className={styles.legend}>
          <ul>
            <li>
              <span className={styles.swTile} aria-hidden="true" /> Tile we searched{anyDepth ? ", coloured by depth" : ""} (select to open it)
            </li>
            {statuses.has("pending") && (
              <li>
                <span className={styles.swPending} aria-hidden="true" /> Waiting to be searched
              </li>
            )}
            <li>
              <span className={styles.swEcliptic} aria-hidden="true" /> Ecliptic: the plane of the planets, where most asteroids are
            </li>
            <li>
              <span className={styles.swGalactic} aria-hidden="true" /> Milky Way: crowded with stars, hardest to search
            </li>
            {p9 && (
              <>
                <li>
                  <span className={styles.swP9Inner} aria-hidden="true" /> Most likely Planet Nine positions (68%)
                </li>
                <li>
                  <span className={styles.swP9Outer} aria-hidden="true" /> Possible Planet Nine positions (95%)
                </li>
              </>
            )}
          </ul>
          {anyDepth && (
            <p className={styles.ramp}>
              <span>
                Shallower · m₅₀ {DEPTH_RANGE[0]}
              </span>
              <span className={styles.rampBar} aria-hidden="true" />
              <span>{DEPTH_RANGE[1]} · deeper</span>
            </p>
          )}
          <p className={styles.note}>
            Equatorial coordinates, right ascension increasing to the left as the sky looks from Earth. Tiles are drawn much larger than
            their true size ({survey.tile_size_deg}° across) so they can be seen.
          </p>
          {p9 && (
            <p className={styles.note}>
              Planet Nine region: the share of predicted positions in {p9.cell_deg}° cells for {formatUtcDate(p9.epoch_utc)}, from{" "}
              <a href={p9.url} rel="noopener" target="_blank">
                {p9.citation}
              </a>
              . It is a prediction of where a hypothetical planet would be if it exists, not a detection.
            </p>
          )}
        </figcaption>
      </figure>

      <section className={styles.section} aria-labelledby="tiles-title">
        <h2 id="tiles-title">Tiles searched</h2>
        <p className={styles.intro}>
          The depth (m₅₀) is the magnitude at which we find half of the simulated objects we plant there; it stays blank until that test has
          run on the tile.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Tile</th>
                <th scope="col">Status</th>
                <th scope="col">Position (RA, Dec)</th>
                <th scope="col">Ecliptic latitude</th>
                <th scope="col">Dates</th>
                <th scope="col">Images</th>
                <th scope="col">Moving objects</th>
                <th scope="col">Depth m₅₀</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((tile) => (
                <tr key={tile.tile_id}>
                  <th scope="row">
                    {tile.field_id && tile.status === "processed" ? (
                      <Link href={fieldHref(tile.field_id)} prefetch={false}>
                        {name(tile) ?? tile.tile_id}
                      </Link>
                    ) : (
                      (name(tile) ?? tile.tile_id)
                    )}
                    <span className={`mono ${styles.tileId}`}>{tile.tile_id}</span>
                  </th>
                  <td>
                    <span className={styles.status} data-status={tile.status}>
                      {STATUS[tile.status]}
                    </span>
                  </td>
                  <td className="mono">
                    {fmt(tile.center.ra_deg, 2)}°, {fmt(tile.center.dec_deg, 2)}°
                  </td>
                  <td className="mono">{fmt(tile.ecliptic_lat_deg, 1)}°</td>
                  <td>
                    {tile.first_time_utc && tile.last_time_utc
                      ? formatUtcDate(tile.first_time_utc) === formatUtcDate(tile.last_time_utc)
                        ? formatUtcDate(tile.first_time_utc)
                        : `${formatUtcDate(tile.first_time_utc)} – ${formatUtcDate(tile.last_time_utc)}`
                      : "—"}
                  </td>
                  <td className="mono">{tile.n_epochs}</td>
                  <td className="mono">{tile.n_candidates}</td>
                  <td className="mono">
                    {tile.m50_ab !== null ? (
                      <>
                        <span className={styles.dot} style={{ background: depthColor(tile.m50_ab) ?? undefined }} aria-hidden="true" />
                        {fmt(tile.m50_ab, 1)}
                      </>
                    ) : (
                      <span className="muted">not measured</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > shown.length && (
          <p>
            <button type="button" className="button" onClick={() => setShowAll(true)}>
              Show all {rows.length} tiles
            </button>
          </p>
        )}
        <p className={styles.note}>
          {survey.description} Survey map generated {formatUtcDateTime(survey.generated_utc)}.
          {survey.last_run && (
            <>
              {" "}
              Last run finished {formatUtcDateTime(survey.last_run.finished_utc)}: {survey.last_run.n_tiles_processed} tiles,{" "}
              {survey.last_run.n_new_objects} new objects.
            </>
          )}
        </p>
        <p className={styles.next}>
          <Link href="/limits/">How faint can we see? Detection limits →</Link>
        </p>
      </section>
    </div>
  );
}
