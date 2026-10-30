import { expect, test } from "@playwright/test";
import { installMockApi, SYNTHETIC } from "./support/mockApi";

// Nothing on any page may be wider than the viewport (body hides overflow, so measure content).
const PAGES = [
  "/",
  "/explore/",
  `/explore/field/?id=${SYNTHETIC.FIELD_ID}`,
  "/detective/",
  "/detective/candidate/?id=syn-known",
  "/detective/candidate/?id=syn-unmatched",
  "/detective/candidate/?id=syn-injected",
  "/about/",
  "/limits/",
  "/no-such-page/",
];

for (const path of PAGES) {
  test(`no content wider than the viewport: ${path}`, async ({ page }) => {
    await installMockApi(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const widest = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      let worst = 0;
      let who = "";
      for (const el of Array.from(document.querySelectorAll("main *"))) {
        // Content inside a clipping or scrolling ancestor can't widen the page.
        let clipped = false;
        for (let a = el.parentElement; a && a.tagName !== "MAIN"; a = a.parentElement) {
          if (getComputedStyle(a).overflowX !== "visible") {
            clipped = true;
            break;
          }
        }
        if (clipped) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const over = r.right - vw;
        if (over > worst) {
          worst = over;
          who = `${el.tagName}.${el.className}`;
        }
      }
      return { worst: Math.round(worst), who };
    });
    expect(widest.worst, widest.who).toBeLessThanOrEqual(1);
  });
}
