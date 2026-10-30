import { expect, test, type Page } from "@playwright/test";
import { installMockApi } from "./support/mockApi";

/** The write-up loads when the reader nears it; scroll there. */
async function toExplanation(page: Page) {
  await page.getByRole("heading", { name: "In plain words" }).scrollIntoViewIfNeeded();
}

test.describe("with the AI endpoints", () => {
  test.beforeEach(async ({ page }) => {
    await installMockApi(page, { ai: true });
  });

  test("the write-up replaces the template text, with linked numbers and the model", async ({ page }) => {
    await page.goto("/detective/candidate/?id=syn-unmatched");
    await toExplanation(page);
    const panel = page.getByRole("region", { name: "In plain words" });
    await expect(panel.getByText("AI-written from the measurements below")).toBeVisible();
    await expect(panel.getByText(/^Synthetic verdict/)).toBeVisible();
    await expect(panel.getByText(/^Synthetic paragraph (one|two|three)/)).toHaveCount(3);
    await expect(panel.getByText("@synthetic/test-model")).toBeVisible();
    // 3 in verdict + paragraph one, 26.4, 30.1.
    await expect(panel.locator('a[href^="#ground-"]')).toHaveCount(4);
    await panel.getByRole("link", { name: "30.1" }).click();
    await expect(page.locator("#ground-2")).toBeVisible();
    await expect(page.locator("#ground-2")).toContainText("motion.rate_arcsec_per_hr");
  });

  test("ask answers with citations that link to the report", async ({ page }) => {
    await page.goto("/detective/candidate/?id=syn-unmatched");
    await toExplanation(page);
    const ask = page.getByRole("region", { name: "Ask about this object" });
    await expect(ask).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Report sections" }).getByRole("link", { name: "Ask" })).toBeVisible();

    await ask.getByRole("button", { name: "How fast is it moving?" }).click();
    await expect(ask.getByText("Synthetic answer: it moved")).toBeVisible();
    const cites = ask.getByRole("list", { name: "Values this answer used" });
    await expect(cites.getByRole("link", { name: /Speed \(″\/hr\)\s*30\.1/ })).toHaveAttribute("href", "#motion");
    await expect(cites.getByRole("link", { name: /Sighting 1 signal-to-noise/ })).toHaveAttribute("href", "#measurements");
    await expect(ask.getByText("Answered by")).toContainText("@synthetic/test-model");

    await ask.getByLabel("Your question about this object").fill("What colour is it?");
    await ask.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(ask.getByText("The data doesn't tell us", { exact: true })).toBeVisible();
    await expect(ask.getByText("You asked:", { exact: false })).toHaveCount(2);
  });

  test("search by description applies editable chips", async ({ page }) => {
    await page.goto("/detective/");
    await expect(page.getByRole("link", { name: "(99999) Synthetic" })).toBeVisible();
    await page.getByRole("searchbox").fill("slow unexplained things");
    await page.getByRole("button", { name: "Search", exact: true }).click();

    await expect(page.getByText(/^Synthetic reading:/)).toBeVisible();
    await expect(page).toHaveURL(/class=unmatched/);
    await expect(page).toHaveURL(/rmax=10/);
    await expect(page).toHaveURL(/sort=rate/);
    await expect(page.getByRole("link", { name: "(99999) Synthetic" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Moving object B in / })).toBeVisible();
    // The chips match the controls, which stay editable.
    await expect(page.getByRole("button", { name: "Remove filter: Unexplained" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove filter: Slower than 10″/hr" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Unexplained/, pressed: true })).toBeVisible();
    await expect(page.getByLabel("Fastest, arcseconds per hour")).toHaveValue("10");

    await page.getByRole("button", { name: "Remove filter: Unexplained" }).click();
    await expect(page).not.toHaveURL(/class=unmatched/);
    // Still slower than 10″/hr: only the slow one.
    await expect(page.getByRole("link", { name: "(99999) Synthetic" })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(page.getByRole("link", { name: "(99999) Synthetic" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove filter/ })).toHaveCount(0);
  });

  test("a search the AI can't turn into a filter changes nothing", async ({ page }) => {
    await page.goto("/detective/");
    await page.getByRole("searchbox").fill("gibberish");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("Synthetic: that didn't make a filter.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove filter/ })).toHaveCount(0);
  });
});

test("a rate-limited question shows the API's message", async ({ page }) => {
  await installMockApi(page, { ai: true, askStatus: 429 });
  await page.goto("/detective/candidate/?id=syn-known");
  await toExplanation(page);
  const ask = page.getByRole("region", { name: "Ask about this object" });
  await ask.getByRole("button", { name: "Could it be a glitch?" }).click();
  await expect(ask.getByText("Synthetic 429 detail.")).toBeVisible();
});

test.describe("without the AI endpoints", () => {
  test.beforeEach(async ({ page }) => {
    await installMockApi(page);
  });

  test("the report keeps its own explanation and has no chat", async ({ page }) => {
    await page.goto("/detective/candidate/?id=syn-unmatched");
    await toExplanation(page);
    await expect(page.getByText("Template text from the measurements")).toBeVisible();
    await expect(page.getByRole("region", { name: "Ask about this object" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Report sections" }).getByRole("link", { name: "Ask" })).toHaveCount(0);
  });

  test("search says it's off and the filters still work", async ({ page }) => {
    await page.goto("/detective/");
    await page.getByRole("searchbox").fill("slow ones");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText(/isn't switched on right now/)).toBeVisible();
    await page.getByLabel("Fastest, arcseconds per hour").fill("10");
    await page.getByLabel("Fastest, arcseconds per hour").press("Enter");
    await expect(page.getByRole("button", { name: "Remove filter: Slower than 10″/hr" })).toBeVisible();
    await expect(page.getByRole("link", { name: "(99999) Synthetic" })).toHaveCount(0);
  });

  test("distance filter uses the objects list", async ({ page }) => {
    await page.goto("/detective/?dist=main_belt");
    await expect(page.getByRole("button", { name: "Remove filter: Main asteroid belt" })).toBeVisible();
    await expect(page.getByRole("link", { name: "(99999) Synthetic" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Moving object B in / })).toHaveCount(0);
  });
});
