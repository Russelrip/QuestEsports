import { expect, test } from "./test-fixture";
import type { BrowserContext, Page, Route, TestInfo } from "@playwright/test";

const staff = {
  id: "staff-1",
  firstName: "Tournament",
  lastName: "Staff",
  email: "staff@quest.test",
  username: "tournament_staff",
  role: "admin",
  emailVerified: true,
};

const maps = ["Ascent", "Bind", "Haven", "Icebox", "Lotus", "Sunset", "Split"].map((name, index) => ({
  id: `map-${index + 1}`,
  slug: name.toLowerCase(),
  name,
  artworkUrl: null,
  logoUrl: null,
  accentColor: index % 2 ? "#fb7185" : "#22d3ee",
  isActive: true,
}));

type FixtureStep = { kind: "ban" | "pick" | "side" | "decider"; actor: "A" | "B" | null; seriesIndex: number | null };
const steps: FixtureStep[] = [
  { kind: "ban", actor: "A", seriesIndex: null },
  { kind: "ban", actor: "B", seriesIndex: null },
  { kind: "pick", actor: "A", seriesIndex: 1 },
  { kind: "side", actor: "B", seriesIndex: 1 },
  { kind: "pick", actor: "B", seriesIndex: 2 },
  { kind: "side", actor: "A", seriesIndex: 2 },
  { kind: "ban", actor: "A", seriesIndex: null },
  { kind: "ban", actor: "B", seriesIndex: null },
  { kind: "decider", actor: null, seriesIndex: 3 },
  { kind: "side", actor: "A", seriesIndex: 3 },
];

const tournament = {
  id: "tournament-1",
  slug: "valorant-cup",
  title: "Quest Valorant Cup",
  game: "valorant",
};

const matchParticipants = [
  { id: "participant-1", slot: 1, registrationId: "registration-1", displayName: "Alpha", score: null, result: null, logoUrl: null },
  { id: "participant-2", slot: 2, registrationId: "registration-2", displayName: "Bravo", score: null, result: null, logoUrl: null },
];

type FixtureState = {
  created: boolean;
  status: string;
  revision: number;
  publishResult: boolean;
  teamASlot: number | null;
  toss: { callerSlot: number; call: string | null; result: string | null; winnerSlot: number | null };
  participants: Array<{ slot: number; displayName: string; ready: boolean; joined: boolean; team: string | null }>;
  actions: Array<{ id: string; sequence: number; kind: string; actorSlot: number | null; mapSlug: string | null; mapName: string | null; side: string | null; payload: { seriesIndex: number | null }; createdAt: string }>;
  actionRoles: string[];
};

const makeFixtureState = (): FixtureState => ({
  created: false,
  status: "draft",
  revision: 1,
  publishResult: true,
  teamASlot: null,
  toss: { callerSlot: 1, call: null, result: null, winnerSlot: null },
  participants: [
    { slot: 1, displayName: "Alpha", ready: false, joined: false, team: null },
    { slot: 2, displayName: "Bravo", ready: false, joined: false, team: null },
  ],
  actions: [],
  actionRoles: [],
});

const roomFor = (state: FixtureState, accessKind: string, accessSlot: number | null = null) => ({
  id: "veto-1",
  code: "ALPHAB",
  title: "Alpha vs Bravo",
  format: "bo3",
  status: state.status,
  revision: state.revision,
  controlMode: "captain_or_link",
  teamOrderMethod: "toss",
  toss: {
    method: "digital",
    callerSlot: state.toss.callerSlot,
    call: state.toss.call,
    result: state.toss.result,
    winnerSlot: state.toss.winnerSlot,
    teamASlot: state.teamASlot,
  },
  timer: { seconds: 60, deadline: null },
  viewerEnabled: true,
  publishResult: state.publishResult,
  tournament,
  match: { id: "match-1", identifier: "M-001", status: "scheduled", scheduledAt: null },
  participants: state.participants.map((participant) => ({
    id: `veto-participant-${participant.slot}`,
    slot: participant.slot,
    registrationId: `registration-${participant.slot}`,
    displayName: participant.displayName,
    seed: participant.slot,
    accentColor: participant.slot === 1 ? "#22d3ee" : "#fb7185",
    logoUrl: null,
    ready: participant.ready,
    joined: participant.joined,
    team: participant.team,
  })),
  maps,
  steps,
  currentStep: state.status === "in_progress" ? state.actions.length : state.actions.length,
  currentAction: state.status === "in_progress" ? steps[state.actions.length] || null : null,
  actions: state.actions,
  access: { kind: accessKind, slot: accessSlot },
  timestamps: { openedAt: null, startedAt: null, completedAt: state.status === "completed" ? "2026-08-31T00:05:00.000Z" : null, cancelledAt: null, updatedAt: "2026-08-31T00:05:00.000Z" },
});

