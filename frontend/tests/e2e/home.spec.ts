import { expect, test } from "@playwright/test";

test("privacy policy page renders the app shell and policy content", async ({ page }) => {
  await page.goto("/privacy-policy");

  await expect(
    page.getByRole("banner").getByRole("link", { name: "Quest home" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "16. Contact Us" })).toBeVisible();
});

test("mobile layout stays within the viewport and opens navigation without page shift", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/privacy-policy");

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.getByRole("button", { name: "Open navigation" }).click();
  const mobileNavigation = page.getByRole("navigation").first();
  await expect(mobileNavigation).toBeVisible();
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  const navigationBox = await mobileNavigation.boundingBox();
  expect(navigationBox).not.toBeNull();
  expect((navigationBox?.x || 0) + (navigationBox?.width || 0)).toBeLessThanOrEqual(390);

  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
});
