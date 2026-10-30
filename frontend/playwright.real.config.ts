import { defineConfig, devices } from "@playwright/test";

/**
 * Visual QA on REAL data: the static export plus the Worker, run locally with `wrangler dev`
 * from the repository root, serving the pipeline's published files in public/data/.
 * Build first (`npm run build` at the root), then `npm run test:real` here.
 */
const PORT = Number(process.env.REAL_PORT ?? 8788);

export default defineConfig({
  testDir: "./e2e-real",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never", outputFolder: "playwright-report-real" }]] : "list",
  outputDir: "test-results-real",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    reducedMotion: "reduce",
  },
  projects: [
    { name: "phone-360", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
  ],
  webServer: {
    command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1`,
    cwd: "..",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
