#!/usr/bin/env node
// Why are objects matched or not? Fetches every candidate report from the deployed API and
// summarizes its JPL known-object check: checked or not (and why), matched, and the nearest
// catalogued object with its separation. Writes Markdown to stdout (the GitHub Action
// appends it to the job summary) and JSON to jpl-report.json.
//
//   node scripts/jpl-report.mjs --base https://spherex-planet-x.bodhishanbhag.workers.dev
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const at = args.indexOf("--base");
const base = (at >= 0 && args[at + 1] ? args[at + 1] : "http://127.0.0.1:8787").replace(/\/$/, "");

async function get(path) {
  const res = await fetch(base + path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const list = await get("/api/candidates");
const rows = [];
for (const s of list.candidates) {
  const c = await get(`/api/candidates/${s.candidate_id}`);
  const k = c.known_object;
  rows.push({
    candidate_id: c.candidate_id,
    classification: c.classification,
    detections: c.detections.length,
    visits: new Set(c.detections.map((d) => Math.round(d.mjd * 48))).size,
    rate: c.motion.rate_arcsec_per_hr,
    checked: k.checked,
    enrichment: k.enrichment,
    matched: k.matched,
    designation: k.designation,
    predicted_vmag: k.predicted_vmag,
    nearest: k.nearest,
    reason: k.not_checked_reason,
    per_epoch_max_sep: k.per_epoch?.length ? Math.max(...k.per_epoch.map((p) => p.separation_arcsec ?? 0)) : null,
    per_epoch_n: k.per_epoch?.length ?? 0,
  });
}
writeFileSync("jpl-report.json", `${JSON.stringify(rows, null, 1)}\n`);

const count = (f) => rows.filter(f).length;
const lines = [
  `## JPL check of ${rows.length} candidates (${base})`,
  "",
  `- matched to a known object: ${count((r) => r.matched)}`,
  `- checked, no match: ${count((r) => r.checked && !r.matched)}`,
  `- not checked yet or failed: ${count((r) => !r.checked)}`,
  "",
  "| candidate | class | det | rate \"/h | checked | match | nearest | sep \" | reason |",
  "|---|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| ${r.candidate_id} | ${r.classification} | ${r.detections} | ${r.rate ?? ""} | ${r.checked} | ${r.designation ?? ""} | ${r.nearest?.designation ?? ""} | ${r.nearest?.separation_arcsec ?? ""} | ${(r.reason ?? "").slice(0, 80)} |`,
  ),
];
console.log(lines.join("\n"));
