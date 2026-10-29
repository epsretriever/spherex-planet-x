import { expect, test } from "@playwright/test";
import { installMockApi, SYNTHETIC } from "./support/mockApi";

test("unknown paths get the 404 page", async ({ page }) => {
  const res = await page.goto("/no-such-page/");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page moved on.");
  await page.getByRole("link", { name: /Explore the sky/ }).click();
  await expect(page).toHaveURL(/\/explore\/$/);
});

test("favicon and share metadata are present", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("SPHEREx Planet X Explorer");
  await expect(page.locator('link[rel="icon"][href*="icon.svg"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "SPHEREx Planet X Explorer");
  const og = await page.request.get("/og.png");
  expect(og.ok()).toBe(true);
});

test("pages show shaped skeletons while data loads", async ({ page }) => {
  await installMockApi(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/fields/**", async (route) => {
    await gate;
    await route.fallback();
  });
  await page.goto(`/explore/field/?id=${SYNTHETIC.FIELD_ID}`);
  await expect(page.getByRole("status").filter({ hasText: "Loading this patch of sky" })).toBeAttached();
  release();
  await expect(page.getByRole("heading", { level: 1, name: "Synthetic test field" })).toBeVisible();
});
