import { expect, openPage, test, type Route } from "./test-fixture";

test("privacy policy page renders the app shell and policy content", async ({ page }) => {
  await openPage(page, "/privacy-policy");

  await expect(
    page.getByRole("banner").getByRole("link", { name: "Quest home" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "16. Contact Us" })).toBeVisible();
});

test("contact page includes both TikTok accounts, Gmail, and the WhatsApp community", async ({ page }) => {
  await openPage(page, "/contact");

  await expect(page.getByRole("link", { name: "@senumii" })).toHaveAttribute(
    "href",
    "https://www.tiktok.com/@senumii"
  );
  await expect(
    page.getByRole("link", { name: "Quest E-sports TikTok (@questesports.lk)" })
  ).toHaveAttribute("href", "https://www.tiktok.com/@questesports.lk");
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
  await expect(footer.getByRole("link", { name: "Quest E-sports on TikTok (@questesports.lk)" })).toHaveAttribute(
    "href",
    "https://www.tiktok.com/@questesports.lk"
  );
  await expect(page.getByRole("link", { name: /Solo Player/ })).toHaveAttribute("href", "/join?type=solo_player");
  await expect(page.getByRole("link", { name: /Existing Team/ })).toHaveAttribute("href", "/join?type=existing_team");
  await expect(page.getByRole("link", { name: /Incomplete Team/ })).toHaveAttribute("href", "/join?type=incomplete_team");
});

test("mobile layout stays within the viewport and opens navigation without page shift", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, "/privacy-policy");

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

