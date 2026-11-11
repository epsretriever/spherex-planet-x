import type { CandidateDetail, ObjectPrediction } from "./contract";

/**
 * Telescope follow-up files for an unexplained object, written in the browser from the published
 * measurements: the SPHEREx astrometry (ADES PSV and MPC 80-column) and an approximate ephemeris
 * for the next nights from our preliminary orbit. Nothing here is a Minor Planet Center
 * submission: the station code is a placeholder, and the files say so.
 */

/** Placeholder: SPHEREx's MPC observatory code must be filled in before any submission. */
export const STATION_PLACEHOLDER = "XXX";

/** A temporary designation (7 characters, fits ADES trkSub and the 80-column format) derived from the object ID. */
export function trackSubId(objectId: string): string {
  let h = 2166136261;
  for (const ch of objectId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `SP${h.toString(36).toUpperCase().padStart(5, "0").slice(-5)}`;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

function sexagesimal(value: number, unitsPerCircle: number, decimals: number) {
  // value in hours or degrees (already scaled); returns [whole, minutes, seconds string]
  const total = Math.round(value * 3600 * 10 ** decimals) / 10 ** decimals;
  let whole = Math.floor(total / 3600);
  let rest = total - whole * 3600;
  let min = Math.floor(rest / 60);
  let sec = rest - min * 60;
  if (sec >= 60) {
    sec -= 60;
    min += 1;
  }
  if (min >= 60) {
    min -= 60;
    whole += 1;
  }
  if (whole >= unitsPerCircle) whole -= unitsPerCircle;
  rest = sec;
  return [whole, min, rest.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, "0")] as const;
}

/** "HH MM SS.sss" */
export function raHms(deg: number, decimals = 3): string {
  const [h, m, s] = sexagesimal((((deg % 360) + 360) % 360) / 15, 24, decimals);
  return `${pad(h, 2)} ${pad(m, 2)} ${s}`;
}

/** "sDD MM SS.ss" */
export function decDms(deg: number, decimals = 2): string {
  const [d, m, s] = sexagesimal(Math.abs(deg), 360, decimals);
  return `${deg < 0 ? "-" : "+"}${pad(d, 2)} ${pad(m, 2)} ${s}`;
}

/** "YYYY MM DD.dddddd" in UTC (MPC 80-column date). */
export function mpcDate(iso: string): string {
  const t = new Date(iso);
  const day0 = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  const frac = (t.getTime() - day0) / 86400000;
  const dd = (t.getUTCDate() + frac).toFixed(6).padStart(9, "0");
  return `${t.getUTCFullYear()} ${pad(t.getUTCMonth() + 1, 2)} ${dd}`;
}

/** AB magnitude from a flux density in µJy. */
export function abMag(fluxUjy: number): number | null {
  return fluxUjy > 0 ? 23.9 - 2.5 * Math.log10(fluxUjy) : null;
}

function isoMs(iso: string) {
  return new Date(iso).toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
}

/** ADES 2017 PSV: one row per SPHEREx detection, with the spacecraft position (space-based observer). */
export function adesPsv(objectId: string, cand: CandidateDetail): string {
  const trk = trackSubId(objectId);
  const lines = [
    "# version=2017",
    "# observatory",
    `! mpcCode ${STATION_PLACEHOLDER}`,
    "! name SPHEREx (NASA), space-based",
    "# submitter",
    "! name Driftnet (driftnet-sky.vercel.app)",
    "# telescope",
    "! design Reflector",
    "! aperture 0.2",
    "! detector CCD",
    "# comment",
    "! line DRAFT FOR FOLLOW-UP PLANNING. NOT AN MPC SUBMISSION.",
    `! line Object ${objectId}, candidate ${cand.candidate_id}: no known object matched in JPL's catalogs.`,
    `! line Replace ${STATION_PLACEHOLDER} with SPHEREx's MPC observatory code before any use with the MPC.`,
    "! line Positions are SPHEREx Level 2 measurements (QR data); pos1-3 are the spacecraft's geocentric ICRF position in km from the FITS headers.",
    "! line Detector is HgCdTe; mode CCD is used for array detectors. Magnitudes are AB at the listed wavelength (remarks), not a standard band.",
  ];
  const cols = ["trkSub", "mode", "stn", "sys", "ctr", "pos1", "pos2", "pos3", "obsTime", "ra", "dec", "rmsRA", "rmsDec", "astCat", "remarks"];
  lines.push(cols.join("|"));
  for (const d of [...cand.detections].sort((a, b) => a.mjd - b.mjd)) {
    const pos = d.spacecraft_geocentric_km;
    const mag = abMag(d.flux_ujy);
    const remark = `${d.obs_id} ${d.wavelength_um_center != null ? `${d.wavelength_um_center.toFixed(3)}um` : ""} ${mag != null ? `AB=${mag.toFixed(2)}` : ""} SNR=${d.snr.toFixed(1)}`.replace(/\s+/g, " ").trim();
    lines.push(
      [
        trk,
        "CCD",
        STATION_PLACEHOLDER,
        pos ? "ICRF_KM" : "",
        pos ? "399" : "",
        pos ? pos[0]!.toFixed(3) : "",
        pos ? pos[1]!.toFixed(3) : "",
        pos ? pos[2]!.toFixed(3) : "",
        isoMs(d.time_utc),
        d.ra_deg.toFixed(7),
        d.dec_deg.toFixed(7),
        d.pos_err_arcsec.toFixed(3),
        d.pos_err_arcsec.toFixed(3),
        "UNK",
        remark,
      ].join("|"),
    );
  }
  return `${lines.join("\n")}\n`;
}

function signed(v: number, width: number, decimals: number) {
  const s = Math.abs(v).toFixed(decimals);
  return `${v < 0 ? "-" : "+"}${s.padStart(width - 1, " ")}`;
}

/**
 * MPC 1992 80-column format. Each SPHEREx detection is a space-based observation: an "S" line
 * with the position and an "s" line with the spacecraft's geocentric position in km.
 */
export function mpc80(objectId: string, cand: CandidateDetail): string {
  const id = `     ${trackSubId(objectId).padEnd(7, " ").slice(0, 7)}`; // cols 1-12
  const out: string[] = [];
  for (const d of [...cand.detections].sort((a, b) => a.mjd - b.mjd)) {
    const date = mpcDate(d.time_utc);
    const head = `${id}  S${date}`; // cols 1-32: id, discovery flag, note 1, note 2 = S, date
    const obs = `${head}${raHms(d.ra_deg)}${decDms(d.dec_deg)}${" ".repeat(21)}${STATION_PLACEHOLDER}`;
    out.push(obs);
    const pos = d.spacecraft_geocentric_km;
    if (pos) {
      const xyz = `1 ${signed(pos[0]!, 11, 4)} ${signed(pos[1]!, 11, 4)} ${signed(pos[2]!, 11, 4)}`;
      out.push(`${id}  s${date}${xyz.padEnd(45, " ")}${STATION_PLACEHOLDER}`);
    }
  }
  return `${out.join("\n")}\n`;
}

/** Ephemeris CSV for the next `nights` days from the preliminary-orbit prediction. */
export function ephemerisCsv(objectId: string, pred: ObjectPrediction & { note_plain?: string | null }, from: Date, nights = 14): string {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const rows = pred.points.filter((p) => Date.parse(p.time_utc) >= start).slice(0, nights + 1);
  const head = [
    `# APPROXIMATE EPHEMERIS for ${objectId} (unexplained SPHEREx moving object), from Driftnet.`,
    `# Built from a preliminary orbit fitted to the measured SPHEREx positions (orbit epoch MJD ${pred.orbit_epoch_mjd}); observer: ${pred.observer}.`,
    "# The uncertainty columns are the 1-sigma ellipse (semi-major, semi-minor, position angle east of north); search at least the 3-sigma region.",
    ...(pred.note_plain ? [`# ${pred.note_plain}`] : []),
    "# Not a confirmed object and not a discovery claim. Generated " + new Date().toISOString().slice(0, 19) + "Z.",
    "date_utc,ra_deg,dec_deg,ra_hms,dec_dms,sigma_major_arcsec,sigma_minor_arcsec,sigma_pa_deg,search_radius_3sigma_deg,v_mag_estimate",
  ];
  const body = rows.map((p) =>
    [
      p.time_utc.slice(0, 19) + "Z",
      p.ra_deg.toFixed(5),
      p.dec_deg.toFixed(5),
      raHms(p.ra_deg, 1),
      decDms(p.dec_deg, 0),
      p.sigma_major_arcsec.toFixed(1),
      p.sigma_minor_arcsec.toFixed(1),
      p.sigma_pa_deg.toFixed(1),
      ((3 * p.sigma_major_arcsec) / 3600).toFixed(3),
      p.vmag_estimate == null ? "" : p.vmag_estimate.toFixed(1),
    ].join(","),
  );
  return `${[...head, ...body].join("\n")}\n`;
}
