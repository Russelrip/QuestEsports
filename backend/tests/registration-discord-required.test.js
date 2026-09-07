const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/tournaments/registration.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");
const teamServicePath = path.join(__dirname, "../src/modules/teams/team.service.js");
const paymentServicePath = path.join(__dirname, "../src/modules/payments/payment.service.js");
const bankTransferServicePath = path.join(__dirname, "../src/modules/payments/bank-transfer.service.js");

// Where the Discord requirement is enforced, and where it deliberately is not.
//
// It was briefly enforced when the captain submitted, over the whole roster.
// That could not work: the handles are resolved from the invitees' own linked
// accounts, so the captain was refused for a gap only somebody else could
// close, and had no way to close it on their behalf. The roster half now lives
// on accepting an invitation — see invitation.service.test.js — where the
// person being asked is the person who can act.
//
// What stays here is the captain's own link, which they can always fix, and is
// required for every tournament rather than only the ones that ask.

const tournament = {
  id: "tournament-1",
  slug: "quest-cup",
  title: "Quest Cup",
  isPublished: true,
  status: "registration_open",
  registrationOpenAt: null,
  registrationDeadline: null,
  registrationFeeAmount: 0,
  registrationFeeCurrency: "LKR",
  paymentMethod: "free",
  reservationMinutes: 15,
  maxTeams: 16,
  entryType: "team",
  minRosterSize: 1,
  maxRosterSize: 5,
  maxSubstitutes: 2,
  registrationFields: [],
  discordRequired: true,
  updatedAt: new Date("2026-07-17T00:00:00.000Z"),
};

const user = {
  id: "user-1",
  firstName: "Quest",
  lastName: "Captain",
  email: "captain@example.com",
  phone: "0770000000",
};

const body = {
  teamName: "Quest Five",
  teamTag: "Q5",
  country: "Sri Lanka",
  captainName: "Quest Captain",
  captainPhone: "0771111111",
  captainRiotId: "Captain#002",
  contactEmail: "contact@example.com",
  rulebookAccepted: true,
  falsityWarningAccepted: true,
  members: JSON.stringify([
    { name: "Player Two", email: "player@example.com", gameId: "PlayerTwo#456", role: "PLAYER" },
  ]),
};

// Only the accounts named here have a linked Discord. Everyone else on the
// roster resolves to no handle, which is what the rule is about.
const load = ({ linkedEmails = [], discordRequired = true } = {}) => {
  const accounts = linkedEmails.map((email, index) => ({
    id: `account-${index}`,
    emailNormalized: email,
  }));

  return loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        tournament: {
          findFirst: async () => ({ ...tournament, discordRequired, series: null }),
        },
        teamRegistration: { findFirst: async () => null },
        oAuthAccount: {
          findFirst: async () => ({
            providerUserId: "900000000000000001",
            user: { discordTag: "captain-discord" },
          }),
          findMany: async ({ where }) => where.userId.in.map((userId) => ({
            userId,
            providerUserId: `9000000000000000${userId.slice(-1)}`,
            user: { discordTag: `linked-${userId}` },
          })),
        },
        user: { findMany: async () => accounts },
        // A sentinel rather than a working transaction. The guard sits ahead of
        // it, so reaching this is precisely what "the roster passed" means, and
        // asserting it beats asserting "some other error happened".
        $transaction: async () => {
          throw new Error("REACHED_TRANSACTION");
        },
      },
    },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServicePath]: { ensureTeamRegistrationSaved: async () => undefined },
    [paymentServicePath]: { assertPayHereConfigured: () => undefined },
    [bankTransferServicePath]: {},
  });
};

test("the same roster passes once that member has connected", async () => {
  const { module: service, restore } = load({ linkedEmails: ["player@example.com"] });

  try {
    await assert.rejects(
      () => service.createConfiguredRegistration({ slug: tournament.slug, body, user }),
      /REACHED_TRANSACTION/,
    );
  } finally { restore(); }
});

test("the rule is off unless the tournament asks for it", async () => {
  // The same unconnected roster that was refused above, on a tournament that
  // did not ask for the requirement.
  const { module: service, restore } = load({ linkedEmails: [], discordRequired: false });

  try {
    await assert.rejects(
      () => service.createConfiguredRegistration({ slug: tournament.slug, body, user }),
      /REACHED_TRANSACTION/,
    );
  } finally { restore(); }
});

test("a captain without a connected Discord cannot register at all", async () => {
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        tournament: { findFirst: async () => ({ ...tournament, discordRequired: false, series: null }) },
        teamRegistration: { findFirst: async () => null },
        // No linked account for the captain.
        oAuthAccount: { findFirst: async () => null, findMany: async () => [] },
        user: { findMany: async () => [] },
        $transaction: async () => { throw new Error("REACHED_TRANSACTION"); },
      },
    },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServicePath]: { ensureTeamRegistrationSaved: async () => undefined },
    [paymentServicePath]: { assertPayHereConfigured: () => undefined },
    [bankTransferServicePath]: {},
  });

  try {
    // Their own link, on a tournament that does not even ask for one: a roster
    // Quest cannot reach during an event is not a roster, and unlike their
    // teammates' links this is one the captain can go and fix right now.
    await assert.rejects(
      () => service.createConfiguredRegistration({ slug: tournament.slug, body, user }),
      (error) => {
        assert.equal(error.statusCode, 403);
        assert.match(error.message, /Connect your Discord account/);
        return true;
      },
    );
  } finally { restore(); }
});

// The captain cannot connect Discord for anyone else, so being refused for a
// teammate's missing link left them with a registration they had no way to
// complete. The requirement is enforced when that teammate accepts instead.
test("a roster member with no connected Discord no longer blocks the captain", async () => {
  const { module: service, restore } = load({ linkedEmails: [] });

  try {
    await assert.rejects(
      () => service.createConfiguredRegistration({ slug: tournament.slug, body, user }),
      /REACHED_TRANSACTION/,
    );
  } finally { restore(); }
});

test("the roster gate is gone from submission entirely, asked for or not", () => {
  const { module: service, restore } = load();

  try {
    assert.equal(service.assertConnectedDiscordWhenRequired, undefined);
  } finally { restore(); }
});
