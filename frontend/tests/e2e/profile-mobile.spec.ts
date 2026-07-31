import { expect, test, type Page } from "@playwright/test";

const longText = "QuestPlayerWithAnExtremelyLongCompetitiveIdentityThatMustWrapWithoutBreakingTheViewport";
const user = { id: "user-mobile", firstName: longText, lastName: "Champion", email: `${longText}@example-esports-community.lk`, username: longText, role: "user", emailVerified: true, phone: "+94770000000", discordTag: `${longText}#1234`, mfaEnabled: false };
const team = { id: "team-mobile", name: `${longText} International Championship Roster`, country: "Sri Lanka", teamTag: "QUESTLONG", organizationRequested: false, organizationName: "", logoName: null, logoUrl: null, isCaptain: true, registrationCount: 1, canDelete: true, captainName: longText, createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-31T00:00:00Z", members: [{ id: "member-1", role: "PLAYER", memberOrder: 1, name: longText, email: `${longText}@members.example`, discord: longText, riotId: longText, inviteStatus: "accepted" }] };

async function mockProfileApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let payload: object = { success: true };
    if (url.pathname === "/api/me") payload = { success: true, user };
    else if (url.pathname === "/api/me/dashboard") payload = { success: true, dashboard: { currentRegistrations: [], pastRegistrations: [], teams: [team], recruitmentApplications: [], orders: [] } };
    else if (url.pathname === "/api/teams/profile") payload = { success: true, teams: [team] };
    else if (url.pathname === "/api/sessions") payload = { success: true, sessions: [{ id: "session-1", isCurrent: true, ipAddress: "127.0.0.1", userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130.0", createdAt: "2026-07-31T00:00:00Z", lastSeenAt: "2026-07-31T00:00:00Z", expiresAt: "2026-08-01T00:00:00Z" }] };
    else if (url.pathname === "/api/v1/matches/next") payload = { success: true, data: null, meta: { serverNow: "2026-07-31T00:00:00Z" } };
    else if (url.pathname === "/api/v1/events") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false }) });
    else return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, message: "Not mocked" }) });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) });
  });
}

const assertNoOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

test("profile tabs, long identities, MFA, sessions, and roster controls fit mobile and landscape viewports", async ({ page }) => {
  await mockProfileApi(page);
  for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 812 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: `${longText} Champion` })).toBeVisible();
    await assertNoOverflow(page);
    const avatar = page.locator("main").getByText("QC", { exact: true });
    await expect(avatar).toHaveClass(/rounded-full/);
    await expect(avatar).toHaveCSS("width", "80px");
    await expect(avatar).toHaveCSS("height", "80px");
    expect(await avatar.getAttribute("class")).not.toMatch(/purple|pink|fuchsia/);

    for (const tab of ["Account", "Security", "Teams", "Overview"]) {
      await page.getByRole("tab", { name: tab }).click();
      if (tab === "Security") {
        await expect(page.getByRole("heading", { name: /multi-factor authentication/i })).toBeVisible();
        await expect(page.getByText(/Chrome on Android/i)).toBeVisible();
      }
      if (tab === "Teams") await expect(page.getByText(team.name, { exact: false }).first()).toBeVisible();
      await assertNoOverflow(page);
    }
  }
});
