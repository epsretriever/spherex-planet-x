import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Every page, at every width, on the real published data. Each test saves a full-page
 * screenshot (attached to the HTML report and kept under test-results-real/) and checks the
 * things a person would notice: a heading, nothing wider than the screen, no console errors.
 */

interface Ids {
  field: string;
  candidate: string;
}

let ids: Ids;

test.beforeAll(async ({ request }) => {
  const fields = await (await request.get("/api/fields")).json();
  const cands = await (await request.get("/api/candidates?include_injected=true")).json();
  expect(fields.fields.length, "the pipeline has published at least one field").toBeGreaterThan(0);
  expect(cands.candidates.length, "the pipeline has published at least one candidate").toBeGreaterThan(0);
  // Prefer the candidate with the most sightings: it's the longest report, the hardest layout.
  const longest = [...cands.candidates].sort((a, b) => b.detection_count - a.detection_count)[0];
  ids = { field: longest.field_id, candidate: longest.candidate_id };
});

function trackConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function widestOverflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    let worst = 0;
    let who = "";
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== "visible") {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right - vw > worst) {
        worst = r.right - vw;
        who = `${el.tagName}.${typeof el.className === "string" ? el.className : ""}`;
      }
    }
    return { worst: Math.round(worst), who };
  });
}

async function checkPage(page: Page, testInfo: TestInfo, path: string, name: string) {
  const errors = trackConsole(page);
  const res = await page.goto(path, { waitUntil: "networkidle" });
  expect(res, `${path} responded`).not.toBeNull();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Let images finish decoding and the layout settle.
  await page.waitForTimeout(500);
  const overflow = await widestOverflow(page);
  expect(overflow.worst, `content wider than the screen: ${overflow.who}`).toBeLessThanOrEqual(1);
  const file = `${name}-${testInfo.project.name}.png`;
  const shot = await page.screenshot({ fullPage: true, path: testInfo.outputPath(file) });
  await testInfo.attach(file, { body: shot, contentType: "image/png" });
  expect(errors, "console errors").toEqual([]);
  return page.evaluate(() => document.documentElement.scrollHeight);
}

test("home", async ({ page }, info) => {
  await checkPage(page, info, "/", "home");
});

test("explore list", async ({ page }, info) => {
  await checkPage(page, info, "/explore/", "explore");
  await expect(page.locator("main li").first()).toBeVisible();
});

test("explore field opens on the backend's default pair", async ({ page, request }, info) => {
  const field = await (await request.get(`/api/fields/${ids.field}`)).json();
  await checkPage(page, info, `/explore/${ids.field}/`, "field");
  await expect(page.getByRole("img", { name: /SPHEREx infrared image/ }).first()).toBeVisible();
  const def = field.blink_pairs.find((p: { default?: boolean }) => p.default) ?? field.blink_pairs[0];
  if (def) {
    const selected = await page.getByRole("combobox", { name: "Compare" }).evaluate((s: HTMLSelectElement) => s.value);
    const [a, b] = [def.epoch_id_a, def.epoch_id_b].sort();
    expect(selected.split(":").slice(1).sort()).toEqual([a, b]);
  }
});

test("detective list names every object", async ({ page }, info) => {
  await checkPage(page, info, "/detective/", "detective");
  const titles = await page.locator("main h2 a").allTextContents();
  expect(titles.length).toBeGreaterThan(0);
  for (const t of titles) expect(t, "cards are titled by object, not by status").not.toMatch(/^(Unexplained|Known asteroid|Known comet)$/);
});

test("evidence report", async ({ page }, info) => {
  const height = await checkPage(page, info, `/detective/${ids.candidate}/`, "report");
  const h1 = await page.getByRole("heading", { level: 1 }).textContent();
  expect(h1, "report titled by object").not.toMatch(/^(Unexplained|Known asteroid|Known comet)$/);
  await expect(page.getByText(new RegExp(`Pipeline ID\\s*${ids.candidate}`))).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /JPL/ }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Report sections" })).toBeVisible();
  // Long lists start collapsed so the page stays scannable on a phone.
  const showAll = page.getByRole("button", { name: /^Show all \d+ sightings$/ });
  if ((await showAll.count()) > 0) {
    await showAll.click();
    await expect(page.getByRole("button", { name: "Show fewer sightings" })).toBeVisible();
  }
  if (info.project.name === "phone-360") expect(height, "report height on a phone").toBeLessThan(10_000);
});

test("report section nav stays pinned while scrolling", async ({ page }) => {
  await page.goto(`/detective/${ids.candidate}/`, { waitUntil: "networkidle" });
  const nav = page.getByRole("navigation", { name: "Report sections" });
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(300);
  const box = await nav.boundingBox();
  expect(box && box.y >= -1 && box.y < 120, "section nav visible at the top after scrolling").toBe(true);
  await nav.getByRole("link", { name: "Measurements" }).click();
  await expect(nav.locator('[aria-current="true"]')).toHaveText("Measurements");
});

test("detection limits page", async ({ page }, info) => {
  await checkPage(page, info, "/simulated/", "simulated");
});

test("about", async ({ page }, info) => {
  await checkPage(page, info, "/about/", "about");
});

test("404", async ({ page }, info) => {
  const errors = trackConsole(page);
  const res = await page.goto("/no-such-page/");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page moved on.");
  const file = `404-${info.project.name}.png`;
  await info.attach(file, { body: await page.screenshot({ fullPage: true, path: info.outputPath(file) }), contentType: "image/png" });
  // The 404 response itself is logged by Chromium as a failed resource load; nothing else should be.
  expect(errors.filter((e) => !/404/.test(e))).toEqual([]);
});

test("object pages are prerendered with their content and title", async ({ request }) => {
  const fieldName = (await (await request.get(`/api/fields/${ids.field}`)).json()).name as string;
  const html = await (await request.get(`/detective/${ids.candidate}/`)).text();
  expect(html).toMatch(/<title>[^<]*(Moving object|Simulated object|\(?\d)/);
  expect(html).toContain(ids.candidate);
  const field = await (await request.get(`/explore/${ids.field}/`)).text();
  expect(field).toContain(fieldName);
});

test("the ?id= routes still load from the API", async ({ page }) => {
  await page.goto(`/detective/candidate/?id=${ids.candidate}`, { waitUntil: "networkidle" });
  await expect(page.getByText(new RegExp(`Pipeline ID\\s*${ids.candidate}`))).toBeVisible();
  await page.goto(`/explore/field/?id=${ids.field}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("img", { name: /SPHEREx infrared image/ }).first()).toBeVisible();
});

test("an unknown object path forwards to the API-backed route", async ({ page }) => {
  await page.goto("/detective/not-a-real-object/");
  await expect(page).toHaveURL(/\/detective\/candidate\/\?id=not-a-real-object$/);
  await expect(page.getByRole("alert").filter({ hasText: "couldn't find" })).toBeVisible();
});
