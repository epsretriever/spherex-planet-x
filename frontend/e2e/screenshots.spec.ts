import { test } from "@playwright/test";
import { installMockApi, SYNTHETIC } from "./support/mockApi";

// Captures review screenshots when SCREENSHOT_DIR is set. Skipped otherwise.
const dir = process.env.SCREENSHOT_DIR;
const PAGES: [string, string][] = [
  ["landing", "/"],
  ["explore", "/explore/"],
  ["field", `/explore/field/?id=${SYNTHETIC.FIELD_ID}`],
  ["about", "/about/"],
  ["detective", "/detective/"],
  ["limits", "/limits/"],
  ["404", "/no-such-page/"],
  ["report-known", "/detective/candidate/?id=syn-known"],
  ["report-unmatched", "/detective/candidate/?id=syn-unmatched"],
];

test.describe("screenshots", () => {
  test.skip(!dir, "SCREENSHOT_DIR not set");
  for (const [name, path] of PAGES) {
    test(name, async ({ page }, info) => {
      await installMockApi(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/${info.project.name}-${name}.png`, fullPage: true });
    });
  }
});