const matchRoomSummary = (state: FixtureState) => ({
  id: "match-room-1",
  code: "MATCHAB",
  chatLocked: false,
  messageCount: 0,
  openSupportCount: 0,
  match: {
    id: "match-1",
    identifier: "M-001",
    status: "scheduled",
    scheduledAt: null,
    tournament,
    participants: matchParticipants,
    veto: state.created ? { id: "veto-1", code: "ALPHAB", status: state.status, format: "bo3", revision: state.revision } : null,
  },
});

const readBody = (route: Route) => {
  try {
    return (route.request().postDataJSON() || {}) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const installFixture = async (context: BrowserContext, state: FixtureState, staffContext = false) => {
  await context.addInitScript(() => {
    class TestEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = TestEventSource.CONNECTING;
      readonly OPEN = TestEventSource.OPEN;
      readonly CLOSED = TestEventSource.CLOSED;
      readonly readyState = TestEventSource.CLOSED;
      readonly url: string;
      readonly withCredentials: boolean;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;

      constructor(url: string | URL, init?: EventSourceInit) {
        super();
        this.url = String(url);
        this.withCredentials = Boolean(init?.withCredentials);
      }

      close() {}
    }

    Object.defineProperty(window, "EventSource", { configurable: true, value: TestEventSource, writable: true });
  });

  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const headers = request.headers();
    const cookie = headers.cookie || "";
    const token = headers["x-veto-token"] || "";
    const accessByToken: Record<string, { kind: string; slot: number | null }> = {
      "team-one-secret": { kind: "team", slot: 1 },
      "team-two-secret": { kind: "team", slot: 2 },
      "viewer-secret": { kind: "viewer", slot: null },
      "caster-secret": { kind: "caster", slot: null },
    };
    const access = staffContext || cookie.includes("quest_fixture_session=staff")
      ? { kind: "staff", slot: null }
      : accessByToken[token]
        || (state.status === "completed" && state.publishResult && !token ? { kind: "public", slot: null } : null);
    const respond = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) => route.fulfill({ status, contentType: "application/json", headers: extraHeaders, body: JSON.stringify(body) });
    const vetoResponse = (kind: string, slot: number | null = null) => respond({ success: true, data: roomFor(state, kind, slot) });
    const errorResponse = (message: string, status: number) => respond({ success: false, message }, status);

    if (pathname === "/api/login" && request.method() === "POST") {
      const body = readBody(route);
      if (body.emailOrUsername !== staff.email || body.password !== "staff-password") return errorResponse("Invalid credentials.", 401);
      return respond({ success: true, user: staff }, 200, { "set-cookie": "quest_fixture_session=staff; Path=/" });
    }
    if (pathname === "/api/me") {
      return staffContext || cookie.includes("quest_fixture_session=staff")
        ? respond({ success: true, user: staff })
        : errorResponse("Not authenticated.", 401);
    }
    if (pathname === "/api/logout") return respond({ success: true });

    if (pathname === "/api/v1/admin/match-rooms" && request.method() === "GET") return respond({ success: true, data: [matchRoomSummary(state)] });
    if (pathname === "/api/admin/tournaments" && request.method() === "GET") return respond({ success: true, tournaments: [{ ...tournament, status: "published" }] });
    if (pathname === "/api/v1/admin/veto/catalog" && request.method() === "GET") {
      return respond({ success: true, data: {
        maps,
        pools: [{ id: "pool-1", name: "Valorant Active Pool", version: 1, tournamentId: null, maps }],
        presets: [{ id: "preset-bo3", name: "Standard BO3", format: "bo3", version: 1, steps }],
        templates: [],
      } });
    }
    if (pathname === "/api/v1/admin/veto-rooms" && request.method() === "GET") return respond({ success: true, data: state.created ? [roomFor(state, "staff")] : [] });
    if (pathname === "/api/v1/admin/tournaments/tournament-1/matches" && request.method() === "GET") return respond({ success: true, data: [{ id: "match-1", identifier: "M-001", status: "scheduled", game: "valorant", participants: matchParticipants }] });

    if (pathname === "/api/v1/admin/veto-rooms" && request.method() === "POST") {
      const body = readBody(route);
      state.created = true;
      state.publishResult = body.publishResult === true;
      state.toss.callerSlot = Number(body.tossCallerSlot) || 1;
      return respond({ success: true, data: {
        room: roomFor(state, "staff"),
        issuedTokens: { team1: "team-one-secret", team2: "team-two-secret", viewer: "viewer-secret", caster: "caster-secret" },
      } });
    }
    if (pathname === "/api/v1/admin/veto-rooms/veto-1" && request.method() === "GET") return vetoResponse("staff");
    if (pathname === "/api/v1/admin/veto-rooms/veto-1/open" && request.method() === "POST") {
      state.status = "open";
      state.revision += 1;
      return vetoResponse("staff");
    }

    if (pathname === "/api/v1/veto-rooms/ALPHAB") {
      if (!state.created) return errorResponse("Veto room not found.", 404);
      if (!access) return errorResponse("Veto access requires a private link.", 401);
      return vetoResponse(access.kind, access.slot);
    }
    if (pathname === "/api/v1/veto-rooms/ALPHAB/ready" || pathname === "/api/v1/veto-rooms/ALPHAB/toss" || pathname === "/api/v1/veto-rooms/ALPHAB/team-a" || pathname === "/api/v1/veto-rooms/ALPHAB/actions") {
      if (!access) return errorResponse("Veto access requires a private link.", 401);
      if (access.kind === "caster" || access.kind === "viewer" || access.kind === "public") return errorResponse("This veto link is read-only.", 403);
      const body = readBody(route);
      if (Number(body.expectedRevision) !== state.revision) return errorResponse("The room changed. Refresh and try again.", 409);
      state.actionRoles.push(access.kind === "team" ? `team_${access.slot}` : "staff");
      if (pathname.endsWith("/ready")) {
        const slot = Number(body.slot);
        if (access.kind === "team" && access.slot !== slot) return errorResponse("That team link cannot ready the other team.", 403);
        state.participants[slot - 1].ready = body.ready === true;
        state.participants[slot - 1].joined = true;
        if (state.participants.every((participant) => participant.ready)) state.status = "toss_pending";
      } else if (pathname.endsWith("/toss")) {
        state.toss.call = String(body.call);
        state.toss.result = "heads";
        state.toss.winnerSlot = state.toss.callerSlot;
      } else if (pathname.endsWith("/team-a")) {
        state.teamASlot = String(body.choice) === "A" ? state.toss.winnerSlot : state.toss.winnerSlot === 1 ? 2 : 1;
        state.participants.forEach((participant) => { participant.team = participant.slot === state.teamASlot ? "A" : "B"; });
        state.status = "in_progress";
      } else {
        const step = steps[state.actions.length] || { kind: "ban", actor: null, seriesIndex: null };
        const map = maps.find((entry) => entry.slug === body.mapSlug) || maps[state.actions.length % maps.length];
        const actorSlot = step.actor === "A" ? state.teamASlot : step.actor === "B" && state.teamASlot ? state.teamASlot === 1 ? 2 : 1 : null;
        state.actions.push({
          id: `action-${state.actions.length + 1}`,
          sequence: state.actions.length + 1,
          kind: String(step.kind),
          actorSlot,
          mapSlug: map.slug,
          mapName: map.name,
          side: typeof body.side === "string" ? body.side : null,
          payload: { seriesIndex: step.seriesIndex },
          createdAt: "2026-08-31T00:05:00.000Z",
        });
        if (state.actions.length >= steps.length) state.status = "completed";
      }
      state.revision += 1;
      return vetoResponse(access.kind, access.slot);
    }

    return errorResponse(`Unexpected integrated veto fixture request: ${request.method()} ${request.url()}`, 404);
  });
};

