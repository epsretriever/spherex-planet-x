// Renders the social-share image (public/og.png, 1200×630) and the Apple
// touch icon (src/app/apple-icon.png, 180×180) with the pre-installed
// Chromium. Run after changing the brand: `node scripts/make-share-images.mjs`.
// The images are committed; the build doesn't run this.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = readFileSync(join(root, "src/lib/site.ts"), "utf8");
const name = site.match(/SITE_NAME = "([^"]+)"/)[1];
const tagline = site.match(/SITE_TAGLINE = "([^"]+)"/)[1];
const icon = readFileSync(join(root, "src/app/icon.svg"), "utf8");
// setContent pages can't load file:// URLs, so fonts are inlined.
const font = (_family, file) => `url(data:font/woff2;base64,${readFileSync(join(root, "src/fonts", file)).toString("base64")})`;

// The same 102-channel diagram as the landing page: six detectors × 17 channels.
const stops = ["#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d"];
const ramp = (t) => {
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const ch = (h, k) => parseInt(h.slice(1 + 2 * k, 3 + 2 * k), 16);
  const m = (k) => Math.round(ch(stops[i], k) + (ch(stops[i + 1], k) - ch(stops[i], k)) * f);
  return `rgb(${m(0)},${m(1)},${m(2)})`;
};
const bars = Array.from({ length: 6 }, (_, d) =>
  `<div class="det">${Array.from({ length: 17 }, (_, k) => `<span style="background:${ramp((d * 17 + k) / 101)}"></span>`).join("")}</div>`,
).join("");

const og = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Display; src: ${font("space-grotesk", "space-grotesk-latin-wght-normal.woff2")}; }
@font-face { font-family: Body; src: ${font("inter", "inter-latin-wght-normal.woff2")}; }
@font-face { font-family: Mono; src: ${font("jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2")}; }
html, body { margin: 0; width: 1200px; height: 630px; }
body { box-sizing: border-box; padding: 72px 80px; color: #f3eef9; font-family: Body;
  background: radial-gradient(700px 400px at 85% 10%, rgba(237,105,37,.22), transparent 70%),
              radial-gradient(600px 500px at 0% 0%, rgba(120,28,109,.45), transparent 70%), #08060d;
  display: flex; flex-direction: column; justify-content: space-between; }
.brand { display: flex; align-items: center; gap: 18px; font-family: Display; font-size: 34px; font-weight: 600; }
.brand svg { width: 56px; height: 56px; }
h1 { font-family: Display; font-size: 92px; line-height: .98; letter-spacing: -.03em; margin: 0; font-weight: 650; }
h1 span { background: linear-gradient(90deg,#f7d13d,#ed6925 45%,#a52c60); -webkit-background-clip: text; color: transparent; }
p { margin: 18px 0 0; font-size: 28px; color: #aa9fbd; }
.strip { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; height: 70px; }
.det { display: grid; grid-template-columns: repeat(17, 1fr); gap: 2px; }
.det span { border-radius: 1px; }
.axis { display: flex; justify-content: space-between; font-family: Mono; font-size: 18px; color: #aa9fbd; margin-top: 10px; }
</style></head><body>
<div class="brand">${icon}<span>${name}</span></div>
<div><h1>The sky moves.<br><span>Catch it in the act.</span></h1><p>${tagline}</p></div>
<div><div class="strip">${bars}</div><div class="axis"><span>0.75 µm</span><span>102 infrared channels · NASA SPHEREx</span><span>5.0 µm</span></div></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(og, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(root, "public/og.png") });

await page.setViewportSize({ width: 180, height: 180 });
await page.setContent(`<html><body style="margin:0;background:#08060d">${icon.replace("<svg ", '<svg width="180" height="180" ')}</body></html>`);
await page.screenshot({ path: join(root, "src/app/apple-icon.png") });
await browser.close();
console.log("wrote public/og.png and src/app/apple-icon.png");
