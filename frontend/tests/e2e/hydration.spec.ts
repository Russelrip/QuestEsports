import { expect, test } from "@playwright/test";

test("client navigation hydrates without browser errors", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().includes("/_next/")) {
      browserErrors.push(`${request.failure()?.errorText || "Request failed"}: ${request.url()}`);
    }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/privacy-policy");
  const menuButton = page.getByRole("banner").getByRole("button", { name: /navigation/ });
  await menuButton.click();
  expect(browserErrors).toEqual([]);
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
});
