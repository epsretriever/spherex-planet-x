import { expect, test } from "@playwright/test";
import { installMockApi, SYNTHETIC } from "./support/mockApi";

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test("injection study is found automatically and labeled SIMULATED", async ({ page }) => {
  await page.goto("/limits/");
  await expect(page.getByRole("note").filter({ hasText: "SIMULATED" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "What we found, by brightness and speed" })).toBeVisible();
  const cell = page.getByRole("button", { name: /AB 16\.0, 1″\/hr: 18 of 20 recovered/ });
  await cell.click();
  await expect(page.getByText("Recovered 18 of 20 planted objects", { exact: false })).toBeVisible();
  await expect(page.getByText("n/a", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /syn-injected/ })).toHaveAttribute("href", /syn-injected/);
});

test("study can be named in the URL", async ({ page }) => {
  await page.goto(`/limits/?study=${SYNTHETIC.STUDY_ID}`);
  await expect(page.getByText(`Study ${SYNTHETIC.STUDY_ID}`)).toBeVisible();
});

test("unknown study shows not found", async ({ page }) => {
  await page.goto("/limits/?study=nope");
  await expect(page.getByRole("alert").filter({ hasText: "couldn't find" })).toBeVisible();
});

test("the page leads with a plain summary and shows distance and planet context when provided", async ({ page }) => {
  await page.goto("/limits/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Where could Planet X still be hiding?");
  await expect(page.getByText(/our pipeline finds at least half of them down to magnitude/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "How far away can we see?" })).toBeVisible();
  const planet = page.getByRole("region", { name: "Planet brightness by distance" });
  await expect(planet.getByText("Could be missed")).toBeVisible();
  await expect(page.getByText("Thermal model")).toBeVisible();
});

test("old /simulated/ links forward to /limits/, keeping the study", async ({ page }) => {
  await page.goto(`/simulated/?study=${SYNTHETIC.STUDY_ID}`);
  await expect(page).toHaveURL(new RegExp(`/limits/\\?study=${SYNTHETIC.STUDY_ID}$`));
  await expect(page.getByText(`Study ${SYNTHETIC.STUDY_ID}`)).toBeVisible();
});
