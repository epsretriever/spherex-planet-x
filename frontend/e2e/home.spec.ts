import { expect, test } from "@playwright/test";
import { installMockApi } from "./support/mockApi";

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test("home explains what the project does and how, with real survey numbers", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Everything that moves\s*in the infrared sky\./);
  // Numbers come from the published survey data, never placeholders.
  const stats = page.locator("dl").first();
  await expect(stats.getByText("SPHEREx images analyzed")).toBeVisible();
  await expect(stats.locator("dd").first()).toHaveText(/^\d[\d,]*$/);

  await expect(page.getByRole("heading", { name: "A transparent search for moving objects, built on real data" })).toBeVisible();
  for (const name of ["Find", "Verify", "Explain"]) await expect(page.getByText(name, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "How it works ↓" }).click();
  await expect(page).toHaveURL(/#how$/);
  const how = page.getByRole("region", { name: "From raw images to an evidence report" });
  await expect(how.getByRole("listitem")).toHaveCount(6);
  await expect(how.getByRole("heading", { name: "Check against JPL" })).toBeVisible();

  await expect(page.getByRole("link", { name: /Where we've searched/ })).toHaveAttribute("href", /\/sky\/?$/);
  await expect(page.getByRole("link", { name: /What we could miss/ })).toHaveAttribute("href", /\/limits\/?$/);
  await expect(page.getByText(/We're looking, not claiming/)).toBeVisible();
});

test("the spacetime fabric is decorative and follows the pointer without blocking links", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("canvas[aria-hidden='true']").first();
  await expect(canvas).toBeAttached();
  const box = (await canvas.boundingBox())!;
  expect(box.width).toBeGreaterThan(300);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 8 });
  await page.waitForTimeout(500);
  // Canvas ignores the pointer, so the buttons over it still work.
  await page.getByRole("link", { name: "See the evidence" }).click();
  await expect(page).toHaveURL(/\/detective\/$/);
  expect(errors).toEqual([]);
});

test("with reduced motion the fabric is drawn once and left still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForTimeout(1500);
  const frames = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const c = document.querySelector("canvas") as HTMLCanvasElement;
        const first = c.toDataURL();
        setTimeout(() => resolve(c.toDataURL() === first ? 0 : 1), 600);
      }),
  );
  expect(frames).toBe(0);
});
