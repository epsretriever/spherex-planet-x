#!/usr/bin/env node
// Record real API responses into shared/fixtures/ for the frontend and the contract tests.
//
//   node scripts/record-fixtures.mjs                  # from `npx wrangler dev` on :8787
//   node scripts/record-fixtures.mjs --base https://spherex-planet-x.bodhishanbhag.workers.dev
//
// Every file is a byte-for-byte API response (pretty-printed), never hand-edited. Recording from
// production captures live JPL known-object results; a local `wrangler dev` without JPL access
// records `known_object.enrichment: "pending"`. Each run writes shared/fixtures/manifest.json
// with the source URL, time and HTTP status of every response.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "shared", "fixtures");
const args = process.argv.slice(2);
const at = args.indexOf("--base");
const base = (at >= 0 && args[at + 1] ? args[at + 1] : "http://127.0.0.1:8787").replace(/\/$/, "");

async function get(path) {
  const res = await fetch(base + path, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${path}: not JSON (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return { status: res.status, body };
}

const manifest = { recorded_utc: new Date().toISOString(), base, files: {} };
function save(name, path, rec) {
  writeFileSync(join(out, name), `${JSON.stringify(rec.body, null, 2)}\n`);
  manifest.files[name] = { path, status: rec.status };
  console.log(`${name}  <-  ${path}`);
}

mkdirSync(out, { recursive: true });
const fields = await get("/api/fields");
save("fields.json", "/api/fields", fields);

// The richest field and candidate: most movers, then most detections.
const fieldIds = fields.body.fields.map((f) => f.field_id);
const details = await Promise.all(fieldIds.map((id) => get(`/api/fields/${id}`)));
const best = details.reduce((a, b) =>
  b.body.movers.length > a.body.movers.length ||
  (b.body.movers.length === a.body.movers.length && b.body.epochs.length > a.body.epochs.length)
    ? b
    : a,
);
save("field_detail.json", `/api/fields/${best.body.field_id}`, best);

const cands = await get("/api/candidates?include_injected=true");
save("candidates.json", "/api/candidates?include_injected=true", cands);
const real = cands.body.candidates.filter((c) => c.classification !== "injected");
if (real.length > 0) {
  const top = real.reduce((a, b) => (b.detection_count > a.detection_count ? b : a));
  save("candidate_detail.json", `/api/candidates/${top.candidate_id}`, await get(`/api/candidates/${top.candidate_id}`));
}

const objects = await get("/api/objects");
save("objects.json", "/api/objects", objects);
if (objects.body.objects.length > 0) {
  const top = objects.body.objects.reduce((a, b) => (b.n_detections > a.n_detections ? b : a));
  save("object_detail.json", `/api/objects/${top.object_id}`, await get(`/api/objects/${top.object_id}`));
}
save("survey.json", "/api/survey", await get("/api/survey"));

const health = await get("/api/health");
save("health.json", "/api/health", health);

// Injection studies are listed by the static data when present.
try {
  const studies = await get("/api/injection");
  const first = studies.body.studies?.[0]?.study_id;
  if (first) save("injection_study.json", `/api/injection/${first}`, await get(`/api/injection/${first}`));
} catch {
  console.log("no injection study published yet");
}

writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`recorded ${Object.keys(manifest.files).length} responses from ${base}`);
