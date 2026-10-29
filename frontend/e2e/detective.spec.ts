import { expect, test } from "@playwright/test";
import { installMockApi } from "./support/mockApi";

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test("candidate list hides simulated objects until asked", async ({ page }) => {
  await page.goto("/detective/");
  await expect(page.getByRole("link", { name: "Synthetic known object" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Synthetic unexplained mover" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Synthetic injected object" })).toHaveCount(0);
  const sim = page.getByLabel("Show SIMULATED test objects");
  await sim.click();
  await expect(sim).toBeChecked();
  await expect(page.getByRole("link", { name: "Synthetic injected object" })).toBeVisible();
  await expect(page).toHaveURL(/sim=1/);
});

test("classification filter narrows the list", async ({ page }) => {
  await page.goto("/detective/");
  await page.getByRole("button", { name: /Unexplained/ }).click();
  await expect(page.getByRole("link", { name: "Synthetic known object" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Synthetic unexplained mover" })).toBeVisible();
});

test("evidence report for an unexplained candidate", async ({ page }) => {
  await page.goto("/detective/");
  await page.getByRole("link", { name: "Synthetic unexplained mover" }).click();
  await expect(page).toHaveURL(/\/detective\/candidate\/\?id=syn-unmatched/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Synthetic unexplained mover");
  await expect(page.getByRole("note").filter({ hasText: "not a discovery claim" })).toBeVisible();
  await expect(page.getByText("No match.", { exact: false })).toBeVisible();
  await expect(page.getByText("Template text from the measurements")).toBeVisible();
  // Grounded numbers link to the values they came from; the unresolvable path is dropped.
  await expect(page.locator('a[href^="#ground-"]')).toHaveCount(4);
  await expect(page.getByText("motion.missing_field")).toHaveCount(0);
  await expect(page.getByRole("region", { name: /Measurements per sighting/ }).getByRole("row")).toHaveCount(4);
  await expect(page.getByText(/rule-based ranking/).first()).toBeVisible();
  await expect(page.getByText(/probability/).first()).toBeVisible();
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, document.querySelector("main")!.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("known object shows predicted positions", async ({ page }) => {
  await page.goto("/detective/candidate/?id=syn-known");
  await expect(page.getByText(/Yes: matches \(99999\) Synthetic/)).toBeVisible();
  await expect(page.getByText(/dashed white circles mark where JPL predicted/)).toBeVisible();
});

test("injected candidate is labeled SIMULATED everywhere", async ({ page }) => {
  await page.goto("/detective/candidate/?id=syn-injected");
  await expect(page.getByRole("note").filter({ hasText: "SIMULATED" }).first()).toBeVisible();
  await expect(page.getByText("What we planted vs. what we found")).toBeVisible();
});

test("stamp source opens the provenance drawer", async ({ page }) => {
  await page.goto("/detective/candidate/?id=syn-known");
  await page.getByRole("button", { name: "Source", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: /Sighting 1: source/ })).toContainText("SYNTHETIC_TEST_t1.fits");
});

test("unknown candidate shows not found", async ({ page }) => {
  await page.goto("/detective/candidate/?id=does-not-exist");
  await expect(page.getByRole("alert").filter({ hasText: "couldn't find" })).toBeVisible();
});
