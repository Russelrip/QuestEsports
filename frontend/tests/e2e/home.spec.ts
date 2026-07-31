import { expect, test, type Route } from "@playwright/test";

test("homepage presents the foundation sections in event-priority order", async ({ page }) => {
  await page.goto("/");
  const headings = await page.locator("main h2").allTextContents();
  expect(headings).toEqual([
    "Next match",
    "Registration status",
    "Featured tournaments",
    "Recent results",
    "Upcoming matches",
    "Featured competitors",
    "Match videos",
    "Sponsors",
    "Your next tournament starts here.",
  ]);
  await expect(page.getByText("Live match data is temporarily unavailable", { exact: false })).toBeVisible();
  await expect(page.getByText("No registration window is open right now", { exact: false })).toBeVisible();
});

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
  await expect(page.getByRole("link", { name: /Solo Player/ })).toHaveAttribute("href", "/join?type=solo_player");
  await expect(page.getByRole("link", { name: /Existing Team/ })).toHaveAttribute("href", "/join?type=existing_team");
  await expect(page.getByRole("link", { name: /Incomplete Team/ })).toHaveAttribute("href", "/join?type=incomplete_team");
});

test("mobile layout stays within the viewport and opens navigation without page shift", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/privacy-policy");

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 900);
    document.documentElement.style.scrollBehavior = "";
  });
  const scrollPosition = await page.evaluate(() => window.scrollY);
  expect(scrollPosition).toBeGreaterThan(0);

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
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollPosition);

  const navigationBox = await mobileNavigation.boundingBox();
  expect(navigationBox).not.toBeNull();
  expect(navigationBox?.y || 0).toBeGreaterThanOrEqual(0);
  expect((navigationBox?.x || 0) + (navigationBox?.width || 0)).toBeLessThanOrEqual(390);

  await menuButton.click();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollPosition);
});

test("gallery poster preview fits the full image inside a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fulfillTestImage = (route: Route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      ),
    });
  await page.route("**/_next/image**", fulfillTestImage);
  await page.route("**/api/uploads/**", fulfillTestImage);
  await page.route("**/api/posters*", async (route) => {
    const requestOrigin = route.request().headers()["origin"] || new URL(page.url()).origin;
    await route.fulfill({
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Origin": requestOrigin,
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
              originalName: "opensemis1.jpg",
              contentType: "image/png",
              createdAt: "2026-07-10T00:00:00.000Z",
              imageUrl: "/api/uploads/poster-images/missing.jpg",
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
    "https://www.facebook.com/share/p/14gNLGrBLWF/?mibextid=wwXIfr",
    { timeout: 15_000 }
  );
  await expect(page.getByText("Selected capture")).toHaveCount(0);
  const posterButton = page.locator("main section button").filter({ has: page.locator("img") }).first();
  const posterImage = posterButton.locator("img");
  await expect(posterImage).toHaveCSS("object-fit", "contain");
  await posterButton.click();

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

test("members page lists the named CODM leader without placeholder groups", async ({ page }) => {
  await page.goto("/members");
  await expect(page.getByRole("heading", { name: "Ayodhya “LIEBE” Janz" })).toBeVisible();
  await expect(page.getByText("CODM Wing Leader")).toBeVisible();
  await expect(page.getByText("To Be Determined")).toHaveCount(0);
});

test("refund policy publishes customized product and tournament fee terms", async ({ page }) => {
  await page.goto("/refund-policy");
  await expect(page.getByRole("heading", { name: "Refund & Return Policy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Customized merchandise" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tournament registration fees" })).toBeVisible();
  await expect(page.getByText(/non-refundable and non-exchangeable once production has begun/i)).toBeVisible();
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Refund Policy" })).toHaveAttribute("href", "/refund-policy");
});

test("production security policy permits only the configured PayHere form endpoints", async ({ page }) => {
  const response = await page.goto("/privacy-policy");
  const policy = response?.headers()["content-security-policy"] || "";
  expect(policy).toContain("form-action 'self' https://sandbox.payhere.lk https://www.payhere.lk");
  expect(policy).not.toContain("form-action *");
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toMatch(/script-src 'self' 'nonce-[^']+'/);
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(policy).toContain("frame-src https://challonge.com https://*.challonge.com");
});

test("recruitment deep links initialize all supported application types", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ success: true, user: { id: "user-1", firstName: "Quest", lastName: "Player", email: "player@example.com", username: "questplayer", role: "user", emailVerified: true } }),
  }));
  for (const type of ["solo_player", "existing_team", "incomplete_team"]) {
    await page.goto(`/join?type=${type}`);
    await expect(page.getByLabel("Application Type")).toHaveValue(type);
  }
});

