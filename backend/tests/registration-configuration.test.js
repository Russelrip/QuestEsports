const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/tournaments/registration.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const uploadPath = path.join(__dirname, "../src/middleware/upload.js");
const teamPath = path.join(__dirname, "../src/modules/teams/team.service.js");
const paymentPath = path.join(__dirname, "../src/modules/payments/payment.service.js");
const generatedPath = path.join(__dirname, "../src/generated/prisma/index.js");

const load = () => loadModuleWithMocks(servicePath, {
  [prismaPath]: { prisma: {} },
  [uploadPath]: {},
  [teamPath]: {},
  [paymentPath]: {},
  [generatedPath]: { Prisma: {} },
});

test("configured registration fields support entry and member scopes", () => {
  const { module: service, restore } = load();
  try {
    const result = service.validateConfiguredFields({
      definitions: [
        { key: "region", label: "Region", type: "select", scope: "entry", required: true, options: ["Sri Lanka", "India"] },
        { key: "pubgId", label: "PUBG Mobile ID", type: "number", scope: "member", required: true },
      ],
      entryData: { region: "Sri Lanka" },
      members: [{ additionalData: { pubgId: "12345" } }],
    });
    assert.deepEqual(result.entryData, { region: "Sri Lanka" });
    assert.deepEqual(result.members[0].additionalData, { pubgId: "12345" });
  } finally { restore(); }
});

test("coach registration members can carry nullable contact data alongside configured fields", () => {
  const { module: service, restore } = load();
  try {
    const coach = {
      role: "COACH",
      name: "Coach Example",
      email: null,
      phone: null,
      additionalData: { coachingLicense: "LIC-123" },
    };
    const result = service.validateConfiguredFields({
      definitions: [
        { key: "coachingLicense", label: "Coaching License", type: "text", scope: "member", required: true },
      ],
      entryData: {},
      members: [coach],
    });

    assert.equal(result.members[0].role, "COACH");
    assert.equal(result.members[0].phone, null);
    assert.deepEqual(result.members[0].additionalData, { coachingLicense: "LIC-123" });
  } finally { restore(); }
});

test("configured registration fields reject missing, invalid select, and invalid number values", () => {
  const { module: service, restore } = load();
  try {
    assert.throws(() => service.validateConfiguredFields({ definitions: [{ key: "riot", label: "Riot ID", type: "text", scope: "entry", required: true }], entryData: {}, members: [] }), /Riot ID is required/);
    assert.throws(() => service.validateConfiguredFields({ definitions: [{ key: "region", label: "Region", type: "select", scope: "entry", required: true, options: ["LK"] }], entryData: { region: "EU" }, members: [] }), /Region has an invalid selection/);
    assert.throws(() => service.validateConfiguredFields({ definitions: [{ key: "id", label: "Player ID", type: "number", scope: "member", required: true }], entryData: {}, members: [{ additionalData: { id: "abc" } }] }), /Player ID must be a number/);
  } finally { restore(); }
});

test("Valorant registrations require a complete Riot ID for every roster member", () => {
  const { module: service, restore } = load();
  try {
    assert.doesNotThrow(() => service.validateGameIdentities({
      game: "Valorant",
      members: [{ riotId: "QuestCaptain#123" }, { riotId: "PlayerTwo#APAC" }],
    }));
    assert.throws(
      () => service.validateGameIdentities({ game: "Valorant", members: [{ riotId: "QuestCaptain" }] }),
      /PlayerName#123/
    );
    assert.throws(
      () => service.validateGameIdentities({ game: "Valorant", members: [{ riotId: "" }] }),
      /required for every roster member/
    );
  } finally { restore(); }
});

test("coach normalization omits empty optional coaches and normalizes complete coaches", () => {
  const { module: service, restore } = load();
  try {
    const tournament = { allowCoach: true, coachRequired: false, game: "Valorant" };
    assert.equal(service.normalizeCoachSubmission({ tournament, body: {} }), null);
    assert.deepEqual(
      service.normalizeCoachSubmission({
        tournament,
        body: {
          coach: JSON.stringify({
            name: "  Coach Example ",
            email: " COACH@EXAMPLE.COM ",
            phone: " 0770000000 ",
            discord: " coach-example ",
            gameId: "CoachName#123",
          }),
        },
      }),
      {
        name: "Coach Example",
        email: "coach@example.com",
        phone: "0770000000",
        // A typed handle is discarded here on purpose. The coach's Discord is
        // resolved from their connected account at submission time, so
        // normalization deliberately leaves the field empty rather than
        // carrying an unverified string forward.
        discord: null,
        riotId: "CoachName#123",
      }
    );
  } finally { restore(); }
});

