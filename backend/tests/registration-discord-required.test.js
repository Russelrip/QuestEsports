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

// `discordRequired` used to be reported by the readiness endpoint and by
// nothing else, which made it advice: the registrations endpoint accepted a
// POST whether or not anyone had asked the panel what it would have said.
// These cover the server-side half.

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

test("a roster member with no connected Discord is refused, by name", async () => {
  const { module: service, restore } = load({ linkedEmails: [] });

  try {
    await assert.rejects(
      () => service.createConfiguredRegistration({ slug: tournament.slug, body, user }),
      (error) => {
        assert.equal(error.statusCode, 409);
        // The captain cannot fix this themselves and has to go ask specific
        // people to connect, so the message has to say who.
        assert.match(error.message, /Player Two/);
        assert.match(error.message, /connected Discord account/);
        return true;
      },
    );
  } finally { restore(); }
});

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

test("the guard covers the coach, and reports everyone at once", () => {
  const { module: service, restore } = load();

  try {
    assert.throws(
      () => service.assertConnectedDiscordWhenRequired({
        tournament: { discordRequired: true },
        members: [
          { name: "Captain", role: "CAPTAIN", discord: "captain-discord" },
          { name: "Player Two", role: "PLAYER", discord: null },
          // A coach is on the roster to be reachable during an event, which is
          // the whole point of the requirement.
          { name: "Coach Example", role: "COACH", discord: null },
        ],
      }),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /Player Two, Coach Example/);
        // Naming one at a time would make a five-person roster five attempts.
        assert.doesNotMatch(error.message, /Captain,/);
        return true;
      },
    );
  } finally { restore(); }
});

test("a fully connected roster raises nothing", () => {
  const { module: service, restore } = load();

  try {
    assert.equal(
      service.assertConnectedDiscordWhenRequired({
        tournament: { discordRequired: true },
        members: [
          { name: "Captain", role: "CAPTAIN", discord: "captain-discord" },
          { name: "Coach Example", role: "COACH", discord: "coach-discord" },
        ],
      }),
      undefined,
    );
  } finally { restore(); }
});

test("an absent flag is treated as off, not as truthy", () => {
  const { module: service, restore } = load();

  try {
    for (const discordRequired of [false, undefined, null]) {
      assert.equal(
        service.assertConnectedDiscordWhenRequired({
          tournament: { discordRequired },
          members: [{ name: "Player Two", role: "PLAYER", discord: null }],
        }),
        undefined,
      );
    }
  } finally { restore(); }
});
