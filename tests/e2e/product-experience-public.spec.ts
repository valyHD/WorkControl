import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const viewports = [
  { name: "mobile-360", width: 360, height: 800 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1366, height: 768 },
  { name: "wide", width: 1920, height: 1080 },
];

test.describe("Product Experience public shell", () => {
  for (const viewport of viewports) {
    test(`login has no horizontal overflow at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/login");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });
  }

  test("login has no serious accessibility violations", async ({ page }) => {
    await page.goto("/login");
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((violation) =>
      violation.impact === "critical" || violation.impact === "serious"
    );
    expect(blocking).toEqual([]);
  });

  test("login visual baseline is stable on mobile and desktop", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await expect(page).toHaveScreenshot("login-mobile.png", { animations: "disabled", fullPage: true });

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/login");
    await expect(page).toHaveScreenshot("login-desktop.png", { animations: "disabled", fullPage: true });
  });
});
