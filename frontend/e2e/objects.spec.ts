import { expect, test } from "@playwright/test";
import { installMockApi } from "./support/mockApi";

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test("object list links to each object", async ({ page }) => {
  await page.goto("/objects/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every object we've tracked");
  await expect(page.getByRole("listitem").filter({ has: page.getByRole("link", { name: "(99999) Synthetic" }) })).toContainText("Main asteroid belt");
  await page.getByRole("link", { name: "(99999) Synthetic" }).click();
  await expect(page).toHaveURL(/\/objects\/(object\/\?id=)?obj-syn-known/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("(99999) Synthetic");
});

test("object with an orbit: visits, 3D orbit with uncertainty, elements, JPL check, distance", async ({ page }) => {
  await page.goto("/objects/object/?id=obj-syn-known");
  await expect(page.getByText(/Object ID\s*obj-syn-known/)).toBeVisible();

  const visits = page.getByRole("region", { name: "Tracked across visits" });
  await expect(visits.getByText(/^Visit \d$/)).toHaveCount(3);
  await expect(visits.getByRole("link", { name: "Evidence report" }).first()).toHaveAttribute("href", /syn-known/);

  const orbit = page.getByRole("region", { name: "Orbit" });
  await orbit.scrollIntoViewIfNeeded();
  await expect(orbit.getByText("Preliminary orbit", { exact: true })).toBeVisible();
  await expect(orbit.getByText("Synthetic: a main-belt orbit, roughly 2.7 AU from the Sun.")).toBeVisible();
  await expect(orbit.getByRole("note").filter({ hasText: "The elements below are one that fits, not a measurement" })).toBeVisible();
  await expect(orbit.getByText(/2\.55 AU\s*\(2\.31–2\.92, 90% of clones\)/)).toBeVisible();
  await expect(orbit.getByText(/possible orbits sampled from the orbit's uncertainty/)).toBeVisible();
  // The 3D view, or the flat view where WebGL isn't available.
  await expect(orbit.locator("canvas, svg[role=img]").first()).toBeVisible();
  await expect(orbit.getByRole("row", { name: /Semi-major axis a\s*2\.710 AU\s*0\.100/ })).toBeVisible();
  await expect(orbit.getByText(/Thirty days on, the two predict positions\s*14\.2″/)).toBeVisible();

  if (await orbit.getByRole("button", { name: "Show a flat view instead" }).isVisible()) {
    await orbit.getByRole("button", { name: "Show a flat view instead" }).click();
  }
  const flat = orbit.getByRole("img", { name: /Top-down view of the orbit of \(99999\) Synthetic/ });
  await expect(flat).toBeVisible();
  await expect(flat.getByText("Jupiter")).toBeAttached();

  const distance = page.getByRole("region", { name: "How far away" });
  await expect(distance.getByText("Main asteroid belt")).toBeVisible();
  await expect(distance.getByRole("img", { name: /Distance estimate 2\.60 AU, range 2\.10 to 3\.40 AU/ })).toBeVisible();

  const history = page.getByRole("region", { name: "History" });
  await expect(history).toContainText("Synthetic: linked 3 detections over 3 visits");
});

test("object without an orbit says why", async ({ page }) => {
  await page.goto("/objects/object/?id=obj-syn-unmatched");
  const orbit = page.getByRole("region", { name: "Orbit" });
  await expect(orbit.getByText(/^No orbit yet\. Working out an orbit needs sightings spread over more nights/)).toBeVisible();
  await expect(orbit.locator("canvas")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "How far away" }).getByText("No distance has been measured")).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: "not a discovery claim" })).toBeVisible();
});

test("unknown object shows not found", async ({ page }) => {
  await page.goto("/objects/object/?id=obj-nope");
  await expect(page.getByRole("alert").filter({ hasText: "couldn't find" })).toBeVisible();
});