test("legacy generic tournament registration page is removed", async ({ page }) => {
  const response = await page.goto("/tournament-registration");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("combobox", { name: /tournament/i })).toHaveCount(0);
});

test("cart uses a server quote and clearly disables checkout without PayHere", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("quest-merch-cart", JSON.stringify({
      state: {
        items: [{
          variantId: "variant-1",
          productId: "product-1",
          productSlug: "quest-shirt",
          productName: "Quest Shirt",
          variantName: "Small",
          currency: "LKR",
          unitPrice: 1,
          imageUrl: null,
          quantity: 2,
        }],
      },
      version: 0,
    }));
  });
  await page.route("**/api/commerce/capabilities", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ success: true, capabilities: { paymentsAvailable: false, provider: null, shopCheckoutAvailable: false } }),
  }));
  await page.route("**/api/orders/quote", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ success: true, quote: { currency: "LKR", subtotal: 7000, deliveryFee: 500, total: 7500, items: [] } }),
  }));
  await page.goto("/shop/cart");
  await expect(page.getByText("Total LKR 7500.00")).toBeVisible();
  await expect(page.getByText(/no order or stock reservation has been created/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Online payment unavailable" })).toBeDisabled();
});

test("private order status keeps the capability in the fragment and API header", async ({ page }) => {
  const token = "a".repeat(48);
  const apiRequests: Array<{ url: string; token?: string }> = [];

  await page.route("**/api/orders/status", (route) => {
    apiRequests.push({
      url: route.request().url(),
      token: route.request().headers()["x-order-token"],
    });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        order: {
          id: "order-1",
          publicToken: token,
          status: "paid",
          currency: "LKR",
          subtotal: 7000,
          deliveryFee: 500,
          total: 7500,
          createdAt: "2026-07-29T00:00:00.000Z",
          paymentOrderId: "payment-1",
          paymentStatus: "paid",
          items: [{
            id: "item-1",
            productName: "Quest Shirt",
            variantName: "Small",
            sku: "QUEST-S",
            unitPrice: 7000,
            quantity: 1,
            lineTotal: 7000,
          }],
        },
      }),
    });
  });
  await page.route("**/api/payments/payment-1", (route) => {
    apiRequests.push({
      url: route.request().url(),
      token: route.request().headers()["x-order-token"],
    });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        payment: {
          orderId: "payment-1",
          status: "paid",
          amount: 7500,
          currency: "LKR",
          purpose: "merchandise_order",
          provider: "payhere",
        },
      }),
    });
  });

  await page.goto(`/shop/order#token=${token}`);
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order summary" })).toBeVisible();
  await expect(page.getByText("Total LKR 7500.00")).toBeVisible();
  expect(apiRequests).toHaveLength(2);
  for (const request of apiRequests) {
    expect(request.token).toBe(token);
    expect(request.url).not.toContain(token);
  }
  await expect(page).toHaveURL(new RegExp(`#token=${token}$`));
});

test("failed logout keeps the authenticated UI and warns that the server session may remain active", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      user: {
        id: "user-1",
        firstName: "Quest",
        lastName: "Player",
        email: "player@example.com",
        username: "questplayer",
        role: "user",
        emailVerified: true,
      },
    }),
  }));
  await page.route("**/api/logout", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ success: false, message: "Logout failed." }),
  }));

  await page.goto("/privacy-policy");
  await page.getByRole("button", { name: /questplayer/i }).click();
  await page.getByRole("button", { name: "Logout" }).click();

  await expect(page.getByText("Logout did not complete")).toBeVisible();
  await expect(page.getByRole("button", { name: /questplayer/i })).toBeVisible();
});

test("admin guard shows a retry state instead of redirecting when session lookup fails", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ success: false, message: "Session service unavailable." }),
  }));

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin access could not be checked" })).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
