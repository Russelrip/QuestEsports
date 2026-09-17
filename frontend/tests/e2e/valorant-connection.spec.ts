import { expect, openPage, test, type Page } from "./test-fixture";

// SITE-94: connecting VALORANT has to be findable from the profile, and its
// state has to be readable without opening the Account tab.

const user = {
  id: "user-valorant",
  firstName: "Quest",
  lastName: "Player",
  email: "player@example.lk",
  username: "questplayer",
  role: "user",
  emailVerified: true,
  phone: null,
  discordTag: "questplayer",
  avatarUrl: null,
};

type GameAccountsFixture = { accounts: object[]; changeRequest: object | null };

const onLeaderboard = { riotId: "QT Russel#Senu", linkedToYou: false, linkedElsewhere: false, unclaimedRecord: false };

async function mockProfileApi(page: Page, gameAccounts: GameAccountsFixture, leaderboardRegistration: object | null = onLeaderboard) {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let payload: object;
    if (pathname === "/api/me") payload = { success: true, user };
    else if (pathname === "/api/me/dashboard") payload = { success: true, dashboard: { currentRegistrations: [], pastRegistrations: [], teams: [], recruitmentApplications: [], orders: [] } };
    else if (pathname === "/api/teams/profile") payload = { success: true, teams: [] };
    else if (pathname === "/api/v1/users/me/game-accounts") payload = { success: true, data: { playerPublicId: "QPID-000001", ...gameAccounts } };
    else if (pathname === "/api/v1/users/me/game-accounts/valorant/leaderboard-registration") {
      payload = {
        success: true,
        data: {
          discordConnected: true,
          unavailable: false,
          registration: leaderboardRegistration,
        },
      };
    } else return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false }) });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
  });
}

// Set VALORANT_CONNECTION_SCREENSHOTS to a directory to keep a picture of each
// state for review. Off by default: assertions, not pictures, are the test.
async function capture(page: Page, name: string) {
  const directory = process.env.VALORANT_CONNECTION_SCREENSHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png`, fullPage: false });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test("a player with nothing connected is sent straight to the leaderboard account", async ({ page }) => {
  await mockProfileApi(page, { accounts: [], changeRequest: null });
  await page.setViewportSize({ width: 375, height: 812 });
  await openPage(page, "/profile");

  // Visible on the default tab, not buried at the bottom of Account.
  await expect(page.getByText("Not connected")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await capture(page, "not-connected-header");
  await page.getByRole("button", { name: "Connect VALORANT" }).click();

  await expect(page.getByRole("tab", { name: "Account" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "VALORANT account" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Connect QT Russel#Senu" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(600);
  await capture(page, "not-connected-panel");
});

test("a player who has never registered gets the registration steps on the profile", async ({ page }) => {
  await mockProfileApi(page, { accounts: [], changeRequest: null }, null);
  await page.setViewportSize({ width: 320, height: 568 });
  await openPage(page, "/profile?tab=account#valorant-account");

  // The fixture user has no Discord connected, so the steps start there.
  await expect(page.getByRole("heading", { name: "Connect Your Discord Account" })).toBeVisible();
  await expect(page.getByText("PUUID", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Riot ID")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  // The profile card clips what overflows it, so the page check alone would
  // miss a panel wider than its card.
  await expect.poll(() => page.locator("#valorant-account").evaluate((panel) => panel.scrollWidth <= panel.clientWidth)).toBe(true);
  await page.getByRole("heading", { name: "Connect Your Discord Account" }).scrollIntoViewIfNeeded();
  await capture(page, "registration-steps");
});

test("the old registration address sends players to the profile", async ({ page }) => {
  await mockProfileApi(page, { accounts: [], changeRequest: null }, null);
  await openPage(page, "/valorant-leaderboard/register");
  await expect(page).toHaveURL(/\/profile\?tab=account/);
});

test("a pending change is readable from the header and withdrawable in the panel", async ({ page }) => {
  await mockProfileApi(page, {
    accounts: [{
      id: "account-1",
      game: "valorant",
      username: "QT Russel",
      tagline: "Senu",
      region: "ap",
      verificationStatus: "discord_corroborated",
      status: "change_requested",
      linkedAt: "2026-09-01T00:00:00.000Z",
      verifiedAt: null,
      lastSyncedAt: null,
    }],
    changeRequest: {
      id: "request-1",
      status: "pending",
      requestedIdentity: "QuestMainAccountWithAVeryLongName#0001",
      reason: "Lost access to my old Riot account",
      adminNote: null,
      requestedAt: "2026-09-15T00:00:00.000Z",
      reviewedAt: null,
    },
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await openPage(page, "/profile?tab=account#valorant-account");

  await expect(page.getByRole("heading", { name: "VALORANT account" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Withdraw request" })).toBeVisible();
  const requested = page.getByText("QuestMainAccountWithAVeryLongName#0001", { exact: true });
  await expect(requested).toBeVisible();
  // A long Riot ID wraps inside its card rather than being clipped by it.
  const [requestedRight, cardRight] = await Promise.all([
    requested.evaluate((element) => element.getBoundingClientRect().right),
    page.locator("#valorant-account article").evaluate((element) => element.getBoundingClientRect().right),
  ]);
  expect(requestedRight).toBeLessThanOrEqual(cardRight);
  await expect(page.getByRole("button", { name: "Change account" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Withdraw request" }).scrollIntoViewIfNeeded();
  await capture(page, "pending-panel");

  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("button", { name: "View request" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(400);
  await capture(page, "pending-header");
});
