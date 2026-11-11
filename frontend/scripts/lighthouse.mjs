// Lighthouse quality gate on real data.
//
// Starts (or reuses) `wrangler dev --env offline` (no Workers AI, which needs credentials) from the repository root, runs Lighthouse with its default
// mobile settings (CPU slowdown calibrated to this machine, see below) on Home, an Explore field
// an evidence report, the sky map, the object list and the comparison page (median of LH_RUNS runs,
// default 5: single runs on shared CI machines swing by ten points), writes HTML and JSON reports to
// lighthouse-reports/, and exits non-zero if performance, accessibility or best practices
// scores below 90 on any of them. Build first: `npm run build` at the repository root.
//
//   npm run lighthouse            # uses Playwright's Chromium unless CHROME_PATH is set
//   LH_BASE=https://… npm run lighthouse   # audit a deployed site instead
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.REAL_PORT ?? 8788);
const MIN = Number(process.env.LH_MIN ?? 90);
// Lighthouse CI's default: score each page on the median of several runs, since single runs vary.
const RUNS = Number(process.env.LH_RUNS ?? 5);
const CATEGORIES = ["performance", "accessibility", "best-practices"];
let base = process.env.LH_BASE?.replace(/\/+$/, "");

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

let server;
if (!base) {
  base = `http://127.0.0.1:${PORT}`;
  if (!(await waitFor(`${base}/api/health`, 1000))) {
    server = spawn("npx", ["wrangler", "dev", "--env", "offline", "--port", String(PORT), "--ip", "127.0.0.1"], {
      cwd: join(root, ".."),
      stdio: "ignore",
      detached: true,
    });
    if (!(await waitFor(`${base}/api/health`, 120_000))) throw new Error("wrangler dev did not start");
  }
}

const fields = await (await fetch(`${base}/api/fields`)).json();
const cands = await (await fetch(`${base}/api/candidates`)).json();
const pages = [
  ["home", "/"],
  ["explore-field", `/explore/${fields.fields[0].field_id}/`],
  ["report", `/objects/obj-${[...cands.candidates].sort((a, b) => b.detection_count - a.detection_count)[0].candidate_id}/`],
  ["sky", "/sky/"],
  ["objects", "/objects/"],
  ["leads", "/objects/?view=leads"],
  ["compare", "/objects/compare/"],
];

const chrome = await chromeLauncher.launch({
  chromePath: process.env.CHROME_PATH ?? chromium.executablePath(),
  chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
});

// Lighthouse emulates a mid-range phone by slowing this machine's CPU 4×, which assumes a
// fast desktop (benchmark index ~1500). On slower machines such as CI runners that overstates
// the phone's CPU cost, so calibrate the slowdown to the same target device (benchmark ~375),
// as Lighthouse's throttling docs recommend. Never throttle less than 1× or more than 4×.
// LH_CPU overrides the calibration.
const TARGET_BENCHMARK = 375;
let cpuSlowdown = Number(process.env.LH_CPU) || 0;
let benchmark = null;
if (!cpuSlowdown) {
  const probe = await lighthouse(`${base}/`, { port: chrome.port, logLevel: "error", onlyCategories: ["performance"] });
  benchmark = probe.lhr.environment.benchmarkIndex;
  cpuSlowdown = Math.min(4, Math.max(1, Math.round((benchmark / TARGET_BENCHMARK) * 10) / 10));
}
console.log(`CPU slowdown ${cpuSlowdown}×${benchmark ? ` (this machine's benchmark index ${Math.round(benchmark)})` : " (LH_CPU)"}\n`);

const outDir = join(root, "lighthouse-reports");
mkdirSync(outDir, { recursive: true });
const failures = [];
try {
  for (const [name, path] of pages) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const result = await lighthouse(`${base}${path}`, {
        port: chrome.port,
        output: ["html", "json"],
        logLevel: "error",
        onlyCategories: CATEGORIES,
        throttling: { cpuSlowdownMultiplier: cpuSlowdown },
      });
      runs.push(result);
    }
    // Median by performance score; keep that run's report.
    runs.sort((a, b) => (a.lhr.categories.performance?.score ?? 0) - (b.lhr.categories.performance?.score ?? 0));
    const result = runs[Math.floor(runs.length / 2)];
    const [html, json] = result.report;
    writeFileSync(join(outDir, `${name}.html`), html);
    writeFileSync(join(outDir, `${name}.json`), json);
    const scores = CATEGORIES.map((c) => [c, Math.round((result.lhr.categories[c]?.score ?? 0) * 100)]);
    const a = result.lhr.audits;
    const metrics = ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"]
      .map((m) => `${m.replace(/-/g, " ")} ${a[m]?.displayValue ?? "?"}`)
      .join(", ");
    const perfRuns = runs.map((r) => Math.round((r.lhr.categories.performance?.score ?? 0) * 100)).join("/");
    console.log(`${name.padEnd(14)} ${scores.map(([c, s]) => `${c} ${s}`).join("  ")}  (performance runs ${perfRuns})\n               ${metrics}`);
    for (const [c, s] of scores) if (s < MIN) failures.push(`${name}: ${c} ${s} < ${MIN}`);
  }
} finally {
  await chrome.kill();
  if (server) process.kill(-server.pid);
}

if (failures.length) {
  console.error(`\nLighthouse below ${MIN}:\n  ${failures.join("\n  ")}\nReports: ${outDir}`);
  process.exit(1);
}
console.log(`\nAll pages ≥ ${MIN}. Reports: ${outDir}`);
