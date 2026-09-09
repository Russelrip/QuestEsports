const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/teams/invitation.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const discordLinkPath = path.join(__dirname, "../src/modules/auth/discord-link.service.js");
const verificationPath = path.join(__dirname, "../src/modules/teams/registration-verification.js");

// Answering an invitation used to mean presenting the token it was emailed
// with, which made a roster spot exactly as durable as an email. It is answered
// by the invitee's identity now, and accepting requires a connected Discord —
// the requirement moved to the person who can actually satisfy it.

const invite = (overrides = {}) => ({
  id: "member-1",
  role: "PLAYER",
  name: "Player Two",
  email: "player@example.com",
  emailNormalized: "player@example.com",
  inviteStatus: "pending",
  inviteSentAt: new Date("2026-08-01T00:00:00.000Z"),
  inviteExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  team: {
    id: "team-1",
    name: "Example Team",
    teamTag: "EX",
    game: "valorant",
    captainUser: { username: "cap", firstName: "Cap", lastName: "Tain" },
    registrations: [],
  },
  ...overrides,
});

const VERIFIED = {
  id: "user-1",
  emailVerified: true,
  emailNormalized: "player@example.com",
  email: "player@example.com",
};

// `members` is what the pending list returns; `lookup` is what a direct
// findFirst can reach. They are separate so a test can describe a row that this
// account owns but that is no longer waiting on it — an invitation already
// answered, or one that ran out — which is exactly the case a member reference
// has to tell apart from somebody else's link.
const loadService = ({
  members = [],
  lookup = null,
  discordLinked = true,
  openRegistrations = [],
} = {}) => {
  const findable = lookup || members;
  const state = {
    queries: [],
    savedTeamMemberUpdates: [],
    registrationMemberUpdates: [],
    verificationRefreshes: [],
    discordChecks: 0,
  };

  let current = members[0] ? { ...members[0] } : null;

  const tx = {
    savedTeamMember: {
      updateMany: async (args) => {
        state.savedTeamMemberUpdates.push(args);
        if (!current || !["pending"].includes(current.inviteStatus)) return { count: 0 };
        current = { ...current, ...args.data };
        return { count: 1 };
      },
      findUnique: async () => current,
    },
    teamRegistration: {
      findMany: async (args) => {
        state.queries.push({ model: "teamRegistration", args });
        return openRegistrations;
      },
    },
    registrationMember: {
      updateMany: async (args) => {
        state.registrationMemberUpdates.push(args);
        return { count: 1 };
      },
    },
  };

  const loaded = loadModuleWithMocks(servicePath, {
    [prismaPath]: {
      prisma: {
        savedTeamMember: {
          findMany: async (args) => {
            state.queries.push({ model: "savedTeamMember.findMany", args });
            return members;
          },
          findFirst: async (args) => {
            state.queries.push({ model: "savedTeamMember.findFirst", args });
            return findable.find((member) => member.id === args.where.id) || null;
          },
        },
        oAuthAccount: {
          findFirst: async () => (discordLinked ? { id: "oauth-1" } : null),
        },
        $transaction: async (work) => work(tx),
      },
    },
    [discordLinkPath]: {
      requireLinkedDiscord: async (_userId, message) => {
        state.discordChecks += 1;
        if (!discordLinked) {
          const error = new Error(message);
          error.statusCode = 403;
          error.code = "DISCORD_LINK_REQUIRED";
          throw error;
        }
        return { discordId: "900000000000000001", discordUsername: "player" };
      },
    },
    [verificationPath]: {
      refreshRegistrationVerificationStatus: async ({ registrationId }) => {
        state.verificationRefreshes.push(registrationId);
        return "pending";
      },
    },
  });

  return { ...loaded, state, getCurrent: () => current };
};

test("a pending invitation is reachable inside Quest", async () => {
  const { module: service, restore } = loadService({ members: [invite()] });
  try {
    const { invitations } = await service.listInvitationsForUser({ user: VERIFIED });
    const [entry] = invitations;
    assert.equal(entry.teamName, "Example Team");
    assert.equal(entry.role, "PLAYER");
    // Named the same way the captain is named everywhere else an invitation
    // mentions them: their actual name, falling back to the username only when
    // there is no name to use.
    assert.equal(entry.captain, "Cap Tain");
    assert.equal(entry.id, "member-1");
  } finally {
    restore();
  }
});