const expectNoHorizontalOverflow = async (page: Page) => {
  await expect.poll(() => page.evaluate(() => ({
    documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    bodyFits: document.body.scrollWidth <= document.documentElement.clientWidth,
  }))).toEqual({ documentFits: true, bodyFits: true });
};

const expectCasterControlsAbsent = async (page: Page) => {
  await expect(page.getByRole("button", { name: /^(Ready up|Not ready|Heads|Tails|Attack|Defense|Team [AB] ·|Confirm)/ })).toHaveCount(0);
};

const refreshVeto = async (page: Page) => {
  await page.getByRole("button", { name: "Refresh" }).click();
};

test("staff launches an integrated BO3 veto and role views stay correctly isolated", async ({ page, browser }, testInfo: TestInfo) => {
  test.setTimeout(120_000);
  const state = makeFixtureState();
  await installFixture(page.context(), state, true);

  await page.goto("/privacy-policy", { waitUntil: "domcontentloaded" });
  const loginStatus = await page.evaluate(async ({ email }) => {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ emailOrUsername: email, password: "staff-password", remember: true }),
    });
    return response.status;
  }, { email: staff.email });
  expect(loginStatus).toBe(200);
  await page.goto("/admin/match-rooms", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/admin\/match-rooms$/);
  await expect(page.getByRole("heading", { name: "Match Rooms" })).toBeVisible();

  await page.getByRole("link", { name: "Start map veto" }).click();
  await expect(page).toHaveURL(/\/admin\/veto-rooms\?matchId=match-1&tournamentId=tournament-1$/);
  await expect(page.getByRole("heading", { name: "Choose match format" })).toBeVisible();
  await page.getByRole("button", { name: /bo3\s+best of 3/i }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("combobox", { name: "Toss caller" }).selectOption("1");
  const publishCheckbox = page.locator('input[type="checkbox"]').nth(1);
  await expect(publishCheckbox).toBeChecked();
  await publishCheckbox.click({ force: true });
  await expect(publishCheckbox).not.toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Review and create" })).toBeVisible();
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByText("Room created.")).toBeVisible();

  const roleLinks = ["Team 1 link", "Team 2 link", "Viewer link", "Caster link"];
  const hrefs: string[] = [];
  for (const roleLabel of roleLinks) {
    const link = page.getByText(roleLabel).locator("..").getByRole("link", { name: "Open" });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toContain("/veto/ALPHAB#access=");
    hrefs.push(href || "");
  }
  expect(new Set(hrefs).size).toBe(4);
  expect(state.publishResult).toBe(false);

  await page.getByRole("button", { name: "Open room" }).click();
  await expect(page.getByText("Open completed.")).toBeVisible();
  await refreshVeto(page);
  await expect(page.getByRole("heading", { name: "Waiting for staff to begin" })).toBeVisible();

  const teamContext = await browser.newContext();
  const teamTwoContext = await browser.newContext();
  const casterContext = await browser.newContext();
  await installFixture(teamContext, state);
  await installFixture(teamTwoContext, state);
  await installFixture(casterContext, state);
  const teamPage = await teamContext.newPage();
  const teamTwoPage = await teamTwoContext.newPage();
  const casterPage = await casterContext.newPage();

  try {
    await teamPage.goto(hrefs[0], { waitUntil: "domcontentloaded" });
    await expect(teamPage.getByRole("heading", { name: "Alpha vs Bravo" })).toBeVisible();
    await teamPage.getByRole("button", { name: "Ready up" }).click();

    await teamTwoPage.goto(hrefs[1], { waitUntil: "domcontentloaded" });
    await expect(teamTwoPage.getByRole("heading", { name: "Alpha vs Bravo" })).toBeVisible();
    await teamTwoPage.getByRole("button", { name: "Ready up" }).click();

    await refreshVeto(page);
    await expect(page.getByText("Toss Pending", { exact: true })).toBeVisible();

    await refreshVeto(teamPage);
    await teamPage.getByRole("button", { name: "Heads" }).click();
    await expect(teamPage.getByRole("button", { name: /Team A ·/ })).toBeVisible();
    await teamPage.getByRole("button", { name: /Team A ·/ }).click();
    await teamPage.getByRole("dialog").getByRole("button", { name: /Confirm Team A/ }).click();

    const ascent = teamPage.getByRole("button", { name: /Select to ban Ascent/ });
    await expect(ascent).toBeEnabled();

    await casterPage.goto(hrefs[3], { waitUntil: "domcontentloaded" });
    await expect(casterPage.getByText("Live broadcast", { exact: true })).toBeVisible();
    await expectCasterControlsAbsent(casterPage);

    const teamActionStatus = await teamPage.evaluate(async (expectedRevision) => {
      const response = await fetch("/api/v1/veto-rooms/ALPHAB/actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-veto-token": "team-one-secret" },
        body: JSON.stringify({ expectedRevision, mapSlug: "ascent" }),
      });
      return response.status;
    }, state.revision);
    expect(teamActionStatus).toBe(200);
    expect(state.actionRoles).toContain("team_1");

    await expect(page.getByText("Banned", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(casterPage.getByText("Banned", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expectCasterControlsAbsent(casterPage);

    for (let index = 1; index < steps.length; index += 1) {
      const step = steps[index];
      const body = step.kind === "side"
        ? { side: "attack", expectedRevision: state.revision }
        : { mapSlug: maps[index % maps.length].slug, expectedRevision: state.revision };
      const status = await page.evaluate(async (actionBody) => {
        const response = await fetch("/api/v1/veto-rooms/ALPHAB/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(actionBody),
        });
        return response.status;
      }, body);
      expect(status).toBe(200);
    }
    expect(state.status).toBe("completed");
    await expect(page.getByRole("heading", { name: "Veto complete" })).toBeVisible({ timeout: 15_000 });
    await expect(casterPage.getByRole("heading", { name: "Veto complete" })).toBeVisible({ timeout: 15_000 });
    await expectCasterControlsAbsent(casterPage);

    const unpublished = await casterPage.evaluate(async () => {
      const response = await fetch("/api/v1/veto-rooms/ALPHAB");
      return response.status;
    });
    expect(unpublished).toBe(401);

    state.publishResult = true;
    const published = await casterPage.evaluate(async () => {
      const response = await fetch("/api/v1/veto-rooms/ALPHAB");
      return { status: response.status, body: await response.json() };
    });
    expect(published.status).toBe(200);
    expect(published.body.data.access).toEqual({ kind: "public", slot: null });

    const casterMutation = await casterPage.evaluate(async () => {
      const response = await fetch("/api/v1/veto-rooms/ALPHAB/actions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-veto-token": "caster-secret" },
        body: JSON.stringify({ expectedRevision: 999, mapSlug: "split" }),
      });
      return response.status;
    });
    expect(casterMutation).toBe(403);

    const viewport = casterPage.viewportSize();
    expect(viewport).not.toBeNull();
    if (testInfo.project.name === "mobile-safari") expect(viewport?.width).toBeLessThanOrEqual(430);
    else expect(viewport?.width).toBeGreaterThanOrEqual(700);
    await expectNoHorizontalOverflow(casterPage);
  } finally {
    await Promise.allSettled([teamPage.close(), teamTwoPage.close(), casterPage.close()]);
    await Promise.allSettled([casterContext.close(), teamTwoContext.close(), teamContext.close()]);
  }
});
