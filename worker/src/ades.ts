/**
 * ADES (Astrometry Data Exchange Standard, version 2022) export of an object's astrometry, in
 * the XML form the Minor Planet Center accepts.
 *
 * Every value comes from the object's real detections: SPHEREx exposure midpoints (UTC), the
 * positions and position errors we measured, and SPHEREx's geocentric position from the image
 * headers (space-based observations need it). Nothing is submitted from here: a file is a draft
 * for the team to vet, and the MPC needs an observatory code before it accepts anything (see
 * docs/api-contract.md, "ADES export").
 */
import type { ObjectDetail, ObjectDetection } from "./contract";

export const ADES_VERSION = "2022";
/**
 * Reference catalog of the SPHEREx Level 2 astrometric solution. The team confirms it against
 * the SPHEREx Explanatory Supplement before any submission (docs/api-contract.md).
 */
export const AST_CAT = "Gaia3";
/** Placeholder the MPC uses for an unknown station; replaced by MPC_STATION_CODE when set. */
export const UNASSIGNED_STATION = "XXX";
/** Exposures closer together than this are one observation time (simultaneous detectors). */
const SAME_TIME_SECONDS = 1;

export interface AdesOptions {
  /** MPC observatory code for SPHEREx observations (env MPC_STATION_CODE). */
  stationCode?: string | null;
  /** Submitter name for obsContext (env ADES_SUBMITTER). */
  submitter?: string | null;
  generatedUtc: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const el = (name: string, value: string | number) => `<${name}>${esc(String(value))}</${name}>`;

/** UTC ISO time with milliseconds from an MJD (UTC), e.g. 2026-07-17T12:45:51.193Z. */
export function mjdToIso(mjd: number): string {
  return new Date(Math.round((mjd - 40587) * 86_400_000)).toISOString();
}

/**
 * One detection per observation time. One SPHEREx exposure images the same sky on several
 * detectors at once (different wavelengths); they are not independent observations, so the
 * one with the highest S/N is kept.
 */
export function observationsOf(dets: ObjectDetection[]): ObjectDetection[] {
  const sorted = [...dets].sort((a, b) => a.mjd - b.mjd);
  const out: ObjectDetection[] = [];
  for (const d of sorted) {
    const last = out.at(-1);
    if (last && (d.mjd - last.mjd) * 86_400 < SAME_TIME_SECONDS) {
      if (d.snr > last.snr) out[out.length - 1] = d;
    } else out.push(d);
  }
  return out;
}

/**
 * A temporary designation (trkSub, at most 8 characters) that is stable for an object: "SPX"
 * plus 5 base-36 characters of a hash of its id.
 */
export function trkSubFor(objectId: string): string {
  let h = 2166136261;
  for (let i = 0; i < objectId.length; i++) {
    h ^= objectId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `SPX${(h % 36 ** 5).toString(36).toUpperCase().padStart(5, "0")}`;
}

/** permID / provID from a JPL designation such as "101 Helena (A868 PA)" or "(2025 OJ736)". */
export function idsFromDesignation(designation: string | null): { permID?: string; provID?: string } {
  if (!designation) return {};
  const m = /^\s*(\d+)\b[^(]*(?:\(([^)]+)\))?\s*$/.exec(designation);
  if (m) {
    const prov = m[2] && /^\d{4} [A-Z]{2}\d*$/.test(m[2].trim()) ? m[2].trim() : undefined;
    return { permID: m[1], ...(prov ? { provID: prov } : {}) };
  }
  const p = /^\s*\(?(\d{4} [A-Z]{2}\d*)\)?\s*$/.exec(designation);
  return p ? { provID: p[1] } : {};
}

/** The ADES XML for an object. Throws for injected objects, which are never reported. */
export function adesXml(obj: ObjectDetail, opts: AdesOptions): string {
  if (obj.classification === "injected") throw new Error("injected objects are never reported");
  const stn = opts.stationCode?.trim() || UNASSIGNED_STATION;
  const ids = obj.known_object.matched ? idsFromDesignation(obj.known_object.designation) : {};
  const trkSub = trkSubFor(obj.object_id);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<ades version="${ADES_VERSION}">`);
  lines.push("  <obsBlock>");
  lines.push("    <obsContext>");
  lines.push(`      <observatory>${el("mpcCode", stn)}${el("name", "SPHEREx (space-based)")}</observatory>`);
  lines.push(`      <submitter>${el("name", opts.submitter?.trim() || "SPHEREx Planet X team (not yet set)")}</submitter>`);
  lines.push(`      <observers>${el("name", "SPHEREx mission (NASA/JPL-Caltech), public archive data")}</observers>`);
  lines.push(`      <measurers>${el("name", opts.submitter?.trim() || "SPHEREx Planet X team (not yet set)")}</measurers>`);
  lines.push(`      <telescope>${el("name", "SPHEREx")}${el("aperture", "0.2")}${el("design", "Reflector")}${el("detector", "CMO")}</telescope>`);
  lines.push("      <comment>");
  const comments = [
    `DRAFT for team review; not submitted. Object ${obj.object_id}, generated ${opts.generatedUtc}.`,
    `Positions measured by spherex-planet-x pipeline ${obj.pipeline_version} on SPHEREx Level 2 images.`,
    stn === UNASSIGNED_STATION ? "MPC observatory code not configured (XXX): not valid for submission." : `Observatory code ${stn}.`,
    `JPL catalog check: ${obj.known_object.checked ? (obj.known_object.matched ? `matched ${obj.known_object.designation}` : "no known object matched") : "not checked"}.`,
  ];
  if (obj.reporting) comments.push(`Reporting status: ${obj.reporting.status} (${obj.reporting.label_plain}).`);
  for (const c of comments) lines.push(`        ${el("line", c)}`);
  lines.push("      </comment>");
  lines.push("    </obsContext>");
  lines.push("    <obsData>");
  for (const d of observationsOf(obj.detections)) {
    const [x, y, z] = d.spacecraft_geocentric_km ?? [null, null, null];
    const parts = [
      ids.permID ? el("permID", ids.permID) : "",
      ids.provID ? el("provID", ids.provID) : "",
      el("trkSub", trkSub),
      el("mode", "CMO"),
      el("stn", stn),
      x !== null && y !== null && z !== null
        ? `${el("sys", "ICRF_KM")}${el("ctr", "399")}${el("pos1", x.toFixed(3))}${el("pos2", y.toFixed(3))}${el("pos3", z.toFixed(3))}`
        : "",
      el("obsTime", mjdToIso(d.mjd)),
      el("ra", d.ra_deg.toFixed(7)),
      el("dec", d.dec_deg.toFixed(7)),
      el("rmsRA", d.pos_err_arcsec.toFixed(3)),
      el("rmsDec", d.pos_err_arcsec.toFixed(3)),
      el("astCat", AST_CAT),
      el("remarks", `${d.obs_id} band ${d.band_index} (${d.wavelength_um_center} um), S/N ${d.snr}`),
    ];
    lines.push(`      <optical>${parts.join("")}</optical>`);
  }
  lines.push("    </obsData>");
  lines.push("  </obsBlock>");
  lines.push("</ades>");
  return `${lines.join("\n")}\n`;
}
