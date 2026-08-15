import { expect, openPage, test, type Page } from "./test-fixture";

const longText = "QuestPlayerWithAnExtremelyLongCompetitiveIdentityThatMustWrapWithoutBreakingTheViewport";
const user = {
  id: "user-mobile",
  firstName: longText,
  lastName: "Champion",
  email: `${longText}@example-esports-community.lk`,
  username: longText,
  role: "admin",
  emailVerified: true,
  phone: "+94770000000",
  discordTag: `${longText}#1234`,
  avatarUrl: "/api/uploads/avatars/mobile-test.png",
};
const team = {
  id: "team-mobile",
  name: `${longText} International Championship Roster`,
  country: "Sri Lanka",
  teamTag: "QUESTLONG",
  organizationRequested: false,
  organizationName: "",
  logoName: null,
  logoUrl: null,
  isCaptain: true,
  registrationCount: 1,
  canDelete: true,
  captainName: longText,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-31T00:00:00Z",
  members: [{ id: "member-1", role: "PLAYER", memberOrder: 1, name: longText, email: `${longText}@members.example`, discord: longText, riotId: longText, inviteStatus: "accepted" }],
};

async function mockProfileApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let payload: object;
    if (pathname === "/api/me") payload = { success: true, user };
    else if (pathname === "/api/me/dashboard") payload = { success: true, dashboard: { currentRegistrations: [], pastRegistrations: [], teams: [team], recruitmentApplications: [], orders: [] } };
    else if (pathname === "/api/teams/profile") payload = { success: true, teams: [team] };
    else if (pathname === "/api/sessions") payload = { success: true, sessions: [{ id: "session-1", isCurrent: true, ipAddress: "127.0.0.1", userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130.0", createdAt: "2026-07-31T00:00:00Z", lastSeenAt: "2026-07-31T00:00:00Z", expiresAt: "2026-08-01T00:00:00Z" }] };
    else return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false }) });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    bodyFits: document.body.scrollWidth <= document.documentElement.clientWidth,
  }))).toEqual({ documentFits: true, bodyFits: true });
}

test("profile content fits narrow portrait and landscape viewports", async ({ page }) => {
  await mockProfileApi(page);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 662, height: 900 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await openPage(page, "/profile");
    await expect(page.getByRole("heading", { name: `${longText} Champion` })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    if (viewport.width >= 640) {
      const photoControlWidth = await page
        .locator('label:has(input[type="file"])')
        .evaluate((element) => element.getBoundingClientRect().width);
      expect(photoControlWidth).toBeLessThan(220);
    }

    for (const tab of ["Account", "Security", "Teams", "Overview"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expectNoHorizontalOverflow(page);
    }
  }
});