test("coach normalization rejects partial, required, disabled, and invalid coach details", () => {
  const { module: service, restore } = load();
  try {
    assert.throws(
      () => service.normalizeCoachSubmission({
        tournament: { allowCoach: true, coachRequired: false, game: "Valorant" },
        body: { coach: JSON.stringify({ name: "Incomplete Coach" }) },
      }),
      /Every coach needs/
    );
    assert.throws(
      () => service.normalizeCoachSubmission({
        tournament: { allowCoach: true, coachRequired: true, game: "Valorant" },
        body: {},
      }),
      /complete coach is required/
    );
    assert.throws(
      () => service.normalizeCoachSubmission({
        tournament: { allowCoach: false, coachRequired: false, game: "Valorant" },
        body: { coach: JSON.stringify({ name: "Coach" }) },
      }),
      /does not accept coach/
    );
    assert.throws(
      () => service.normalizeCoachSubmission({
        tournament: { allowCoach: true, coachRequired: false, game: "Valorant" },
        body: {
          coach: JSON.stringify({
            name: "Coach Example",
            email: "not-an-email",
            phone: "0770000000",
            discord: "coach-example",
            riotId: "Invalid Riot ID",
          }),
        },
      }),
      /Every coach needs/
    );
    assert.throws(
      () => service.normalizeCoachSubmission({
        tournament: { allowCoach: true, coachRequired: false, game: "Valorant" },
        body: { coach: "{not-json" },
      }),
      /Coach details must be valid JSON/
    );
    assert.throws(
      () => service.normalizeCoachSubmission({
        tournament: { allowCoach: true, coachRequired: false, game: "Valorant" },
        body: { coach: JSON.stringify([]) },
      }),
      /single object/
    );
    assert.throws(
      () => service.normalizeCoachSubmission({
        tournament: { allowCoach: true, coachRequired: false, game: "Valorant" },
        body: {
          coach: JSON.stringify({
            name: "C".repeat(101),
            email: "coach@example.com",
            phone: "0770000000",
            discord: "coach-example",
            riotId: "CoachName#123",
          }),
        },
      }),
      /coach fields exceed/
    );
  } finally { restore(); }
});

test("a complete coach does not change configured player roster counts", () => {
  const { module: service, restore } = load();
  try {
    const tournament = {
      allowCoach: true,
      coachRequired: true,
      game: "Valorant",
      entryType: "team",
      minRosterSize: 5,
      maxRosterSize: 5,
      maxSubstitutes: 2,
      registrationFields: [],
    };
    const submission = service.normalizeRegistrationSubmission({
      tournament,
      user: { firstName: "Quest", lastName: "Captain", email: "captain@example.com" },
      body: {
        teamName: "Quest Five",
        teamTag: "Q5",
        country: "Sri Lanka",
        captainName: "Quest Captain",
        phone: "0770000000",
        discord: "captain-discord",
        gameId: "Captain#123",
        contactEmail: "captain@example.com",
        rulebookAccepted: true,
        falsityWarningAccepted: true,
        members: JSON.stringify(Array.from({ length: 4 }, (_, index) => ({
          name: `Player ${index + 2}`,
          email: `player${index + 2}@example.com`,
          gameId: `Player${index + 2}#123`,
          role: "PLAYER",
        }))),
        coach: JSON.stringify({
          name: "Coach Example",
          email: "coach@example.com",
          phone: "0771111111",
          discord: "coach-discord",
          gameId: "CoachName#123",
        }),
      },
    });

    assert.equal(submission.members.length, 5);
    assert.equal(submission.members.filter((member) => member.role === "PLAYER").length, 4);
    assert.equal(submission.members.some((member) => member.role === "COACH"), false);
    assert.equal(submission.coach.name, "Coach Example");
    assert.equal(submission.coach.phone, "0771111111");
    // Left empty by normalization; filled from the coach's connected account.
    assert.equal(submission.coach.discord, null);
    assert.equal(submission.coach.riotId, "CoachName#123");
  } finally { restore(); }
});

test("a submitted coach cannot share a captain or player email or Riot ID", () => {
  const { module: service, restore } = load();
  const tournament = {
    allowCoach: true,
    coachRequired: false,
    game: "Valorant",
    entryType: "team",
    minRosterSize: 1,
    maxRosterSize: 2,
    maxSubstitutes: 1,
    registrationFields: [],
  };

  const makeBody = (coach, captainRiotId = "Captain#123") => ({
    teamName: "Conflict Team",
    phone: "0770000000",
    discord: "captain-discord",
    gameId: captainRiotId,
    contactEmail: "captain@example.com",
    rulebookAccepted: true,
    falsityWarningAccepted: true,
    members: JSON.stringify([{
      name: "Player Two",
      email: "player@example.com",
      gameId: "PlayerTwo#123",
      role: "PLAYER",
    }]),
    coach: JSON.stringify(coach),
  });

  try {
    for (const [label, body] of [
      [
        "email",
        makeBody({
          name: "Coach Example",
          email: " CAPTAIN@EXAMPLE.COM ",
          phone: "0771111111",
          discord: "coach-discord",
          gameId: "CoachName#123",
        }),
      ],
      [
        "Riot ID",
        makeBody({
          name: "Coach Example",
          email: "coach@example.com",
          phone: "0771111111",
          discord: "coach-discord",
          gameId: " playerTWO#123 ",
        }),
      ],
    ]) {
      assert.throws(
        () => service.normalizeRegistrationSubmission({
          tournament,
          user: { firstName: "Quest", lastName: "Captain", email: "captain@example.com" },
          body,
        }),
        (error) => error.statusCode === 409 &&
          error.message === "This person cannot be both a coach and a player in the same tournament.",
        `${label} conflict should be rejected`
      );
    }
  } finally { restore(); }
});
