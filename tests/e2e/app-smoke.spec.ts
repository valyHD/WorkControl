import { expect, test } from "@playwright/test";

test("loads the public app shell without fatal JavaScript errors", async ({ page }) => {
  const pageErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto("/");

  await expect(page).toHaveTitle(/WorkControl/);
  await expect(page.getByRole("heading", { name: "WorkControl" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Login" })).toBeVisible();

  expect(pageErrors).toEqual([]);
});
