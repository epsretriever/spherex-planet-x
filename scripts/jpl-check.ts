// Check every published candidate against JPL's catalog of known asteroids and comets, on a
// machine that can wait for JPL (a GitHub runner), and write the result into the published
// candidate files.
//
// The Worker runs the same check (worker/src/enrich.ts) after a visitor opens a report, but it
// has about 30 seconds per lookup, and JPL SBIdent often takes longer or refuses several
// queries at once, so most lookups ended as "not checked". This script runs the Worker's own
// matching code with JPL queries one at a time, a 2-minute timeout and retries, so the
// published data arrives already checked. A candidate JPL still does not answer for is left as
// it was (never called unmatched without a check).
//
//   npx vite-node scripts/jpl-check.ts -- frontend/public/data [--recheck-days 7]
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CandidateDetail, Classification, FieldDetail } from "../worker/src/contract";

type Mover = { candidate_id: string; classification: Classification; label_plain: string };
import { enrichKnownObject } from "../worker/src/enrich";
import type { Deps } from "../worker/src/env";
import { applyKnownObject, labelPlain } from "../worker/src/text";

const args = process.argv.slice(2).filter((a) => a !== "--");
const dataDir = args.find((a) => !a.startsWith("--")) ?? "frontend/public/data";
const rd = args.indexOf("--recheck-days");
const recheckDays = rd >= 0 ? Number(args[rd + 1]) : 7;

const TIMEOUT_MS = 120_000;
const RETRIES = 2;
const UA = "spherex-planet-x/0.1 (+https://github.com/epsretriever/spherex-planet-x)";

// One JPL request at a time: SBIdent answers concurrent requests from one client slowly or not
// at all. The Worker's own timeouts (its AbortSignal) are replaced by TIMEOUT_MS here.
let queue: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function patientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const run = async () => {
    let last: unknown;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        const res = await fetch(input, {
          ...init,
          headers: { ...(init?.headers as Record<string, string>), "User-Agent": UA },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.status !== 503 && res.status !== 429) return res;
        last = new Error(`HTTP ${res.status}`);
      } catch (err) {
        last = err;
      }
      await sleep(5_000 * 2 ** attempt);
    }
    throw last;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

const deps: Deps = {
  fetch: patientFetch as typeof fetch,
  cache: null,
  kv: null,
  db: null,
  budget: { remaining: Number.POSITIVE_INFINITY },
  waitUntil: () => undefined,
  now: () => new Date(),
};

const dir = join(dataDir, "candidates");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const counts = { matched: 0, no_match: 0, not_answered: 0, skipped: 0 };
const rows: string[] = [];
const fresh = Date.now() - recheckDays * 86_400_000;
for (const f of files) {
  const path = join(dir, f);
  const cand = JSON.parse(readFileSync(path, "utf8")) as CandidateDetail;
  const k = cand.known_object;
  if (cand.classification === "injected" || (k.checked && k.query_utc && Date.parse(k.query_utc) > fresh)) {
    counts.skipped += 1;
    if (cand.classification !== "injected") updateMover(cand); // labels written before movers were kept in step
    continue;
  }
  const t0 = Date.now();
  const e = await enrichKnownObject(deps, cand);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (!e.known_object.checked) {
    counts.not_answered += 1;
    rows.push(`| ${cand.candidate_id} | not answered | | ${e.known_object.not_checked_reason ?? ""} | ${secs} s |`);
    continue;
  }
  const next = applyKnownObject(cand, { ...e.known_object, enrichment: "static" }, e.matched, deps.now().toISOString());
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  updateMover(next);
  if (e.matched) counts.matched += 1;
  else counts.no_match += 1;
  const near = e.known_object.nearest ? `${e.known_object.nearest.designation} at ${e.known_object.nearest.separation_arcsec}″` : "";
  rows.push(`| ${cand.candidate_id} | ${e.matched ? "matched" : "no match"} | ${e.known_object.designation ?? near} | | ${secs} s |`);
}

/** The field's mover for this candidate carries the same label as the candidate list. */
function updateMover(cand: CandidateDetail) {
  const fieldPath = join(dataDir, "fields", `${cand.field_id}.json`);
  if (!existsSync(fieldPath)) return;
  const field = JSON.parse(readFileSync(fieldPath, "utf8")) as FieldDetail;
  const movers = ((field as { movers?: Mover[] }).movers ?? []);
  const m = movers.find((x) => x.candidate_id === cand.candidate_id);
  if (!m || (m.classification === cand.classification && m.label_plain === labelPlain(cand))) return;
  m.classification = cand.classification;
  m.label_plain = labelPlain(cand);
  writeFileSync(fieldPath, `${JSON.stringify(field, null, 2)}\n`);
}

// Totals over every published candidate, after this run.
const totals = { real: 0, checked: 0, matched: 0 };
for (const f of files) {
  const c = JSON.parse(readFileSync(join(dir, f), "utf8")) as CandidateDetail;
  if (c.classification === "injected") continue;
  totals.real += 1;
  if (c.known_object.checked) totals.checked += 1;
  if (c.known_object.checked && c.known_object.matched) totals.matched += 1;
}

console.log(
  [
    `## JPL check of ${files.length} published candidates`,
    "",
    `- now checked: ${totals.checked} of ${totals.real} (${totals.matched} matched to a known asteroid or comet)`,
    `- this run, matched to a known asteroid or comet: ${counts.matched}`,
    `- checked, no catalogued object within ${15}″ at every detection: ${counts.no_match}`,
    `- JPL did not answer (left unchanged, retried next run): ${counts.not_answered}`,
    `- skipped (injected, or checked in the last ${recheckDays} days): ${counts.skipped}`,
    "",
    "| candidate | result | object | reason | time |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n"),
);
