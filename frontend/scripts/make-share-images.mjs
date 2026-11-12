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

// The hero's plate: a real SPHEREx image of the Aquarius showcase patch, with the mover circled.
const plate = `data:image/webp;base64,${readFileSync(join(root, "public/data/fields/aquarius-a/e01.webp")).toString("base64")}`;
const field = JSON.parse(readFileSync(join(root, "public/data/fields/aquarius-a.json"), "utf8"));
const H = field.wcs.height_px;
const at = (id) => {
  const t = field.movers[0].track.find((p) => p.epoch_id === id);
  return { x: t.x_grid - 0.5, y: H - t.y_grid + 0.5 };
};
const pair = field.blink_pairs.find((p) => p.default);
const now = at(pair.epoch_id_a);
const later = at(pair.epoch_id_b);
const archivo = font("archivo", "archivo-latin-wdth-wght-normal.woff2");

const og = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Archivo; src: ${archivo}; font-weight: 100 900; font-stretch: 62% 125%; }
html, body { margin: 0; width: 1200px; height: 630px; }
body { box-sizing: border-box; padding: 64px 72px; color: #f2f5f9; font-family: Archivo; background: #102a4c;
  display: grid; grid-template-columns: 1fr 420px; gap: 56px; align-items: center; }
.brand { display: flex; align-items: center; gap: 14px; font-size: 34px; font-weight: 700; font-stretch: 112%; }
.brand svg { width: 52px; height: 52px; }
h1 { font-size: 66px; line-height: 1; letter-spacing: -.025em; margin: 48px 0 0; white-space: nowrap; font-weight: 700; font-stretch: 115%; }
h1 span { display: block; }
p { margin: 28px 0 0; font-size: 25px; line-height: 1.35; color: #a9bcd6; max-width: 26em; }
.plate { position: relative; width: 420px; height: 420px; outline: 2px solid #2e5180; outline-offset: 10px; background: #0b1f3a; }
.plate img, .plate svg { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
</style></head><body>
<div><div class="brand">${icon}<span>${name}</span></div>
<h1><span>Stars stay put.</span><span>Asteroids don’t.</span></h1><p>${tagline}</p></div>
<div class="plate"><img src="${plate}" alt=""><svg viewBox="0 0 ${field.wcs.width_px} ${H}">
<line x1="${now.x}" y1="${now.y}" x2="${later.x}" y2="${later.y}" stroke="#7cf0c8" stroke-width="1" stroke-dasharray="1 4" opacity=".7"/>
<circle cx="${later.x}" cy="${later.y}" r="8" fill="none" stroke="#7cf0c8" stroke-width="1.2" stroke-dasharray="3 3" opacity=".7"/>
<circle cx="${now.x}" cy="${now.y}" r="8" fill="none" stroke="#7cf0c8" stroke-width="2"/></svg></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(og, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(root, "public/og.png") });

await page.setViewportSize({ width: 180, height: 180 });
await page.setContent(`<html><body style="margin:0;background:#102a4c">${icon.replace("<svg ", '<svg width="180" height="180" ')}</body></html>`);
await page.screenshot({ path: join(root, "src/app/apple-icon.png") });
await browser.close();
console.log("wrote public/og.png and src/app/apple-icon.png");
