const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const controllerPath = path.join(__dirname, "../src/modules/teams/team.controller.js");
const teamServicePath = path.join(__dirname, "../src/modules/teams/team.service.js");
const invitationServicePath = path.join(__dirname, "../src/modules/teams/invitation.service.js");

// What the controller says out loud, which is the part a captain and a player
// actually read. Two things it must not get wrong: reporting a delivery that
// did not happen, and describing an unverified address as somebody else's link.

const buildResponse = () => ({
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const invoke = async (handler, req, res) => {
  let nextError = null;
  await handler(req, res, (error) => { nextError = error || null; });
  if (nextError) throw nextError;
};

const load = ({ delivery = {}, listResult = {}, readiness = {} } = {}) => {
  const listCalls = [];
  return loadModuleWithMocks(controllerPath, {
    [teamServicePath]: {
      listProfileTeams: async () => [],
      createSavedTeam: async () => ({}),
      updateSavedTeam: async () => ({}),
      deleteSavedTeam: async () => undefined,
      nudgeTeamInvite: async () => ({
        member: { id: "member-1" },
        delivery: { inApp: false, discord: false, hasQuestAccount: false, ...delivery },
        resendAvailableAt: new Date("2026-09-09T00:01:00.000Z"),
      }),
    },
    [invitationServicePath]: {
      listInvitationsForUser: async (args) => {
        listCalls.push(args);
        return { invitations: [], ...listResult };
      },
      respondToInvitation: async () => ({ inviteStatus: "accepted" }),
      getInvitationReadiness: async () => ({
        hasQuestAccount: true,
        hasDiscord: true,
        ...readiness,
      }),
    },
  });
};

test("a nudge that reached nobody says so, and points at the link instead", async () => {
  const { module: controller, restore } = load({ delivery: { hasQuestAccount: false } });
  const res = buildResponse();
  try {
    await invoke(
      controller.nudgeProfileTeamInvite,
      { params: { teamId: "team-1", memberId: "member-1" }, user: { id: "captain" } },
      res
    );

    // Never "invitation sent". The captain is the remaining channel and can
    // only be that if they are told the truth about what landed — and what
    // they send is a link, not a delivery anybody else made.
    assert.doesNotMatch(res.body.message, /sent/i);
    assert.match(res.body.message, /does not have a Quest account/i);
    assert.match(res.body.message, /onboarding link/i);
  } finally {
    restore();
  }
});

test("a nudge names the channels that actually carried it", async () => {
  const { module: controller, restore } = load({
    delivery: { hasQuestAccount: true, inApp: true, discord: false },
  });
  const res = buildResponse();
  try {
    await invoke(
      controller.nudgeProfileTeamInvite,
      { params: { teamId: "team-1", memberId: "member-1" }, user: { id: "captain" } },
      res
    );
    assert.match(res.body.message, /Reminded in Quest/);
    assert.doesNotMatch(res.body.message, /Discord/);
  } finally {
    restore();
  }
});

test("invitations are whatever the signed-in identity has, with nothing to select them by", async () => {
  const { module: controller, restore } = load();
  const res = buildResponse();
  try {
    await invoke(
      controller.getMyInvitations,
      { query: {}, user: { id: "user-1", emailVerified: true } },
      res
    );

    assert.deepEqual(res.body.invitations, []);
    // Nothing in the response describes a particular invitation a link meant.
    // A link that named one told readers it was not for their account whenever
    // a roster edit had replaced the row it pointed at.
    assert.equal("reference" in res.body, false);
  } finally {
    restore();
  }
});

test("an unverified account is told to verify rather than shown an unexplained empty list", async () => {
  const { module: controller, restore } = load();
  const res = buildResponse();
  try {
    await invoke(
      controller.getMyInvitations,
      { query: {}, user: { id: "user-1", emailVerified: false } },
      res
    );

    // An unverified address matches no invitation, so the list is empty for a
    // reason the reader cannot otherwise guess.
    assert.equal(res.body.readiness.emailVerified, false);
  } finally {
    restore();
  }
});