test("notifications stay grouped with the signed-in account on desktop and mobile", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      user: {
        id: "user-notifications",
        firstName: "Quest",
        lastName: "Player",
        email: "player@example.com",
        username: "questplayer",
        role: "user",
        emailVerified: true,
      },
    }),
  }));

  await openPage(page, "/privacy-policy");
  const usesDesktopMenu = (page.viewportSize()?.width || 0) >= 1024;

  if (usesDesktopMenu) {
    const accountButton = page.getByRole("button", { name: /questplayer/i });
    const notificationsButton = page.getByRole("button", { name: "0 unread notifications" });
    await expect(accountButton).toBeVisible();
    await expect(notificationsButton).toBeVisible();
    await notificationsButton.click();

    const notificationsPanel = page.getByText("Your latest updates").locator("../../..");
    await expect(notificationsPanel).toBeVisible();
    const accountBox = await accountButton.boundingBox();
    const panelBox = await notificationsPanel.boundingBox();
    expect(accountBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(Math.abs((accountBox?.x || 0) + (accountBox?.width || 0) - (panelBox?.x || 0) - (panelBox?.width || 0))).toBeLessThanOrEqual(2);

    await accountButton.click();
    await expect(notificationsPanel).toBeHidden();
    await expect(page.getByRole("link", { name: "Profile", exact: true })).toBeVisible();
  } else {
    await page.getByRole("banner").getByRole("button", { name: "Open navigation" }).click();
    const identity = page.getByRole("link", { name: /questplayer verified account/i });
    const notificationsButton = page.getByRole("button", { name: "0 unread notifications" });
    await expect(identity).toBeVisible();
    await expect(notificationsButton).toBeVisible();
    const identityBox = await identity.boundingBox();
    const notificationsBox = await notificationsButton.boundingBox();
    expect(identityBox).not.toBeNull();
    expect(notificationsBox).not.toBeNull();
    expect(notificationsBox?.y || 0).toBeGreaterThan((identityBox?.y || 0) + (identityBox?.height || 0));
    await notificationsButton.click();
    await expect(page.getByText("Your latest updates")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test("gallery album opens a full event photo inside a mobile viewport", async ({ page }) => {
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
  await page.route("**/api/event-albums/**/image*", fulfillTestImage);

  await openPage(page, "/gallery");
  const albumLink = page.getByRole("link", { name: /Open Mobile Test Album, 1 photos?/ });
  await expect(albumLink).toHaveAttribute("href", "/gallery/mobile-test", { timeout: 15_000 });
  await albumLink.click();
  await expect(page).toHaveURL(/\/gallery\/mobile-test$/);

  const photoButton = page.getByRole("button", { name: "Open photo 1 of 1" });
  const thumbnail = photoButton.locator("img");
  await expect(thumbnail).toHaveCSS("object-fit", "cover");
  await photoButton.click();

  const dialog = page.getByRole("dialog", { name: "Mobile Test Album photo viewer" });
  const previewImage = dialog.locator("img");
  await expect(dialog).toBeVisible();
  await expect(previewImage).toBeVisible();
  await expect(previewImage).toHaveCSS("object-fit", "contain");
  await expect(page).toHaveURL(/photo=photo-mobile-test/);

  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect((dialogBox?.y || 0) + (dialogBox?.height || 0)).toBeLessThanOrEqual(844);
  await page.getByRole("button", { name: "Close photo viewer" }).click();
  await expect(dialog).toBeHidden();
});

test("members page lists the named CODM leader without placeholder groups", async ({ page }) => {
  await openPage(page, "/members");
  await expect(page.getByRole("heading", { name: "Ayodhya “LIEBE” Janz" })).toBeVisible();
  await expect(page.getByText("CODM Wing Leader")).toBeVisible();
  await expect(page.getByText("To Be Determined")).toHaveCount(0);
});

test("refund policy publishes customized product and tournament fee terms", async ({ page }) => {
  await openPage(page, "/refund-policy");
  await expect(page.getByRole("heading", { name: "Refund & Return Policy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Customized merchandise" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tournament registration fees" })).toBeVisible();
  await expect(page.getByText(/non-refundable and non-exchangeable once production has begun/i)).toBeVisible();
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Refund Policy" })).toHaveAttribute("href", "/refund-policy");
});

test("production security policy permits only the configured PayHere form endpoints", async ({ page }) => {
  const response = await openPage(page, "/privacy-policy");
  const policy = response?.headers()["content-security-policy"] || "";
  expect(policy).toContain("form-action 'self' https://sandbox.payhere.lk https://www.payhere.lk");
  expect(policy).not.toContain("form-action *");
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toMatch(/script-src 'self' 'nonce-[^']+'/);
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(policy).toContain("frame-src 'self' https://challonge.com https://*.challonge.com");
  expect(policy).not.toContain("frame-src *");
});

test("Challonge public bracket is preloaded and reused without consuming REST requests", async ({ page }) => {
  let bracketRequests = 0;
  let moduleRequests = 0;
  await page.route("**/api/v1/tournaments/challonge-test/bracket", (route) => {
    bracketRequests += 1;
    return route.abort();
  });
  await page.route("https://challonge.com/quest-test/module", (route) => {
    moduleRequests += 1;
    return route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Quest Test bracket</title><p>Public bracket</p>",
    });
  });

  await openPage(page, "/tournaments/challonge-test");
  expect(bracketRequests).toBe(0);
  await expect(page.getByRole("heading", { name: "The tournament is over" })).toBeVisible();
  await expect(page.getByText("Quest Champions", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Final Boss", { exact: true })).toBeVisible();
  await expect(page.getByText("Third Wave", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const bracketFrame = page.locator("iframe");
  await expect(bracketFrame).toHaveAttribute("src", "https://challonge.com/quest-test/module");
  await expect(bracketFrame).toBeHidden();
  expect(moduleRequests).toBe(1);

  const bracketTab = page.getByRole("button", { name: "bracket", exact: true });
  await bracketTab.click();
  await expect(bracketTab).toHaveAttribute("aria-current", "page");
  await expect(bracketFrame).toBeVisible();
  await expect(page.getByRole("link", { name: "Open on Challonge" })).toHaveAttribute("href", "https://challonge.com/quest-test");

  await page.getByRole("button", { name: "overview", exact: true }).click();
  await expect(bracketFrame).toBeHidden();
  await bracketTab.click();
  await expect(bracketFrame).toBeVisible();
  expect(moduleRequests).toBe(1);
  expect(bracketRequests).toBe(0);
});

test("recruitment deep links initialize all supported application types", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ success: true, user: { id: "user-1", firstName: "Quest", lastName: "Player", email: "player@example.com", username: "questplayer", role: "user", emailVerified: true } }),
  }));
  for (const type of ["solo_player", "existing_team", "incomplete_team"]) {
    await openPage(page, `/join?type=${type}`);
    await expect(page.getByLabel("Application Type")).toHaveValue(type);
  }
});

test("legacy generic tournament registration page is removed", async ({ page }) => {
  const response = await openPage(page, "/tournament-registration");
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
  await openPage(page, "/shop/cart");
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

  await openPage(page, `/shop/order#token=${token}`);
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

  await openPage(page, "/privacy-policy");
  const desktopUserMenu = page.getByRole("button", { name: /questplayer/i });
  const usesDesktopMenu = (page.viewportSize()?.width || 0) >= 1024;
  if (usesDesktopMenu) {
    await expect(desktopUserMenu).toBeVisible();
    await desktopUserMenu.click();
  } else {
    await page.getByRole("banner").getByRole("button", { name: "Open navigation" }).click();
  }
  await page.getByRole("button", { name: "Logout" }).click();

  await expect(page.getByText("Logout did not complete")).toBeVisible();
  if (usesDesktopMenu) {
    await expect(desktopUserMenu).toBeVisible();
  } else {
    await expect(page.getByRole("link", { name: /questplayer/i })).toBeVisible();
  }
});

test("admin guard shows a retry state instead of redirecting when session lookup fails", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ success: false, message: "Session service unavailable." }),
  }));

  await openPage(page, "/admin");
  await expect(page.getByRole("heading", { name: "Admin access could not be checked" })).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("event album admin loads legacy poster tools once without a request loop", async ({ page }) => {
  let posterStudioRequests = 0;
  let imageLibraryRequests = 0;
  let deletedPosterEntries = 0;

  await page.route("**/api/me", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      user: {
        id: "admin-1",
        firstName: "Quest",
        lastName: "Admin",
        email: "admin@quest.test",
        username: "questadmin",
        role: "admin",
        emailVerified: true,
      },
    }),
  }));
  await page.route("**/api/admin/event-albums?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      albums: [],
      pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1 },
    }),
  }));
  await page.route("**/api/admin/tournaments?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ success: true, tournaments: [] }),
  }));
  await page.route("**/api/posters?**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("pageSize") === "18") posterStudioRequests += 1;
    const includeAdminArtwork = url.searchParams.get("pageSize") === "60";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        posters: includeAdminArtwork ? [{
          id: "poster-duplicate",
          title: "Duplicate artwork",
          imageAsset: {
            id: "asset-shared",
            title: "Shared artwork",
            originalName: "shared-artwork.jpg",
            category: "poster",
            contentType: "image/jpeg",
            createdAt: "2026-08-01T00:00:00.000Z",
            imageUrl: "/api/posters/poster-duplicate/image",
          },
          tournament: null,
        }] : [],
        pagination: { page: 1, pageSize: Number(url.searchParams.get("pageSize")), total: includeAdminArtwork ? 1 : 0, totalPages: 1 },
      }),
    });
  });
  await page.route("**/api/posters/poster-duplicate", (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deletedPosterEntries += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true }) });
  });
  await page.route("**/api/images?**", (route) => {
    imageLibraryRequests += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        images: [],
        pagination: { page: 1, pageSize: 60, total: 0, totalPages: 1 },
      }),
    });
  });

  await openPage(page, "/admin/event-albums");
  await expect(page.getByRole("heading", { name: "Event Albums" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create album" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Existing promotional artwork" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search promotional artwork" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Filter promotional artwork by assignment" })).toHaveValue("all");
  await page.getByRole("button", { name: "Delete entry" }).click();
  await expect(page.getByRole("button", { name: "Confirm delete" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect.poll(() => deletedPosterEntries).toBe(1);
  await expect(page.getByText("Duplicate artwork")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect.poll(() => posterStudioRequests).toBe(1);
  await expect.poll(() => imageLibraryRequests).toBe(1);
  await page.waitForTimeout(750);
  expect(posterStudioRequests).toBe(1);
  expect(imageLibraryRequests).toBe(1);
  await expect(page.getByText("Unable to load gallery")).toHaveCount(0);
});

test("mobile admin teams use contained cards with accessible navigation and actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/me", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      user: {
        id: "admin-1",
        firstName: "Quest",
        lastName: "Admin",
        email: "admin@quest.test",
        username: "questadmin",
        role: "admin",
        emailVerified: true,
      },
    }),
  }));
  await page.route("**/api/admin/teams?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      teams: [{
        id: "team-1",
        name: "Mobile Layout Champions",
        teamTag: "MLC",
        logoUrl: null,
        country: "Sri Lanka",
        organizationName: "Independent",
        captainName: "Long Captain Name",
        memberCount: 7,
        updatedAt: "2026-08-09T00:00:00.000Z",
      }],
      pagination: { page: 1, pageSize: 15, total: 1, totalPages: 1 },
    }),
  }));

  await openPage(page, "/admin/teams");
  await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open admin navigation" }).click();
  const adminNavigation = page.getByRole("dialog", { name: "Admin navigation" });
  await expect(adminNavigation).toBeVisible();
  await expect(adminNavigation.getByText("Workspace", { exact: true })).toBeVisible();
  await expect(page.locator("table")).toBeHidden();
  await expect(page.getByRole("button", { name: "View & edit" })).toBeVisible();

  const pageWidth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.scrollWidth).toBe(pageWidth.clientWidth);
});