test("an invitation says what it is for when it is for a tournament", async () => {
  const { module: service, restore } = loadService({
    members: [invite({
      team: {
        ...invite().team,
        registrations: [{ id: "reg-1", tournament: { title: "Quest Cup", slug: "quest-cup" } }],
      },
    })],
  });
  try {
    const { invitations } = await service.listInvitationsForUser({ user: VERIFIED });
    assert.equal(invitations[0].tournamentTitle, "Quest Cup");
    assert.equal(invitations[0].tournamentSlug, "quest-cup");
  } finally {
    restore();
  }
});

test("only an address the account has proven it controls matches an unlinked invitation", async () => {
  const { module: service, restore, state } = loadService({ members: [] });
  try {
    await service.listInvitationsForUser({
      user: { id: "user-2", emailVerified: false, emailNormalized: "player@example.com" },
    });
    const [{ args }] = state.queries;
    // Only the user link. Signing up with someone else's address must never be
    // enough to be handed their invitations.
    assert.deepEqual(args.where.OR, [{ userId: "user-2" }]);

    state.queries.length = 0;
    await service.listInvitationsForUser({ user: VERIFIED });
    const [{ args: verifiedArgs }] = state.queries;
    assert.deepEqual(verifiedArgs.where.OR, [
      { userId: "user-1" },
      { emailNormalized: "player@example.com", userId: null },
    ]);
  } finally {
    restore();
  }
});

test("only unanswered invitations are listed", async () => {
  const { module: service, restore, state } = loadService({ members: [] });
  try {
    await service.listInvitationsForUser({ user: VERIFIED });
    const [{ args }] = state.queries;
    assert.deepEqual(args.where.inviteStatus, { in: ["pending"] });
  } finally {
    restore();
  }
});

test("accepting requires a connected Discord account", async () => {
  const { module: service, restore, state } = loadService({
    members: [invite()],
    discordLinked: false,
  });
  try {
    await assert.rejects(
      () => service.respondToInvitation({
        invitationId: "member-1",
        decision: "accept",
        user: VERIFIED,
      }),
      (error) => {
        assert.equal(error.code, "DISCORD_LINK_REQUIRED");
        return true;
      },
    );
    // Refused before anything was written: a roster spot must not be half-taken
    // by someone who cannot complete the requirement.
    assert.deepEqual(state.savedTeamMemberUpdates, []);
  } finally {
    restore();
  }
});

test("declining never asks for Discord", async () => {
  const { module: service, restore, state } = loadService({
    members: [invite()],
    discordLinked: false,
  });
  try {
    const result = await service.respondToInvitation({
      invitationId: "member-1",
      decision: "decline",
      user: VERIFIED,
    });
    assert.equal(result.inviteStatus, "declined");
    // Someone who does not want the spot should not have to connect an account
    // in order to say so.
    assert.equal(state.discordChecks, 0);
  } finally {
    restore();
  }
});

test("accepting links the account and refreshes every open registration", async () => {
  const { module: service, restore, state, getCurrent } = loadService({
    members: [invite()],
    openRegistrations: [{ id: "reg-1" }, { id: "reg-2" }],
  });
  try {
    const result = await service.respondToInvitation({
      invitationId: "member-1",
      decision: "accept",
      user: VERIFIED,
    });

    assert.equal(result.inviteStatus, "accepted");
    assert.equal(getCurrent().userId, "user-1");
    assert.deepEqual(state.verificationRefreshes, ["reg-1", "reg-2"]);
    const [{ where }] = state.registrationMemberUpdates;
    assert.deepEqual(where.registrationId, { in: ["reg-1", "reg-2"] });
  } finally {
    restore();
  }
});

// A free registration is stored as paid the moment it is created, because
// capacity counts paid rows. Scoping the propagation by payment would have left
// every free roster stuck at pending no matter who accepted.
test("propagation is scoped by registration status, never by payment", async () => {
  const { module: service, restore, state } = loadService({
    members: [invite()],
    openRegistrations: [{ id: "reg-1" }],
  });
  try {
    await service.respondToInvitation({
      invitationId: "member-1",
      decision: "accept",
      user: VERIFIED,
    });
    const registrationQuery = state.queries.find((entry) => entry.model === "teamRegistration");
    assert.deepEqual(registrationQuery.args.where.status, { in: ["pending", "waitlisted"] });
    assert.equal(registrationQuery.args.where.paymentStatus, undefined);
  } finally {
    restore();
  }
});

