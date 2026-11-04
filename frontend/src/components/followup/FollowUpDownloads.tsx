"use client";

import { useState } from "react";
import { DataError, getCandidate, getPrediction } from "@/lib/api";
import { adesPsv, ephemerisCsv, mpc80, STATION_PLACEHOLDER } from "@/lib/followup";
import styles from "./FollowUpDownloads.module.css";

function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * "Download for telescope follow-up": the SPHEREx astrometry as ADES PSV and MPC 80-column files,
 * and a 14-night approximate ephemeris, all built in the browser from the published report.
 */
export function FollowUpDownloads({
  objectId,
  candidateId,
  headingLevel = 2,
}: {
  objectId: string;
  candidateId: string;
  /** Where the box sits in the page outline. */
  headingLevel?: 2 | 3 | 4;
}) {
  const Heading = `h${headingLevel}` as "h2";
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(kind: "ades" | "mpc" | "eph") {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === "eph") {
        const pred = await getPrediction(objectId, 60);
        const csv = ephemerisCsv(objectId, pred, new Date(), 14);
        if (csv.trim().split("\n").filter((l) => !l.startsWith("#")).length <= 1) {
          setMessage("The published prediction doesn't cover the next 14 nights yet; it is refreshed when the survey next publishes.");
          return;
        }
        save(`${objectId}-ephemeris-approx.csv`, csv, "text/csv");
      } else {
        const cand = await getCandidate(candidateId);
        if (kind === "ades") save(`${objectId}-ades.psv`, adesPsv(objectId, cand), "text/plain");
        else save(`${objectId}-mpc80.txt`, mpc80(objectId, cand), "text/plain");
      }
      setMessage("Downloaded.");
    } catch (err) {
      setMessage(
        err instanceof DataError && err.reason === "not_found"
          ? "This object has no orbit prediction yet, so there is no ephemeris."
          : "The data couldn't be loaded. Try again in a moment.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.box}>
      <Heading className={styles.title}>Download for telescope follow-up</Heading>
      <div className={styles.buttons}>
        <button type="button" className="button" onClick={() => run("ades")} disabled={!!busy}>
          {busy === "ades" ? "Preparing…" : "Astrometry (ADES PSV)"}
        </button>
        <button type="button" className="button" onClick={() => run("mpc")} disabled={!!busy}>
          {busy === "mpc" ? "Preparing…" : "Astrometry (MPC 80-column)"}
        </button>
        <button type="button" className="button" onClick={() => run("eph")} disabled={!!busy}>
          {busy === "eph" ? "Preparing…" : "Ephemeris, next 14 nights (CSV)"}
        </button>
      </div>
      <p className={styles.note}>
        The astrometry files hold every SPHEREx detection with the spacecraft&apos;s position. They are drafts for planning, not Minor
        Planet Center submissions: the station code is a placeholder ({STATION_PLACEHOLDER}). The ephemeris is <strong>approximate</strong>
        : it comes from a preliminary orbit fitted to the measured motion, with its 1σ uncertainty on every row.
      </p>
      <p className={styles.status} role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
