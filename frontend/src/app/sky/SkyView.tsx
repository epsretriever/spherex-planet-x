"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState } from "@/components/DataState";
import { StudySkeleton } from "@/components/Skeletons";
import { Deferred } from "@/components/Deferred";
import { DEPTH_RANGE, OBJECT_STEPS, SkyMap, type RaUnits, type SkyColorBy, type SkyTile, depthColor, hasSourcedRegion } from "@/components/SkyMap";
import type { GrowthDay } from "@/lib/staticData";
import { CoverageChart } from "./CoverageChart";
import { getFields, getSurvey } from "@/lib/api";
import type { Survey, SurveyTile } from "@/lib/contract";
import { fmt, formatUtcDate, formatUtcDateTime } from "@/lib/format";
import { fieldHref } from "@/lib/routes";
import { useData } from "@/lib/useData";
import styles from "./SkyView.module.css";

/** The whole sky is 4π steradians: 41,252.96 square degrees. */
const SKY_DEG2 = 41252.96;

const STATUS: Record<SurveyTile["status"], string> = {
  processed: "Moving objects",
  empty: "Searched, nothing found",
  failed: "Search failed",
  pending: "Waiting",
  no_data: "No repeat visits",
};

function percent(area: number): string {
  const p = (100 * area) / SKY_DEG2;
  if (p === 0) return "0%";
  if (p < 0.001) return "under 0.001%";
  return `${p < 0.1 ? p.toPrecision(1) : p.toFixed(1)}%`;
}

/** Rows shown before "Show all": the table is a reference, the map is the overview. */
const TABLE_ROWS = 30;

/** A survey whose tiles may carry only the fields this page reads (the build-time copy). */
export type SkySurvey = Omit<Survey, "tiles"> & { tiles: SkyTile[] };

