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

const actionFixtures = [
  { kind: "ban", actorSlot: 1, mapSlug: "ascent", mapName: "Ascent", side: null, seriesIndex: null },
  { kind: "ban", actorSlot: 2, mapSlug: "bind", mapName: "Bind", side: null, seriesIndex: null },
  { kind: "pick", actorSlot: 1, mapSlug: "haven", mapName: "Haven", side: null, seriesIndex: 1 },
  { kind: "side", actorSlot: 2, mapSlug: "haven", mapName: "Haven", side: "attack", seriesIndex: 1 },
  { kind: "pick", actorSlot: 2, mapSlug: "icebox", mapName: "Icebox", side: null, seriesIndex: 2 },
  { kind: "side", actorSlot: 1, mapSlug: "icebox", mapName: "Icebox", side: "attack", seriesIndex: 2 },
  { kind: "ban", actorSlot: 1, mapSlug: "lotus", mapName: "Lotus", side: null, seriesIndex: null },
  { kind: "ban", actorSlot: 2, mapSlug: "sunset", mapName: "Sunset", side: null, seriesIndex: null },
  { kind: "decider", actorSlot: null, mapSlug: "split", mapName: "Split", side: null, seriesIndex: 3 },
  { kind: "side", actorSlot: 1, mapSlug: "split", mapName: "Split", side: "attack", seriesIndex: 3 },
] as const;

const tournament = {
  id: "tournament-1",
  slug: "valorant-cup",
  title: "Quest Valorant Cup",
  game: "valorant",
};

