import { expect, test } from "@playwright/test";
import { installMockApi } from "./support/mockApi";

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test("home explains what the project does and how, with real survey numbers", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Stars stay put\.\s*Asteroids don’t\./);
  // Numbers come from the published survey data, never placeholders.
  const ledger = page.locator("dl").first();
  await expect(ledger.getByText("SPHEREx images analyzed")).toBeVisible();
  await expect(ledger.locator("dd").first()).toHaveText(/^\d[\d,]*$/);

  await expect(page.getByRole("heading", { name: "Tombaugh's method, at SPHEREx scale" })).toBeVisible();
  for (const name of ["Find what moves", "Check it against what's known", "Show the evidence"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }

  const how = page.getByRole("region", { name: "From raw images to an evidence report" });
  await expect(how.getByRole("listitem")).toHaveCount(6);
  await expect(how.getByRole("heading", { name: "Check against JPL" })).toBeVisible();

  await expect(page.getByRole("link", { name: /Where we've searched/ })).toHaveAttribute("href", /\/sky\/?$/);
  await expect(page.getByRole("link", { name: /What we could miss/ })).toHaveAttribute("href", /\/limits\/?$/);
  await expect(page.getByText(/We're looking, not claiming/)).toBeVisible();
});

test("the hero blinks two real SPHEREx images, each traceable to its archive file", async ({ page }) => {
  await page.goto("/");
  const hero = page.getByRole("figure", { name: /circled dot/ });
  const a = hero.getByRole("img", { name: /SPHEREx infrared image A/ });
  await expect(a).toBeVisible();
  // It flips on its own, and the visitor can stop it.
  await expect(hero.getByRole("img", { name: /SPHEREx infrared image B/ })).toBeVisible({ timeout: 3000 });
  const pause = hero.getByRole("button", { name: "Pause blinking" });
  await pause.click();
  await expect(hero.getByRole("button", { name: "Resume blinking" })).toHaveAttribute("aria-pressed", "true");
  for (const key of ["A", "B"]) {
    await expect(hero.getByRole("link", { name: new RegExp(`^image ${key} `) })).toHaveAttribute("href", /nasa-irsa-spherex.*\.fits$/);
  }
  await expect(hero.getByRole("link", { name: "Blink all images of this patch" })).toHaveAttribute("href", /aquarius-a/);
});

test("with reduced motion the hero holds still until the visitor flips it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const hero = page.getByRole("figure", { name: /circled dot/ });
  await expect(hero.getByRole("img", { name: /SPHEREx infrared image A/ })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(hero.getByRole("img", { name: /SPHEREx infrared image A/ })).toBeVisible();
  await hero.getByRole("button", { name: "Show image B" }).click();
  await expect(hero.getByRole("img", { name: /SPHEREx infrared image B/ })).toBeVisible();
});
