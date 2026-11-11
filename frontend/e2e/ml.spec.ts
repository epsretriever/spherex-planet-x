import { expect, test } from "@playwright/test";
import { installMockApi } from "./support/mockApi";

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test("report shows the model score beside the rule-based one, and saliency over the stamps", async ({ page }) => {
  await page.goto("/detective/candidate/?id=syn-unmatched");
  const quality = page.getByRole("region", { name: "Signal quality" });
  await quality.scrollIntoViewIfNeeded();
  await expect(quality.getByText("rule-based ranking")).toBeVisible();
  const model = quality.getByTestId("model-score");
  await expect(model).toContainText("87% chance this is a real object");
  await expect(model).toContainText("synthetic-cnn-0");

  await page.getByRole("heading", { name: "Each sighting up close" }).scrollIntoViewIfNeeded();
  await expect(page.getByText("model 91% real")).toBeVisible();
  const toggle = page.getByLabel("Show where the model looked");
  await expect(page.locator("img[src*='saliency_']")).toHaveCount(0);
  await toggle.check();
  await expect(page.locator("img[src*='saliency_']")).toHaveCount(3);
  await expect(page.getByText(/occlusion map/)).toBeVisible();
});

test("report explains why an object is unusual and gives orbit odds", async ({ page }) => {
  await page.goto("/detective/candidate/?id=syn-unmatched");
  const nav = page.getByRole("navigation", { name: "Report sections" });
  await expect(nav.getByRole("link", { name: "Unusual" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Orbit odds" })).toBeVisible();

  const unusual = page.getByRole("region", { name: "How unusual is it?" });
  await unusual.scrollIntoViewIfNeeded();
  await expect(unusual.getByText(/^Synthetic reason: moving 7× slower/)).toBeVisible();
  await expect(unusual.getByRole("row", { name: /Speed \(log10 of ″\/hr\)\s*0\.62\s*1\.48/ })).toBeVisible();
  await expect(unusual.getByRole("row", { name: /Colour across bands\s*—/ })).toBeVisible();

  const neo = page.getByRole("region", { name: "Could it come near Earth?" });
  await expect(neo.getByRole("img", { name: "Near-Earth 5%, Main belt 15%, Outer solar system 80%" })).toBeVisible();
  await expect(neo.getByText(/On 42 objects JPL has identified, the most likely class was right 81% of the time/)).toBeVisible();
});

test("reports without model data don't show the new sections", async ({ page }) => {
  await page.goto("/detective/candidate/?id=syn-known");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("model-score")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "How unusual is it?" })).toHaveCount(0);
  await expect(page.getByLabel("Show where the model looked")).toHaveCount(0);
});

test("detective list sorts by most unusual with reasons", async ({ page }) => {
  await page.goto("/detective/");
  await expect(page.getByRole("link", { name: "(99999) Synthetic" })).toBeVisible();
  await page.getByLabel("Sort").selectOption("unusual");
  await expect(page).toHaveURL(/sort=unusual/);
  const cards = page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });
  await expect(cards.first()).toContainText("Synthetic reason: moving 7× slower");
  await expect(page.getByRole("button", { name: "Remove filter: Sorted: most unusual" })).toBeVisible();
});