const matchParticipants = [
  { id: "participant-1", slot: 1, registrationId: "registration-1", externalParticipantId: null, displayName: "Alpha", score: null, result: null, logoUrl: null },
  { id: "participant-2", slot: 2, registrationId: "registration-2", externalParticipantId: null, displayName: "Bravo", score: null, result: null, logoUrl: null },
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
  createRequest: Record<string, unknown> | null;
  actionRequests: Array<{ body: Record<string, unknown>; token: string }>;
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
  createRequest: null,
  actionRequests: [],
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
  currentStep: state.actions.length,
  currentAction: state.status === "in_progress" ? steps[state.actions.length] || null : null,
  actions: state.actions.map((action) => ({ ...action, payload: { ...action.payload } })),
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

const publicMatchProjection = (state: FixtureState) => ({
  id: "match-1",
  tournament: { id: tournament.id, slug: tournament.slug, title: tournament.title, game: tournament.game, status: "published", isPublished: true },
  source: "quest",
  externalId: null,
  identifier: "M-001",
  roundNumber: null,
  status: state.status === "completed" ? "completed" : "veto_in_progress",
  scheduledAt: null,
  estimatedAt: null,
  station: null,
  checkInDeadline: null,
  vetoStartAt: null,
  assignedStaff: null,
  localNotes: null,
  scoreData: {},
  winnerSlot: null,
  completedAt: state.status === "completed" ? "2026-08-31T00:05:00.000Z" : null,
  participants: matchParticipants,
  veto: state.status === "completed" && state.publishResult ? {
    code: "ALPHAB",
    status: "completed",
    format: "bo3",
    toss: { call: state.toss.call, result: state.toss.result, winnerSlot: state.toss.winnerSlot, teamASlot: state.teamASlot },
    actions: state.actions,
    completedAt: "2026-08-31T00:05:00.000Z",
  } : null,
  updatedAt: "2026-08-31T00:05:00.000Z",
});

const readBody = (route: Route) => {
  try {
    return (route.request().postDataJSON() || {}) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const appendFixtureAction = (state: FixtureState, requestIndex: number) => {
  const fixture = actionFixtures[requestIndex];
  if (!fixture) return false;
  state.actions.push({
    id: `action-${state.actions.length + 1}`,
    sequence: state.actions.length + 1,
    kind: fixture.kind,
    actorSlot: fixture.actorSlot,
    mapSlug: fixture.mapSlug,
    mapName: fixture.mapName,
    side: fixture.side,
    payload: { seriesIndex: fixture.seriesIndex },
    createdAt: "2026-08-31T00:05:00.000Z",
  });
  if (requestIndex === 7) {
    const decider = actionFixtures[8];
    state.actions.push({
      id: `action-${state.actions.length + 1}`,
      sequence: state.actions.length + 1,
      kind: decider.kind,
      actorSlot: decider.actorSlot,
      mapSlug: decider.mapSlug,
      mapName: decider.mapName,
      side: decider.side,
      payload: { seriesIndex: decider.seriesIndex },
      createdAt: "2026-08-31T00:05:00.000Z",
    });
  }
  if (state.actions.length >= actionFixtures.length) state.status = "completed";
  return true;
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
      state.createRequest = body;
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

    if (pathname === "/api/v1/matches" && request.method() === "GET") {
      return respond({ success: true, data: [publicMatchProjection(state)], meta: { pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 } } });
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
      const actionRequestIndex = state.actionRequests.length;
      if (pathname.endsWith("/actions")) state.actionRequests.push({ body, token });
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
        if (!appendFixtureAction(state, actionRequestIndex)) return errorResponse("The fixture received an invalid action.", 400);
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
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/v1/veto-rooms/ALPHAB") && response.request().method() === "GET"),
    page.getByRole("button", { name: "Refresh" }).click(),
  ]);
};

// VetoRoomView polls its room every 5s. Playwright stops honouring
// context.route once a context begins closing, so a poll firing in that window
// can escape to the mock API and be recorded as an unexpected request. Parking
// the fixture page destroys the timer while routing is still active, wherever
// in the spec a failure lands.
test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => {});
});

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
  expect(state.createRequest).toMatchObject({
    matchId: "match-1",
    format: "bo3",
    mapPoolId: "pool-1",
    rulePresetId: "preset-bo3",
    controlMode: "captain_or_link",
    teamOrderMethod: "toss",
    tossMethod: "digital",
    tossCallerSlot: 1,
    turnSeconds: 60,
    viewerEnabled: true,
    publishResult: false,
  });
  expect(state.createRequest).not.toHaveProperty("participants");

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
  const viewerContext = await browser.newContext();
  const casterContext = await browser.newContext();
  await installFixture(teamContext, state);
  await installFixture(teamTwoContext, state);
  await installFixture(viewerContext, state);
  await installFixture(casterContext, state);
  const teamPage = await teamContext.newPage();
  const teamTwoPage = await teamTwoContext.newPage();
  const viewerPage = await viewerContext.newPage();
  const casterPage = await casterContext.newPage();

  try {
    await teamPage.goto(hrefs[0], { waitUntil: "domcontentloaded" });
    await expect(teamPage.getByRole("heading", { name: "Alpha vs Bravo" })).toBeVisible();
    await teamPage.getByRole("button", { name: "Ready up" }).click();

    await teamTwoPage.goto(hrefs[1], { waitUntil: "domcontentloaded" });
    await expect(teamTwoPage.getByRole("heading", { name: "Alpha vs Bravo" })).toBeVisible();
    await teamTwoPage.getByRole("button", { name: "Ready up" }).click();

    await viewerPage.goto(hrefs[2], { waitUntil: "domcontentloaded" });
    await expect(viewerPage.getByText("Spectator", { exact: true })).toBeVisible();
    await expectCasterControlsAbsent(viewerPage);

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
    const casterMapButtons = casterPage.locator("button.veto-map-card");
    await expect(casterMapButtons).toHaveCount(maps.length);
    expect(await casterMapButtons.evaluateAll((buttons) => buttons.every((button) => (button as HTMLButtonElement).disabled))).toBe(true);

    const teamActionRevision = state.revision;
    await ascent.click();
    await teamPage.getByRole("dialog").getByRole("button", { name: /Confirm/i }).click();
    await expect.poll(() => state.actionRequests.length).toBe(1);
    expect(state.actionRequests[0]).toEqual({
      token: "team-one-secret",
      body: { expectedRevision: teamActionRevision, mapSlug: "ascent" },
    });
    expect(state.actionRoles).toContain("team_1");

    await expect(page.getByText("Banned", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(casterPage.getByText("Banned", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(viewerPage.getByText("Banned", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expectCasterControlsAbsent(casterPage);

    while (state.actions.length < steps.length) {
      const step = steps[state.actions.length];
      await refreshVeto(page);
      if (step.kind === "side") {
        await expect(page.getByRole("button", { name: "Attack", exact: true })).toBeVisible({ timeout: 15_000 });
        await page.getByRole("button", { name: "Attack", exact: true }).click();
      } else {
        const map = maps.find((entry) => !state.actions.some((action) => action.mapSlug === entry.slug));
        expect(map).toBeDefined();
        const mapButton = page.getByRole("button", { name: new RegExp(`Select to ${step.kind} ${map?.name}`, "i") });
        await expect(mapButton).toBeEnabled({ timeout: 15_000 });
        await mapButton.click();
      }
      await page.getByRole("dialog").getByRole("button", { name: /Confirm/i }).click();
    }
    expect(state.actionRequests).toHaveLength(9);
    expect(state.status).toBe("completed");
    await expect(page.getByRole("heading", { name: "Veto complete" })).toBeVisible({ timeout: 15_000 });
    await expect(casterPage.getByRole("heading", { name: "Veto complete" })).toBeVisible({ timeout: 15_000 });
    await expectCasterControlsAbsent(casterPage);

    const fetchPublicMatch = () => casterPage.evaluate(async () => {
      const response = await fetch("/api/v1/matches?status=completed&pageSize=50");
      return { status: response.status, body: await response.json() };
    });
    const unpublished = await fetchPublicMatch();
    expect(unpublished.status).toBe(200);
    expect(unpublished.body.data[0]).toMatchObject({ id: "match-1", status: "completed", veto: null });

    state.publishResult = true;
    const published = await fetchPublicMatch();
    expect(published.status).toBe(200);
    expect(published.body.data[0].veto).toMatchObject({ code: "ALPHAB", status: "completed", format: "bo3" });

    const publishedRoom = await casterPage.evaluate(async () => {
      const response = await fetch("/api/v1/veto-rooms/ALPHAB");
      return response.status;
    });
    expect(publishedRoom).toBe(200);

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
    // Same reason as the afterEach hook: stop the pollers before the close.
    await Promise.allSettled(
      [teamPage, teamTwoPage, viewerPage, casterPage].map((target) => target.goto("about:blank")),
    );
    await Promise.allSettled([teamPage.close(), teamTwoPage.close(), viewerPage.close(), casterPage.close()]);
    await Promise.allSettled([casterContext.close(), viewerContext.close(), teamTwoContext.close(), teamContext.close()]);
  }
});
