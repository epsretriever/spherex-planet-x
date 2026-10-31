import { expect, test } from "@playwright/test";
import { installMockApi, SYNTHETIC } from "./support/mockApi";

test("sky map shows searched tiles, totals and the sourced region", async ({ page }) => {
  await installMockApi(page);
  await page.goto("/sky/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Where we've searched");
  await expect(page.getByText("Synthetic survey for tests.", { exact: false })).toBeVisible();
  const map = page.getByRole("group", { name: "All-sky map in equatorial coordinates" });
  await expect(map).toBeVisible();
  // The searched tile links to its field; the waiting one does not.
  const tile = map.getByRole("link", { name: /Synthetic test field: searched, 3 images, 3 moving objects, half of simulated objects found down to magnitude 19\.4/ });
  await expect(tile).toBeVisible();
  await expect(map.getByRole("img", { name: /synthetic-pending-tile: waiting to be searched/ })).toBeAttached();
  await expect(page.getByText("Most likely Planet Nine positions (68%)")).toBeVisible();
  await expect(page.getByRole("link", { name: "SYNTHETIC test region (not a real prediction)" })).toHaveAttribute("href", "https://example.invalid/synthetic-region");
  await expect(page.getByText(/not a detection/)).toBeVisible();
  // 0.5 + 0.3 make the 68% region; the last cell completes 95%.
  await expect(map.locator("path[class*=p9Inner]")).toHaveCount(2);
  await expect(map.locator("path[class*=p9Outer]")).toHaveCount(1);

  const row = page.getByRole("row", { name: /Synthetic test field/ });
  await expect(row).toContainText("Searched");
  await expect(row).toContainText("19.4");
  await expect(page.getByRole("row", { name: /synthetic-pending-tile/ })).toContainText("not measured");
  await expect(page.getByText("under 0.001% of the whole sky")).toBeVisible();

  await tile.click();
  await expect(page).toHaveURL(new RegExp(`/explore/field/\\?id=${SYNTHETIC.FIELD_ID}|/explore/${SYNTHETIC.FIELD_ID}/`));
});

test("a region without a citation is not drawn", async ({ page }) => {
  await installMockApi(page, { surveyWithoutCitation: true });
  await page.goto("/sky/");
  await expect(page.getByRole("row", { name: /Synthetic test field/ })).toBeVisible();
  await expect(page.locator("path[class*=p9]")).toHaveCount(0);
  await expect(page.getByText(/Planet Nine/)).toHaveCount(0);
});

test("sky map is in the navigation", async ({ page }) => {
  await installMockApi(page);
  await page.goto("/");
  const nav = page.getByRole("navigation").first();
  const link = nav.getByRole("link", { name: "Sky map" });
  if (await link.isVisible()) {
    await link.click();
  } else {
    await page.getByRole("button", { name: /menu/i }).click();
    await page.locator("header").getByRole("link", { name: /Sky map/ }).click();
  }
  await expect(page).toHaveURL(/\/sky\/$/);
});