test("an invitation that ran out is refused with something to do about it", async () => {
  const { module: service, restore } = loadService({
    members: [invite({ inviteExpiresAt: new Date("2020-01-01T00:00:00.000Z") })],
  });
  try {
    await assert.rejects(
      () => service.respondToInvitation({
        invitationId: "member-1",
        decision: "accept",
        user: VERIFIED,
      }),
      (error) => error.statusCode === 409 && /invite you again/.test(error.message),
    );
  } finally {
    restore();
  }
});

test("an expired invitation is refused on its state, not only on its clock", async () => {
  const { module: service, restore } = loadService({
    members: [invite({ inviteStatus: "expired", inviteExpiresAt: null })],
  });
  try {
    await assert.rejects(
      () => service.respondToInvitation({
        invitationId: "member-1",
        decision: "accept",
        user: VERIFIED,
      }),
      (error) => error.statusCode === 409 && /invite you again/.test(error.message),
    );
  } finally {
    restore();
  }
});

test("an invitation addressed to somebody else is not found", async () => {
  const { module: service, restore } = loadService({ members: [] });
  try {
    await assert.rejects(
      () => service.respondToInvitation({
        invitationId: "member-1",
        decision: "accept",
        user: VERIFIED,
      }),
      (error) => error.statusCode === 404,
    );
  } finally {
    restore();
  }
});

test("an unverified account cannot answer at all", async () => {
  const { module: service, restore } = loadService({ members: [invite()] });
  try {
    await assert.rejects(
      () => service.respondToInvitation({
        invitationId: "member-1",
        decision: "accept",
        user: { id: "user-1", emailVerified: false, emailNormalized: "player@example.com" },
      }),
      (error) => error.statusCode === 403,
    );
  } finally {
    restore();
  }
});

test("a decision has to be one of the two", async () => {
  const { module: service, restore } = loadService({ members: [invite()] });
  try {
    await assert.rejects(
      () => service.respondToInvitation({
        invitationId: "member-1",
        decision: "maybe",
        user: VERIFIED,
      }),
      (error) => error.statusCode === 400,
    );
  } finally {
    restore();
  }
});

test("readiness reports what is in the way of accepting", async () => {
  const linked = loadService({ discordLinked: true });
  try {
    assert.deepEqual(
      await linked.module.getInvitationReadiness({ userId: "user-1" }),
      { hasQuestAccount: true, hasDiscord: true },
    );
  } finally {
    linked.restore();
  }

  const unlinked = loadService({ discordLinked: false });
  try {
    assert.deepEqual(
      await unlinked.module.getInvitationReadiness({ userId: "user-1" }),
      { hasQuestAccount: true, hasDiscord: false },
    );
    // Nobody signed in is nobody to check.
    assert.deepEqual(
      await unlinked.module.getInvitationReadiness({ userId: null }),
      { hasQuestAccount: false, hasDiscord: false },
    );
  } finally {
    unlinked.restore();
  }
});

test("a captain with no name still resolves to something to call them", async () => {
  const { module: service, restore } = loadService({
    members: [invite({
      team: {
        ...invite().team,
        captainUser: { username: "cap", firstName: null, lastName: null },
      },
    })],
  });
  try {
    const { invitations } = await service.listInvitationsForUser({ user: VERIFIED });
    assert.equal(invitations[0].captain, "cap");
  } finally {
    restore();
  }
});

// A member reference is a routing hint. It selects nothing, and the invitations
// returned beside it would be identical without it — but the page still has to
// be able to say something true about a link that led somewhere unexpected,
// which is the whole reason it is answered at all.

test("a reference to a waiting invitation names it so the page can focus it", async () => {
  const { module: service, restore } = loadService({ members: [invite()] });
  try {
    const { invitations, reference } = await service.listInvitationsForUser({
      user: VERIFIED,
      memberReference: "member-1",
    });
    assert.equal(invitations.length, 1);
    assert.deepEqual(reference, { state: "waiting", member: "member-1" });
  } finally {
    restore();
  }
});

test("no reference is not a mismatch", async () => {
  const { module: service, restore } = loadService({ members: [invite()] });
  try {
    const { reference } = await service.listInvitationsForUser({ user: VERIFIED });
    assert.deepEqual(reference, { state: "none", member: null });
  } finally {
    restore();
  }
});

