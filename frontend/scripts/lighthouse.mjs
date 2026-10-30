// Lighthouse quality gate on real data.
//
// Starts (or reuses) `wrangler dev` from the repository root, runs Lighthouse with its default
// mobile settings on Home, an Explore field and an evidence report (median of LH_RUNS runs,
// default 3), writes HTML and JSON reports to
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
const RUNS = Number(process.env.LH_RUNS ?? 3);
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
    server = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1"], {
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
  ["explore-field", `/explore/field/?id=${fields.fields[0].field_id}`],
  ["report", `/detective/candidate/?id=${[...cands.candidates].sort((a, b) => b.detection_count - a.detection_count)[0].candidate_id}`],
];

const chrome = await chromeLauncher.launch({
  chromePath: process.env.CHROME_PATH ?? chromium.executablePath(),
  chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
});

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
        // For local experiments only: emulate a slower machine (CI keeps Lighthouse's default 4×).
        ...(process.env.LH_CPU ? { throttling: { cpuSlowdownMultiplier: Number(process.env.LH_CPU) } } : {}),
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
