import { expect, test } from "@playwright/test";

test("privacy policy page renders the app shell and policy content", async ({ page }) => {
  await page.goto("/privacy-policy");

  await expect(
    page.getByRole("banner").getByRole("link", { name: "Quest home" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "16. Contact Us" })).toBeVisible();
});

test("contact page includes both TikTok accounts, Gmail, and the WhatsApp community", async ({ page }) => {
  await page.goto("/contact");

  await expect(page.getByRole("link", { name: "@senumii" })).toHaveAttribute(
    "href",
    "https://www.tiktok.com/@senumii"
  );
  await expect(
    page.getByRole("link", { name: "Quest E-sports TikTok (@questesportslk)" })
  ).toHaveAttribute("href", "https://www.tiktok.com/@questesportslk");
  await expect(page.getByRole("link", { name: "questesports.lk@gmail.com" }).first()).toHaveAttribute(
    "href",
    "mailto:questesports.lk@gmail.com"
  );
  await expect(
    page.getByRole("link", { name: "Join the Quest E-sports WhatsApp Community" })
  ).toHaveAttribute("href", "https://chat.whatsapp.com/G8XZXgYC4Ep1VYw1Zg5PIf");

  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "Email Quest E-sports" })).toHaveAttribute(
    "href",
    "mailto:questesports.lk@gmail.com"
  );
  await expect(
    footer.getByRole("link", { name: "Quest E-sports WhatsApp Community" })
  ).toHaveAttribute("href", "https://chat.whatsapp.com/G8XZXgYC4Ep1VYw1Zg5PIf");
  await expect(footer.getByRole("link", { name: "Senumi on TikTok" })).toHaveAttribute(
    "href",
    "https://www.tiktok.com/@senumii"
  );
  await expect(footer.getByRole("link", { name: "Quest E-sports on TikTok" })).toHaveAttribute(
    "href",
    "https://www.tiktok.com/@questesportslk"
  );
});

test("mobile layout stays within the viewport and opens navigation without page shift", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/privacy-policy");

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalOverflow).toBe(false);

  const menuButton = page.getByRole("banner").getByRole("button", { name: /navigation/ });
  await expect(async () => {
    if ((await menuButton.getAttribute("aria-expanded")) !== "true") {
      await menuButton.click();
    }
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  }).toPass();

  const mobileNavigation = page.getByRole("banner").getByRole("navigation");
  await expect(mobileNavigation).toBeVisible();
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  const navigationBox = await mobileNavigation.boundingBox();
  expect(navigationBox).not.toBeNull();
  expect((navigationBox?.x || 0) + (navigationBox?.width || 0)).toBeLessThanOrEqual(390);

  await menuButton.click();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("gallery poster preview fits the full image inside a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/posters*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Origin": "http://127.0.0.1:3000",
      },
      body: JSON.stringify({
        success: true,
        posters: [
          {
            id: "poster-appreciation",
            title: "VALORANT SHOWDOWN APPRECIATION POST",
            description: "",
            category: "poster",
            headline: "VALORANT SHOWDOWN APPRECIATION POST",
            subheadline: "",
            accentColor: "#7c3aed",
            textColor: "#ffffff",
            overlayAlign: "bottom-left",
            createdAt: "2026-07-10T00:00:00.000Z",
            updatedAt: "2026-07-10T00:00:00.000Z",
            imageAsset: {
              id: "image-appreciation",
              title: "VALORANT SHOWDOWN APPRECIATION POST",
              category: "poster",
              contentType: "image/png",
              createdAt: "2026-07-10T00:00:00.000Z",
              imageUrl: "/images/mainbg.png",
            },
          },
          {
            id: "poster-mobile-fit",
            title: "Mobile Fit Poster",
            description: "Full poster preview test",
            category: "poster",
            headline: "Mobile Fit Poster",
            subheadline: "",
            accentColor: "#7c3aed",
            textColor: "#ffffff",
            overlayAlign: "bottom-left",
            createdAt: "2026-07-10T00:00:00.000Z",
            updatedAt: "2026-07-10T00:00:00.000Z",
            imageAsset: {
              id: "image-mobile-fit",
              title: "Mobile Fit Poster",
              category: "poster",
              contentType: "image/png",
              createdAt: "2026-07-10T00:00:00.000Z",
              imageUrl: "/images/mainbg.png",
            },
          },
        ],
      }),
    });
  });

  await page.goto("/gallery");
  await expect(
    page.getByRole("link", { name: /VALORANT SHOWDOWN APPRECIATION POST/ }).first()
  ).toHaveAttribute(
    "href",
    "https://www.facebook.com/share/p/14gNLGrBLWF/?mibextid=wwXIfr"
  );
  await page.locator("main section button").first().click();

  const dialog = page.getByRole("dialog", { name: "Poster preview" });
  const previewImage = dialog.locator("img");
  await expect(dialog).toBeVisible();
  await expect(previewImage).toBeVisible();
  await expect(previewImage).toHaveCSS("object-fit", "contain");

  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect((dialogBox?.y || 0) + (dialogBox?.height || 0)).toBeLessThanOrEqual(844);
  expect(await dialog.evaluate((element) => element.scrollHeight)).toBe(
    await dialog.evaluate((element) => element.clientHeight)
  );
});