test("a reference this account cannot reach says only that, and nothing about it", async () => {
  const { module: service, restore } = loadService({ members: [], lookup: [] });
  try {
    const { reference } = await service.listInvitationsForUser({
      user: VERIFIED,
      memberReference: "member-1",
    });
    // Not whose it is, not which team, not the address it was sent to. These
    // links are meant to be forwarded, so holding one you were never the
    // intended reader of has to reveal nothing.
    assert.deepEqual(reference, { state: "mismatch", member: null });
  } finally {
    restore();
  }
});

test("a reference to an invitation already answered is not reported as somebody else's", async () => {
  const { module: service, restore } = loadService({
    members: [],
    lookup: [invite({ inviteStatus: "accepted" })],
  });
  try {
    const { reference } = await service.listInvitationsForUser({
      user: VERIFIED,
      memberReference: "member-1",
    });
    assert.deepEqual(reference, { state: "answered", member: "member-1" });
  } finally {
    restore();
  }
});

test("a reference to an invitation that ran out says so, so the player can ask for another", async () => {
  const { module: service, restore } = loadService({
    members: [],
    lookup: [invite({ inviteStatus: "expired" })],
  });
  try {
    const { reference } = await service.listInvitationsForUser({
      user: VERIFIED,
      memberReference: "member-1",
    });
    assert.deepEqual(reference, { state: "expired", member: "member-1" });
  } finally {
    restore();
  }
});

test("a reference is resolved by identity, never taken on trust", async () => {
  const { module: service, restore, state } = loadService({ members: [], lookup: [] });
  try {
    await service.listInvitationsForUser({
      user: VERIFIED,
      memberReference: "member-1",
    });
    const direct = state.queries.find((query) => query.model === "savedTeamMember.findFirst");
    // The same identity filter the listing uses. Possession of the reference
    // adds nothing to it: it is not a credential and is not treated as one.
    assert.deepEqual(direct.args.where.OR, [
      { userId: "user-1" },
      { emailNormalized: "player@example.com", userId: null },
    ]);
  } finally {
    restore();
  }
});

test("accepting leaves the registration's own record of what was submitted alone", async () => {
  const { module: service, restore, state } = loadService({
    members: [invite()],
    openRegistrations: [{ id: "registration-1" }],
  });
  try {
    await service.respondToInvitation({
      invitationId: "member-1",
      decision: "accept",
      user: VERIFIED,
    });

    const [{ data, where }] = state.registrationMemberUpdates;
    // A registration member carries the game identifier that tournament's
    // rules asked for, and it is evidence of what was submitted for that
    // event. Accepting an invitation answers the invitation; it does not get
    // to revise the record.
    assert.deepEqual(Object.keys(data).sort(), [
      "inviteExpiresAt",
      "inviteRespondedAt",
      "inviteStatus",
      "inviteTokenHash",
      "userId",
    ]);
    // And only rows still waiting on an answer, inside registrations still
    // open to their roster. An approved or cancelled registration has had its
    // roster settled and is not listening any more.
    assert.deepEqual(where.inviteStatus, { in: ["pending"] });
    assert.deepEqual(where.registrationId, { in: ["registration-1"] });

    const [{ args }] = state.queries.filter((query) => query.model === "teamRegistration");
    assert.deepEqual(args.where.status, { in: ["pending", "waitlisted"] });
  } finally {
    restore();
  }
});

test("accepting takes no captain-entered identity with it", async () => {
  const { module: service, restore, state } = loadService({ members: [invite()] });
  try {
    await service.respondToInvitation({
      invitationId: "member-1",
      decision: "accept",
      user: VERIFIED,
    });
    const [{ data }] = state.savedTeamMemberUpdates;
    // What acceptance writes is the link to the account and the answer. A
    // captain's guess at somebody's Discord or game id is not promoted to that
    // person's identity by them saying yes.
    assert.deepEqual(Object.keys(data).sort(), [
      "inviteExpiresAt",
      "inviteRespondedAt",
      "inviteStatus",
      "inviteTokenHash",
      "userId",
    ]);
    assert.equal(data.userId, "user-1");
    assert.equal(data.inviteStatus, "accepted");
  } finally {
    restore();
  }
});