/** The survey footprint: as published at build time, then as the API serves it now. */
export function SkyView({
  initial,
  fieldNames,
  growth = [],
}: {
  initial: SkySurvey | null;
  fieldNames: Record<string, string>;
  growth?: GrowthDay[];
}) {
  const [showAll, setShowAll] = useState(false);
  const [colorBy, setColorBy] = useState<SkyColorBy>("objects");
  const [raUnits, setRaUnits] = useState<RaUnits>("deg");
  // With the build-time survey on screen, the live one (and the Planet Nine region) can wait until the page is idle.
  const [live, setLive] = useState(!initial);
  useEffect(() => {
    if (live) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) {
      w.requestIdleCallback(() => setLive(true), { timeout: 2500 });
    } else {
      const t = setTimeout(() => setLive(true), 1200);
      return () => clearTimeout(t);
    }
  }, [live]);
  const state = useData(live ? "survey" : null, (signal) => getSurvey(signal));
  const fields = useData(live ? "fields" : null, (signal) => getFields(signal));
  const survey: SkySurvey | null = state.status === "ok" ? state.data : initial;
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

  const name = (t: SkyTile) => (t.field_id ? names[t.field_id] : undefined);
  const tiles = [...survey.tiles].sort((a, b) => a.ecliptic_lon_deg - b.ecliptic_lon_deg);
  const p9 = hasSourcedRegion(survey.planet_nine) ? survey.planet_nine : null;
  const anyDepth = tiles.some((t) => t.m50_ab !== null);
  const statuses = new Set(tiles.map((t) => t.status));
  const empty = survey.empty_cells ?? null;
  if (empty && empty.n_tiles > 0) statuses.add("empty");
  const count = (st: SurveyTile["status"]) =>
    (tiles.filter((t) => t.status === st).length + (st === "empty" ? (empty?.n_tiles ?? 0) : 0)).toLocaleString("en-US");
  const t = survey.totals;
  // Tiles with moving objects first, then the rest by longitude.
  const rows = [...tiles].sort((a, b) => Number(b.n_candidates > 0) - Number(a.n_candidates > 0));
  const shown = showAll ? rows : rows.slice(0, TABLE_ROWS);

  return (
    <div className={styles.stack}>
      <dl className={styles.stats}>
        <div>
          <dt>Patches of sky searched</dt>
          <dd className="mono">{(t.n_searched ?? t.n_processed).toLocaleString("en-US")}</dd>
          <dd className={styles.statNote}>{t.n_processed.toLocaleString("en-US")} with moving objects</dd>
        </div>
        <div>
          <dt>Sky searched</dt>
          <dd className="mono">
            {fmt(t.area_deg2_searched ?? t.area_deg2_processed, (t.area_deg2_searched ?? t.area_deg2_processed) < 10 ? 2 : 0)} deg²
          </dd>
          <dd className={styles.statNote}>{percent(t.area_deg2_searched ?? t.area_deg2_processed)} of the whole sky</dd>
        </div>
        <div>
          <dt>Images</dt>
          <dd className="mono">{t.n_epochs.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Moving objects</dt>
          <dd className="mono">{t.n_objects}</dd>
        </div>
      </dl>

      {/* The map and table lay out after the header paints, as the evidence report does. */}
      <Deferred fallback={<div className={`card ${styles.mapCard} ${styles.mapPlaceholder}`} aria-hidden="true" />}>
      <figure className={`card ${styles.mapCard}`}>
        <div className={styles.explainer}>
          <h2 className={styles.explainerTitle}>How to read this map</h2>
          <p>
            This is a map of the <strong>whole sky</strong>, like a globe unrolled flat. <strong>Left–right</strong> goes around the sky
            (right ascension, 0–360°); <strong>up–down</strong> is north–south (declination, +90° at the top, −90° at the bottom). Each dot
            is a patch we searched; the rest of the oval is sky we haven&apos;t searched yet.
          </p>
        </div>
        <div className={styles.controls}>
        {anyDepth && (
          <fieldset className={styles.colorBy}>
            <legend>Colour tiles by</legend>
            {(["objects", "depth"] as const).map((v) => (
              <label key={v}>
                <input type="radio" name="sky-color" value={v} checked={colorBy === v} onChange={() => setColorBy(v)} />
                {v === "objects" ? "Moving objects" : "Depth (m₅₀)"}
              </label>
            ))}
          </fieldset>
        )}
          <fieldset className={styles.colorBy}>
            <legend>Right ascension in</legend>
            {(["deg", "hours"] as const).map((v) => (
              <label key={v}>
                <input type="radio" name="sky-ra" value={v} checked={raUnits === v} onChange={() => setRaUnits(v)} />
                {v === "deg" ? "Degrees (0–360°)" : "Hours (0–24h)"}
              </label>
            ))}
          </fieldset>
        </div>
        <SkyMap tiles={tiles} planetNine={p9} tileName={name} emptyCells={empty?.positions} colorBy={anyDepth ? colorBy : "objects"} raUnits={raUnits} />
        <p className={styles.axes}>
          <span>↑ North (declination +90°) · ↓ South (−90°)</span>
          <span>
            ← Right ascension increases to the left ({raUnits === "deg" ? "0° to 360°" : "0h to 24h"}), as the sky looks from Earth
          </span>
        </p>
        <figcaption className={styles.legend}>
          <ul>
            <li>
              <span className={styles.swTile} aria-hidden="true" /> Searched, moving objects found ({count("processed")}): select one to open
              its patch
            </li>
            {(colorBy === "objects" || !anyDepth) && (
              <li className={styles.countKey}>
                  {OBJECT_STEPS.map((st) => (
                    <span key={st.min}>
                      <span className={styles.swCount} style={{ background: st.color, width: st.r * 1.6, height: st.r * 1.6 }} aria-hidden="true" />
                      {st.label}
                    </span>
                  ))}
              </li>
            )}
            {statuses.has("empty") && (
              <li>
                <span className={styles.swEmpty} aria-hidden="true" /> Searched, nothing found ({count("empty")})
              </li>
            )}
            {statuses.has("failed") && (
              <li>
                <span className={styles.swFailed} aria-hidden="true" /> Search failed, will be retried ({count("failed")})
              </li>
            )}
            {statuses.has("pending") && (
              <li>
                <span className={styles.swPending} aria-hidden="true" /> Waiting to be searched ({count("pending")})
              </li>
            )}
            <li>
              <span className={styles.swEcliptic} aria-hidden="true" /> Ecliptic: the plane where planets and asteroids travel, so most moving
              objects are found near it
            </li>
            <li>
              <span className={styles.swGalactic} aria-hidden="true" /> Milky Way: the band of our galaxy, so crowded with stars it is the hardest
              place to search
            </li>
            {p9 && (
              <>
                <li>
                  <span className={styles.swP9Pin} aria-hidden="true" /> Planet Nine search region: the labelled pin marks where it would most
                  likely be, if it exists
                </li>
                <li>
                  <span className={styles.swP9Inner} aria-hidden="true" /> Where Planet Nine is most likely, if it exists (68%)
                </li>
                <li>
                  <span className={styles.swP9Outer} aria-hidden="true" /> Where it could be (95%)
                </li>
              </>
            )}
          </ul>
          {anyDepth && colorBy === "depth" && (
            <p className={styles.ramp}>
              <span>
                Shallower · m₅₀ {DEPTH_RANGE[0]}
              </span>
              <span className={styles.rampBar} aria-hidden="true" />
              <span>{DEPTH_RANGE[1]} · deeper</span>
            </p>
          )}
          <p className={styles.note}>
            Hover or tab to a dot for its details. Tiles are drawn much larger than their true size ({survey.tile_size_deg}° across) so
            they can be seen.
          </p>
          {p9 && (
            <p className={styles.note}>
              Planet Nine region: the share of predicted positions in {p9.cell_deg}° cells for {formatUtcDate(p9.epoch_utc)}, from{" "}
              <a href={p9.url} rel="noopener" target="_blank">
                {p9.citation}
              </a>
              {typeof p9.n_remaining === "number" && typeof p9.n_population === "number" ? (
                <>
                  , counting only the {p9.n_remaining.toLocaleString("en-US")} of {p9.n_population.toLocaleString("en-US")} simulated orbits
                  that earlier surveys haven&apos;t ruled out{p9.population ? ` (${p9.population})` : ""}
                </>
              ) : null}
              . It is a prediction of where a hypothetical planet would be if it exists, not a detection.
            </p>
          )}
        </figcaption>
      </figure>

      <CoverageChart days={growth} />

      <section className={styles.section} aria-labelledby="tiles-title">
        <h2 id="tiles-title">Patches of sky searched</h2>
        <p className={styles.intro}>
          Each patch is one {survey.tile_size_deg}° × {survey.tile_size_deg}° tile of the map. The home page counts the same patches.
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
                      {STATUS[tile.status] ?? tile.status}
                    </span>
                    {tile.status === "failed" && tile.detail && <span className={`mono ${styles.tileId}`}>{tile.detail}</span>}
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
      </Deferred>
    </div>
  );
}
