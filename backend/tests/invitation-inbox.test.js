const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(
  __dirname,
  "../src/modules/teams/invitation-inbox.service.js",
);
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");

const loadService = ({ members = [] } = {}) => {
  const state = { queries: [] };
  const loaded = loadModuleWithMocks(servicePath, {
    [prismaPath]: {
      prisma: {
        savedTeamMember: {
          findMany: async (args) => {
            state.queries.push(args);
            return members;
          },
        },
      },
    },
  });
  return { ...loaded, state };
};

const invite = (overrides = {}) => ({
  id: "member-1",
  role: "PLAYER",
  inviteSentAt: new Date("2026-08-01"),
  inviteExpiresAt: new Date("2099-01-01"),
  team: {
    id: "team-1",
    name: "Example Team",
    teamTag: "EX",
    game: "valorant",
    captainUser: { username: "cap", firstName: "Cap", lastName: "Tain" },
  },
  ...overrides,
});

const VERIFIED = {
  id: "user-1",
  emailVerified: true,
  emailNormalized: "player@example.com",
};

test("a pending invitation is reachable inside Quest", async () => {
  const { module: service, restore } = loadService({ members: [invite()] });
  try {
    const result = await service.listInvitationsForUser({ user: VERIFIED });
    const [entry] = result.invitations;
    assert.equal(entry.teamName, "Example Team");
    assert.equal(entry.role, "PLAYER");
    assert.equal(entry.captain, "cap");
    assert.equal(entry.expired, false);
  } finally {
    restore();
  }
});

test("an unverified address never claims someone else's invitations", async () => {
  const { module: service, state, restore } = loadService();
  try {
    await service.listInvitationsForUser({
      user: { id: "user-1", emailVerified: false, emailNormalized: "player@example.com" },
    });
    // Signing up with another person's address must not hand over their
    // invitations, so email matching waits for verification.
    const [query] = state.queries;
    assert.deepEqual(query.where.OR, [{ userId: "user-1" }]);
  } finally {
    restore();
  }
});

test("a verified address also matches invitations sent before the account existed", async () => {
  const { module: service, state, restore } = loadService();
  try {
    await service.listInvitationsForUser({ user: VERIFIED });
    const [query] = state.queries;
    assert.deepEqual(query.where.OR, [
      { userId: "user-1" },
      // Only rows not already bound to a different user.
      { emailNormalized: "player@example.com", userId: null },
    ]);
  } finally {
    restore();
  }
});

test("only pending invitations are listed", async () => {
  const { module: service, state, restore } = loadService();
  try {
    await service.listInvitationsForUser({ user: VERIFIED });
    assert.equal(state.queries[0].where.inviteStatus, "pending");
  } finally {
    restore();
  }
});

test("an expired invitation is shown as expired rather than hidden", async () => {
  const { module: service, restore } = loadService({
    members: [invite({ inviteExpiresAt: new Date("2020-01-01") })],
  });
  try {
    const result = await service.listInvitationsForUser({ user: VERIFIED });
    // "This expired, ask your captain to resend" is actionable; silence is not.
    assert.equal(result.invitations[0].expired, true);
    assert.equal(result.invitations.length, 1);
  } finally {
    restore();
  }
});

test("an invitation with no expiry is not treated as expired", async () => {
  const { module: service, restore } = loadService({
    members: [invite({ inviteExpiresAt: null })],
  });
  try {
    const result = await service.listInvitationsForUser({ user: VERIFIED });
    assert.equal(result.invitations[0].expired, false);
  } finally {
    restore();
  }
});

test("a captain with no username still resolves to a name", async () => {
  const { module: service, restore } = loadService({
    members: [
      invite({
        team: {
          ...invite().team,
          captainUser: { username: null, firstName: "Cap", lastName: "Tain" },
        },
      }),
    ],
  });
  try {
    const result = await service.listInvitationsForUser({ user: VERIFIED });
    assert.equal(result.invitations[0].captain, "Cap Tain");
  } finally {
    restore();
  }
});

test("the inbox never exposes the invitation token", async () => {
  const { module: service, state, restore } = loadService({ members: [invite()] });
  try {
    const result = await service.listInvitationsForUser({ user: VERIFIED });
    // The token hash is the invitation's credential; the inbox proves
    // membership by session instead.
    assert.equal(state.queries[0].select.inviteTokenHash, undefined);
    assert.doesNotMatch(JSON.stringify(result), /token/i);
  } finally {
    restore();
  }
});

test("no invitations is an empty list, not an error", async () => {
  const { module: service, restore } = loadService({ members: [] });
  try {
    const result = await service.listInvitationsForUser({ user: VERIFIED });
    assert.deepEqual(result.invitations, []);
  } finally {
    restore();
  }
});
