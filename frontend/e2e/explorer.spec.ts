import { expect, test } from "@playwright/test";
import { installMockApi, SYNTHETIC } from "./support/mockApi";

async function expectNoHorizontalScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, document.querySelector("main")!.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test("landing page leads into the explorer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The sky moves.");
  await expect(page.getByRole("link", { name: "Synthetic test field" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("link", { name: /Explore the sky/ }).click();
  await expect(page).toHaveURL(/\/explore\/$/);
});

test("field picker opens the blink viewer", async ({ page }) => {
  await page.goto("/explore/");
  await page.getByRole("link", { name: "Synthetic test field" }).click();
  await expect(page).toHaveURL(new RegExp(`/explore/field/\\?id=${SYNTHETIC.FIELD_ID}`));
  await expect(page.getByRole("heading", { level: 1, name: "Synthetic test field" })).toBeVisible();
  // Defaults to the wavelength-matched pair.
  await expect(page.getByText("Same wavelength.")).toBeVisible();
  await expect(page.getByRole("img", { name: /SPHEREx infrared image A/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("blink, swipe and step controls work", async ({ page }) => {
  await page.goto(`/explore/field/?id=${SYNTHETIC.FIELD_ID}`);
  const pause = page.getByRole("button", { name: /Pause/ });
  await expect(pause).toBeVisible();
  await pause.click();
  await expect(page.getByRole("button", { name: /Play/ })).toBeVisible();

  await page.getByRole("radio", { name: "Swipe" }).click();
  await expect(page.getByRole("slider", { name: "Divider position" })).toBeVisible();

  await page.getByRole("radio", { name: "Step" }).click();
  await page.getByRole("button", { name: "Next date" }).click();
  await expect(page.getByText(/Showing image B/)).toBeAttached();

  await page.getByRole("combobox", { name: "Compare" }).selectOption({ index: 1 });
  await expect(page.getByText("Different wavelengths: brightness changes are expected")).toBeVisible();
});

test("show what moved, then open a mover", async ({ page }) => {
  await page.goto(`/explore/field/?id=${SYNTHETIC.FIELD_ID}`);
  await page.getByRole("button", { name: "Show me what moved" }).click();
  await expect(page.getByText(/2 moving objects circled/)).toBeVisible();
  await page.getByRole("button", { name: /Moving object B in \w+, Unexplained: Synthetic unexplained mover/ }).click();
  const sheet = page.getByRole("dialog", { name: /Moving object B in / });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link", { name: /See the full evidence/ })).toHaveAttribute(
    "href",
    "/detective/candidate/?id=syn-unmatched",
  );
});

test("provenance drawer shows the source file", async ({ page }) => {
  await page.goto(`/explore/field/?id=${SYNTHETIC.FIELD_ID}`);
  await page.getByRole("button", { name: "Source for image A" }).click();
  const drawer = page.getByRole("dialog", { name: /Image A: source/ });
  await expect(drawer).toContainText("SYNTHETIC_TEST_t1.fits");
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();
});

test("API failure shows a friendly error, not data", async ({ page }) => {
  await page.unrouteAll();
  await installMockApi(page, { failWith: 503 });
  await page.goto(`/explore/field/?id=${SYNTHETIC.FIELD_ID}`);
  await expect(page.getByRole("alert").filter({ hasText: "sky data" })).toContainText("We can't reach the sky data right now");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("an unpublished field list reads as empty, not broken", async ({ page }) => {
  await page.unrouteAll();
  await installMockApi(page, { failWith: 404 });
  await page.goto("/explore/");
  await expect(page.getByRole("heading", { name: "No patches of sky yet" })).toBeVisible();
});
