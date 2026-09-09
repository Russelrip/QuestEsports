const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/tournaments/registration.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");
const teamServicePath = path.join(__dirname, "../src/modules/teams/team.service.js");
const registrationMailModulePath = path.join(
  __dirname,
  "../src/lib/mail/sendRegistrationReceivedEmail.js"
);
const paymentServicePath = path.join(__dirname, "../src/modules/payments/payment.service.js");
const bankTransferServicePath = path.join(
  __dirname,
  "../src/modules/payments/bank-transfer.service.js"
);

const tournament = {
  id: "tournament-1",
  slug: "quest-cup",
  title: "Quest Cup",
  isPublished: true,
  status: "registration_open",
  registrationOpenAt: null,
  registrationDeadline: null,
  registrationFeeAmount: 2500,
  registrationFeeCurrency: "LKR",
  paymentMethod: "payhere",
  reservationMinutes: 15,
  maxTeams: 16,
  entryType: "team",
  minRosterSize: 1,
  maxRosterSize: 5,
  maxSubstitutes: 2,
  registrationFields: [],
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
  teamName: "Updated Quest",
  teamTag: "UQ",
  country: "Sri Lanka",
  captainName: "Updated Captain",
  captainPhone: "0771111111",
  captainDiscord: "updated-captain",
  captainRiotId: "Captain#002",
  contactEmail: "contact@example.com",
  rulebookAccepted: true,
  falsityWarningAccepted: true,
  members: JSON.stringify([]),
};

test("bank-transfer references are short and banking-app friendly", () => {
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [teamServicePath]: {},
    [paymentServicePath]: {},
    [bankTransferServicePath]: {},
  });

  try {
    const reference = service.buildPaymentOrderId("bank_transfer");
    assert.match(reference, /^[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.equal(reference.length, 8);
  } finally {
    restore();
  }
});

// A team registration must end up with a logo, which is not the same as
// demanding an upload. Reusing a saved team is the common path and that team
// usually already has one — asking for the file again would strand the captains
// who no longer have it.

const logoTournament = { ...tournament, minRosterSize: 5, maxRosterSize: 5 };

const logoHarness = ({ savedTeamLogo = null, existingRegistration = null } = {}) => ({
  [prismaModulePath]: {
    prisma: {
      savedTeam: {
        findUnique: async () => (savedTeamLogo ? { logoName: savedTeamLogo } : null),
      },
      tournament: { findFirst: async () => logoTournament },
      teamRegistration: { findFirst: async () => existingRegistration },
      user: { findUnique: async () => user, findFirst: async () => user, findMany: async () => [user] },
      oAuthAccount: { findFirst: async () => ({ providerUserId: "discord-1" }), findMany: async () => [] },
      registrationMember: { findFirst: async () => null, findMany: async () => [] },
      savedTeamMember: { findFirst: async () => null, findMany: async () => [] },
      player: { findUnique: async () => null },
      gameAccount: { findMany: async () => [] },
    },
  },
  [uploadModulePath]: { persistTeamLogoUpload: async () => null, teamLogoDirectory: "uploads/team-logos" },
  [teamServicePath]: {},
  [paymentServicePath]: { assertPayHereConfigured: () => undefined },
  [bankTransferServicePath]: {},
});

const fiveValidMembers = JSON.stringify(
  Array.from({ length: 4 }, (unused, index) => ({
    name: `Player ${index + 1}`,
    email: `player-${index + 1}@example.com`,
    gameId: `Player${index + 1}#001`,
    role: "PLAYER",
  }))
);

test("a team registration with no logo anywhere is refused", async () => {
  const { module: service, restore } = loadModuleWithMocks(servicePath, logoHarness());

  try {
    await assert.rejects(
      () => service.createConfiguredRegistration({
        slug: logoTournament.slug,
        body: { ...body, members: fiveValidMembers },
        user,
      }),
      (error) => {
        assert.equal(error.statusCode, 400);
        // Names both ways out, because a captain with no file to hand may still
        // have a saved team that already carries one.
        assert.match(error.message, /team logo is required/i);
        assert.match(error.message, /saved team/i);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test("a saved team that already has a logo satisfies the requirement", async () => {
  const { module: service, restore } = loadModuleWithMocks(
    servicePath,
    logoHarness({ savedTeamLogo: "quest-five.webp" })
  );

  let failure = null;
  try {
    await service.createConfiguredRegistration({
      slug: logoTournament.slug,
      body: { ...body, members: fiveValidMembers },
      user,
    });
  } catch (error) {
    failure = error;
  } finally {
    restore();
  }

  // Getting past the logo check is the assertion. Whatever this registration
  // goes on to do under a deliberately thin harness, it was not stopped for a
  // file Quest already holds.
  if (failure) {
    assert.doesNotMatch(failure.message || "", /team logo is required/i);
  }
});

test("a retry is never asked for a logo, including one that has none", async () => {
  const { module: service, restore } = loadModuleWithMocks(
    servicePath,
    logoHarness({
      existingRegistration: {
        id: "registration-1",
        paymentStatus: "unpaid",
        entryType: "team",
        // Registered before the rule existed, so it carries no logo at all.
        teamLogoName: null,
      },
    })
  );

  let failure = null;
  try {
    await service.createConfiguredRegistration({
      slug: logoTournament.slug,
      body: { ...body, members: fiveValidMembers },
      user,
    });
  } catch (error) {
    failure = error;
  } finally {
    restore();
  }

  // A retry is a captain coming back to pay for a registration Quest already
  // accepted. Applying a new rule at the checkout would strand them for
  // something that was not asked when they entered.
  if (failure) {
    assert.doesNotMatch(failure.message || "", /team logo is required/i);
  }
});

test("captains can cancel their own unpaid tournament registration", async () => {
  let deletedId = null;
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
        teamRegistration: {
          findFirst: async () => ({
            id: "registration-1",
            paymentStatus: "unpaid",
            teamLogoName: null,
          }),
          delete: async ({ where }) => {
            deletedId = where.id;
          },
        },
      },
    },
    [uploadModulePath]: {},
    [teamServicePath]: {},
    [paymentServicePath]: {},
    [bankTransferServicePath]: {},
  });

  try {
    await service.cancelUnpaidRegistration({ slug: tournament.slug, user });
    assert.equal(deletedId, "registration-1");
  } finally {
    restore();
  }
});

test("captains cannot cancel after a payment reservation has started", async () => {
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
        teamRegistration: {
          findFirst: async () => ({
            id: "registration-1",
            paymentStatus: "pending",
            teamLogoName: null,
          }),
        },
      },
    },
    [uploadModulePath]: {},
    [teamServicePath]: {},
    [paymentServicePath]: {},
    [bankTransferServicePath]: {},
  });

  try {
    await assert.rejects(
      () => service.cancelUnpaidRegistration({ slug: tournament.slug, user }),
      (error) => error.statusCode === 409
    );
  } finally {
    restore();
  }
});

test("captains must contact an administrator after their payment window expires", async () => {
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
        teamRegistration: {
          findFirst: async () => ({
            id: "registration-1",
            paymentStatus: "unpaid",
            teamLogoName: null,
            payments: [{ status: "expired" }],
          }),
        },
      },
    },
    [uploadModulePath]: {},
    [teamServicePath]: {},
    [paymentServicePath]: {},
    [bankTransferServicePath]: {},
  });

  try {
    await assert.rejects(
      () => service.cancelUnpaidRegistration({ slug: tournament.slug, user }),
      (error) => error.statusCode === 409 && /administrator/.test(error.message)
    );
  } finally {
    restore();
  }
});

test("roster validation explains that the captain counts as an active player", async () => {
  const fivePlayerTournament = {
    ...tournament,
    minRosterSize: 5,
    maxRosterSize: 5,
  };
  const members = [
    ...Array.from({ length: 5 }, (_, index) => ({
      name: `Player ${index + 1}`,
      email: `player${index + 1}@example.com`,
      role: "PLAYER",
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      name: `Substitute ${index + 1}`,
      email: `substitute${index + 1}@example.com`,
      role: "SUBSTITUTE",
    })),
  ];
  const { module: service, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
        tournament: { findFirst: async () => fivePlayerTournament },
        teamRegistration: { findFirst: async () => null },
      },
    },
    [uploadModulePath]: {},
    [teamServicePath]: {},
    [paymentServicePath]: { assertPayHereConfigured: () => undefined },
    [bankTransferServicePath]: {},
  });

  try {
    await assert.rejects(
      () => service.createConfiguredRegistration({
        slug: fivePlayerTournament.slug,
        body: { ...body, members: JSON.stringify(members) },
        user,
      }),
      (error) => {
        assert.equal(error.statusCode, 400);
        assert.equal(
          error.message,
          "This event requires exactly 5 active players, including the captain, and allows up to 2 substitutes. Your roster has 6 active players and 2 substitutes."
        );
        return true;
      }
    );
  } finally {
    restore();
  }
});

test("paid direct team registration saves the team and dispatches player invites immediately", async () => {
  const syncedTeams = [];
  const sentInvites = [];
  const sentRegistrationConfirmations = [];
  let createdRegistration;
  let createdMembers;
  let registrationTransactionActive = false;
  let tournamentLookupAttempts = 0;
  const valorantTournament = {
    ...tournament,
    game: "Valorant",
    allowCoach: true,
    coachRequired: false,
  };
  const tx = {
    tournament: { findUnique: async () => valorantTournament },
    teamRegistration: {
      count: async () => 0,
      findMany: async () => [],
      findFirst: async () => null,
      create: async ({ data }) => {
        createdRegistration = data;
        return { ...data, id: data.id };
      },
    },
    registrationMember: {
      createMany: async ({ data }) => {
        createdMembers = data;
        return { count: data.length };
      },
    },
    paymentTransaction: {
      create: async ({ data }) => ({ ...data, status: "created" }),
    },
  };
  const prisma = {
    savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    // Registration resolves every roster Discord handle from connected
    // accounts now, so the captain's link has to exist for the flow to run.
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    tournament: {
      findFirst: async () => {
        tournamentLookupAttempts += 1;
        if (tournamentLookupAttempts === 1) {
          const error = new Error("Timed out while acquiring a connection.");
          error.code = "P2024";
          throw error;
        }
        return valorantTournament;
      },
    },
    teamRegistration: { findFirst: async () => null },
    $transaction: async (work) => {
      registrationTransactionActive = true;
      try {
        return await work(tx);
      } finally {
        registrationTransactionActive = false;
      }
    },
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async (registrationId) => {
        assert.equal(registrationTransactionActive, false);
        const coach = createdMembers?.find((member) => member.role === "COACH");
        if (coach) {
          coach.inviteStatus = "pending";
          coach.inviteTokenHash = "coach-token-hash";
          coach.inviteSentAt = new Date();
          coach.inviteExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
          sentInvites.push({ email: coach.email });
        }
        syncedTeams.push(registrationId);
      },
      syncSavedTeamFromRegistration: async () => [{
        email: "coach@example.com",
        recipientName: "Coach Example",
        teamName: "Updated Quest",
        captainName: "Quest Captain",
        tournamentTitle: "Quest Cup",
        rawToken: "coach-token",
      }],
      sendTeamInvites: async (invites) => sentInvites.push(...invites),
    },
    [registrationMailModulePath]: {
      sendRegistrationReceivedEmail: async (confirmation) =>
        sentRegistrationConfirmations.push(confirmation),
    },
    [paymentServicePath]: {
      assertPayHereConfigured: () => undefined,
      createPayHereCheckout: ({ transaction }) => ({ orderId: transaction.providerOrderId }),
    },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => ({}),
      getBankTransferAmountForSlot: () => 2500,
    },
  });

  try {
    const result = await registrationService.createConfiguredRegistration({
      slug: valorantTournament.slug,
      body: {
        ...body,
        members: JSON.stringify([{
          name: "Player Two",
          email: "player@example.com",
          gameId: "PlayerTwo#456",
          role: "PLAYER",
        }]),
        coach: JSON.stringify({
          name: "Coach Example",
          email: "coach@example.com",
          phone: "0772222222",
          discord: "coach-example",
          gameId: "CoachName#123",
        }),
      },
      user,
    });

    assert.equal(createdRegistration.paymentStatus, "unpaid");
    assert.equal(createdRegistration.verificationStatus, "pending");
    assert.equal(result.awaitingTeamVerification, true);
    assert.equal(result.readyForPayment, false);
    assert.equal(result.pendingInviteCount, 2);
    assert.equal(result.checkout, null);
    assert.equal(result.paymentOrderId, null);
    assert.equal(createdRegistration.captainRiotId, "Captain#002");
    assert.equal(createdMembers[1].riotId, "PlayerTwo#456");
    assert.equal(createdMembers[2].role, "COACH");
    assert.equal(createdMembers[2].memberOrder, 1);
    assert.equal(createdMembers[2].phone, "0772222222");
    assert.equal(createdMembers[2].inviteStatus, "pending");
    assert.ok(createdMembers[2].inviteTokenHash);
    assert.ok(createdMembers[2].inviteSentAt instanceof Date);
    assert.ok(createdMembers[2].inviteExpiresAt instanceof Date);
    assert.equal(sentInvites.length, 1);
    assert.equal(sentInvites[0].email, "coach@example.com");
    assert.equal(sentRegistrationConfirmations.length, 1);
    assert.equal(sentRegistrationConfirmations[0].email, user.email);
    assert.equal(sentRegistrationConfirmations[0].pendingMemberCount, 2);
    assert.equal(syncedTeams.length, 1);
    assert.equal(syncedTeams[0], createdRegistration.id);
    assert.equal(tournamentLookupAttempts, 2);
  } finally {
    restore();
  }
});

test("a free open-entry registration is approved on submission when the tournament asks for it", async () => {
  let createdRegistration;
  const registrationUpdates = [];
  const audits = [];
  const freeTournament = {
    ...tournament,
    game: "Valorant",
    registrationFeeAmount: 0,
    paymentMethod: "free",
    autoApproveRegistrations: true,
    maxTeams: null,
  };
  let storedRegistration = null;
  const tx = {
    tournament: { findUnique: async () => freeTournament },
    teamRegistration: {
      count: async () => 0,
      findMany: async () => [],
      findFirst: async () => null,
      create: async ({ data }) => {
        createdRegistration = data;
        storedRegistration = { ...data, tournament: freeTournament };
        return { ...data, id: data.id };
      },
      findUnique: async () => storedRegistration,
      update: async (args) => {
        registrationUpdates.push(args);
        storedRegistration = { ...storedRegistration, ...args.data };
        return { ...storedRegistration };
      },
    },
    registrationMember: {
      createMany: async ({ data }) => ({ count: data.length }),
      findMany: async () => [],
    },
    paymentTransaction: { create: async ({ data }) => data },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  };
  const prisma = {
    savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    tournament: { findFirst: async () => freeTournament },
    teamRegistration: { findFirst: async () => null },
    $transaction: async (work) => work(tx),
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async () => undefined,
      sendTeamInvites: async () => undefined,
    },
    [registrationMailModulePath]: { sendRegistrationReceivedEmail: async () => undefined },
    [paymentServicePath]: { assertPayHereConfigured: () => undefined },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => ({}),
      getBankTransferAmountForSlot: () => 0,
    },
  });

  try {
    const result = await registrationService.createConfiguredRegistration({
      slug: freeTournament.slug,
      body: { ...body, members: JSON.stringify([]) },
      user,
    });

    // The captain is the whole roster and there is no fee, so nothing is
    // outstanding at the moment the row is written.
    assert.equal(createdRegistration.status, "pending");
    assert.equal(createdRegistration.paymentStatus, "paid");
    assert.deepEqual(registrationUpdates[0].data, { status: "approved" });
    assert.equal(result.registration.status, "approved");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorUserId, null);
    assert.equal(audits[0].source, "system");
  } finally {
    restore();
  }
});

// The free-event case above is a captain who is the whole roster. A free event
// with someone else on the roster is the case that was missing, and the one that
// was wrong: the roster gate used to be spelled `entryType === "team" && fee > 0`,
// so a free team event reported no outstanding invitations at all and its captain
// was handed a plain "registration submitted" for a roster nobody had accepted.
test("a free team event reports its outstanding invitations to the captain", async () => {
  let createdRegistration;
  let createdMembers;
  const registrationUpdates = [];
  const freeTournament = {
    ...tournament,
    game: "Valorant",
    registrationFeeAmount: 0,
    paymentMethod: "free",
    autoApproveRegistrations: true,
    maxTeams: null,
  };
  let storedRegistration = null;
  const tx = {
    tournament: { findUnique: async () => freeTournament },
    teamRegistration: {
      count: async () => 0,
      findMany: async () => [],
      findFirst: async () => null,
      create: async ({ data }) => {
        createdRegistration = data;
        storedRegistration = { ...data, tournament: freeTournament };
        return { ...data };
      },
      findUnique: async () => storedRegistration,
      update: async (args) => {
        registrationUpdates.push(args);
        storedRegistration = { ...storedRegistration, ...args.data };
        return { ...storedRegistration };
      },
    },
    registrationMember: {
      createMany: async ({ data }) => {
        createdMembers = data;
        return { count: data.length };
      },
      findMany: async () => [],
    },
    paymentTransaction: { create: async ({ data }) => data },
    auditLog: { create: async ({ data }) => data },
  };
  const prisma = {
    savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    tournament: { findFirst: async () => freeTournament },
    teamRegistration: { findFirst: async () => null },
    $transaction: async (work) => work(tx),
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async () => undefined,
      sendTeamInvites: async () => undefined,
    },
    [registrationMailModulePath]: { sendRegistrationReceivedEmail: async () => undefined },
    [paymentServicePath]: { assertPayHereConfigured: () => undefined },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => ({}),
      getBankTransferAmountForSlot: () => 0,
    },
  });

  try {
    const result = await registrationService.createConfiguredRegistration({
      slug: freeTournament.slug,
      body: {
        ...body,
        members: JSON.stringify([
          { name: "Player Two", email: "player@example.com", gameId: "PlayerTwo#456", role: "PLAYER" },
        ]),
      },
      user,
    });

    // The row was already right: an unaccepted roster is not verified, and
    // nothing auto-approves it.
    assert.equal(createdRegistration.verificationStatus, "pending");
    assert.equal(createdRegistration.status, "pending");
    assert.deepEqual(registrationUpdates, []);
    assert.equal(
      createdMembers.find((member) => member.role === "PLAYER").inviteStatus,
      "pending",
    );

    // What the captain is told about it is the part that was not.
    assert.equal(result.awaitingTeamVerification, true);
    assert.equal(result.pendingInviteCount, 1);
    // A free event has no payment step behind the confirmation, so confirming
    // the roster must not be reported as unlocking one.
    assert.equal(result.readyForPayment, false);
    assert.equal(createdRegistration.quotedFeeAmount, null);
    assert.equal(createdRegistration.reservedUntil, null);
  } finally {
    restore();
  }
});

// A free row is stored as paid the moment it is created, because capacity counts
// paid rows. That made "you are already registered" the only answer a free
// captain could get back while invitations were still outstanding — no roster
// state, and no route to the resend controls from the page they were on.
test("a free team captain can return to a roster that has not finished accepting", async () => {
  let repaired = null;
  const existing = {
    id: "registration-1",
    entryType: "team",
    teamName: "Quest Five",
    status: "pending",
    paymentStatus: "paid",
    verificationStatus: "pending",
    reservedUntil: null,
    assignedSlotNumber: null,
    members: [
      { role: "CAPTAIN", inviteStatus: "accepted" },
      { role: "PLAYER", inviteStatus: "pending" },
    ],
    payments: [],
  };
  const freeTournament = {
    ...tournament,
    registrationFeeAmount: 0,
    paymentMethod: "free",
    maxTeams: null,
  };
  const prisma = {
    savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    tournament: { findFirst: async () => freeTournament },
    teamRegistration: { findFirst: async () => existing },
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServicePath]: {
      // The same repair the paid path relies on: a registration whose invitation
      // dispatch was interrupted gets another chance at it here.
      ensureTeamRegistrationSaved: async (registrationId) => { repaired = registrationId; },
      sendTeamInvites: async () => undefined,
    },
    [registrationMailModulePath]: { sendRegistrationReceivedEmail: async () => undefined },
    [paymentServicePath]: { assertPayHereConfigured: () => undefined },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => ({}),
      getBankTransferAmountForSlot: () => 0,
    },
  });

  try {
    const result = await registrationService.createConfiguredRegistration({
      slug: freeTournament.slug,
      body,
      user,
    });

    assert.equal(result.awaitingTeamVerification, true);
    assert.equal(result.pendingInviteCount, 1);
    assert.equal(result.registration.verificationStatus, "pending");
    assert.equal(repaired, existing.id);
  } finally {
    restore();
  }
});

test("a free team registration everyone has accepted is still answered as already registered", async () => {
  const existing = {
    id: "registration-1",
    entryType: "team",
    teamName: "Quest Five",
    status: "approved",
    paymentStatus: "paid",
    verificationStatus: "verified",
    reservedUntil: null,
    assignedSlotNumber: null,
    members: [
      { role: "CAPTAIN", inviteStatus: "accepted" },
      { role: "PLAYER", inviteStatus: "accepted" },
    ],
    payments: [],
  };
  const freeTournament = {
    ...tournament,
    registrationFeeAmount: 0,
    paymentMethod: "free",
    maxTeams: null,
  };
  const prisma = {
    savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    tournament: { findFirst: async () => freeTournament },
    teamRegistration: { findFirst: async () => existing },
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async () => undefined,
      sendTeamInvites: async () => undefined,
    },
    [registrationMailModulePath]: { sendRegistrationReceivedEmail: async () => undefined },
    [paymentServicePath]: { assertPayHereConfigured: () => undefined },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => ({}),
      getBankTransferAmountForSlot: () => 0,
    },
  });

  try {
    // Reopening is for a roster that has not finished, not a second entry.
    await assert.rejects(
      () => registrationService.createConfiguredRegistration({
        slug: freeTournament.slug,
        body,
        user,
      }),
      (error) => error.statusCode === 409 && /already registered/.test(error.message),
    );
  } finally {
    restore();
  }
});

test("a reviewed tournament still submits its registration for approval", async () => {
  let createdRegistration;
  const registrationUpdates = [];
  const freeTournament = {
    ...tournament,
    game: "Valorant",
    registrationFeeAmount: 0,
    paymentMethod: "free",
    autoApproveRegistrations: false,
  };
  let storedRegistration = null;
  const tx = {
    tournament: { findUnique: async () => freeTournament },
    teamRegistration: {
      count: async () => 0,
      findMany: async () => [],
      findFirst: async () => null,
      create: async ({ data }) => {
        createdRegistration = data;
        storedRegistration = { ...data, tournament: freeTournament };
        return { ...data, id: data.id };
      },
      findUnique: async () => storedRegistration,
      update: async (args) => {
        registrationUpdates.push(args);
        return storedRegistration;
      },
    },
    registrationMember: {
      createMany: async ({ data }) => ({ count: data.length }),
      findMany: async () => [],
    },
    paymentTransaction: { create: async ({ data }) => data },
    auditLog: { create: async ({ data }) => data },
  };
  const prisma = {
    savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    tournament: { findFirst: async () => freeTournament },
    teamRegistration: { findFirst: async () => null },
    $transaction: async (work) => work(tx),
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async () => undefined,
      sendTeamInvites: async () => undefined,
    },
    [registrationMailModulePath]: { sendRegistrationReceivedEmail: async () => undefined },
    [paymentServicePath]: { assertPayHereConfigured: () => undefined },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => ({}),
      getBankTransferAmountForSlot: () => 0,
    },
  });

  try {
    const result = await registrationService.createConfiguredRegistration({
      slug: freeTournament.slug,
      body: { ...body, members: JSON.stringify([]) },
      user,
    });

    assert.equal(createdRegistration.status, "pending");
    assert.equal(registrationUpdates.length, 0);
    assert.equal(result.registration.status, "pending");
  } finally {
    restore();
  }
});

test("registration service enforces parent event windows on the initial lookup", async () => {
  for (const [label, series] of [
    ["before", { registrationOpenAt: new Date(Date.now() + 60_000), registrationCloseAt: null }],
    ["after", { registrationOpenAt: null, registrationCloseAt: new Date(Date.now() - 60_000) }],
  ]) {
    let lookupArgs;
    const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
      [prismaModulePath]: {
        prisma: {
          savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
          tournament: {
            findFirst: async (args) => {
              lookupArgs = args;
              return { ...tournament, series };
            },
          },
          teamRegistration: { findFirst: async () => null },
        },
      },
      [uploadModulePath]: {},
      [teamServicePath]: {},
      [paymentServicePath]: { assertPayHereConfigured: () => undefined },
      [bankTransferServicePath]: {},
    });

    try {
      await assert.rejects(
        () => registrationService.createConfiguredRegistration({
          slug: tournament.slug,
          body,
          user,
        }),
        (error) => error.statusCode === 409 && /closed/.test(error.message),
        `${label} parent boundary should reject registration`
      );
      assert.deepEqual(lookupArgs.include.series.select, {
        registrationOpenAt: true,
        registrationCloseAt: true,
        registrationStatusOverride: true,
      });
    } finally {
      restore();
    }
  }
});

test("registration service enforces a parent close observed by the transaction reload", async () => {
  const initialSeries = {
    registrationOpenAt: new Date(Date.now() - 60_000),
    registrationCloseAt: new Date(Date.now() + 60_000),
    registrationStatusOverride: null,
  };
  const closedSeries = {
    registrationOpenAt: new Date(Date.now() - 120_000),
    registrationCloseAt: new Date(Date.now() - 60_000),
    registrationStatusOverride: null,
  };
  const existing = {
    id: "registration-parent-close",
    entryType: "team",
    status: "pending",
    paymentStatus: "pending",
    verificationStatus: "verified",
    members: [{ role: "CAPTAIN", inviteStatus: "accepted" }],
    reservedUntil: new Date(Date.now() - 60_000),
    payments: [{ provider: "payhere", status: "failed", providerOrderId: "old-order" }],
  };
  const currentTournament = { ...tournament, series: closedSeries };
  const tx = {
    tournament: { findUnique: async () => currentTournament },
    teamRegistration: { findUnique: async () => existing },
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: {
      prisma: {
        savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
        tournament: { findFirst: async () => ({ ...tournament, series: initialSeries }) },
        teamRegistration: { findFirst: async () => existing },
        oAuthAccount: {
          findFirst: async () => ({
            providerUserId: "900000000000000001",
            user: { discordTag: "captain-discord" },
          }),
          findMany: async () => [],
        },
        user: { findMany: async () => [] },
        $transaction: async (work) => work(tx),
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
    await assert.rejects(
      () => registrationService.createConfiguredRegistration({ slug: tournament.slug, body, user }),
      (error) => error.statusCode === 409 && /closed/.test(error.message)
    );
  } finally {
    restore();
  }
});

test("a pending coach blocks team verification and payment", async () => {
  const pendingRegistration = {
    id: "registration-coach-pending",
    entryType: "team",
    teamName: "Coach Pending",
    status: "pending",
    paymentStatus: "unpaid",
    verificationStatus: "pending",
    captainPhone: "0771111111",
    country: "Sri Lanka",
    reservedUntil: null,
    members: [
      { role: "CAPTAIN", inviteStatus: "accepted" },
      { role: "COACH", inviteStatus: "pending" },
    ],
    payments: [],
  };
  const tx = {
    tournament: { findUnique: async () => tournament },
    teamRegistration: {
      findUnique: async () => pendingRegistration,
      count: async () => 0,
      findFirst: async () => null,
      update: async ({ data }) => ({ ...pendingRegistration, ...data }),
    },
    paymentTransaction: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }) => ({ ...data, status: "created" }),
    },
  };
  const prisma = {
    savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    // Registration resolves every roster Discord handle from connected
    // accounts now, so the captain's link has to exist for the flow to run.
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    tournament: { findFirst: async () => tournament },
    teamRegistration: { findFirst: async () => pendingRegistration },
    $transaction: async (work) => work(tx),
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async () => undefined,
    },
    [paymentServicePath]: {
      assertPayHereConfigured: () => undefined,
      createPayHereCheckout: ({ transaction }) => ({ orderId: transaction.providerOrderId }),
    },
    [bankTransferServicePath]: {},
  });

  try {
    const result = await registrationService.createConfiguredRegistration({
        slug: tournament.slug,
        body: { resumePayment: true },
        user,
      });
    assert.equal(result.awaitingTeamVerification, true);
    assert.equal(result.readyForPayment, false);
    assert.equal(result.paymentOrderId, null);
  } finally {
    restore();
  }
});

test("captain-only direct registration repairs stale verification and starts payment", async () => {
  let registrationPaymentUpdate;
  let createdPayment;
  let consumedHoldId;
  const verifiedRegistration = {
    id: "registration-verified",
    entryType: "team",
    teamName: "Updated Quest",
    status: "pending",
    paymentStatus: "unpaid",
    verificationStatus: "pending",
    captainPhone: "0771111111",
    country: "Sri Lanka",
    reservedUntil: null,
    members: [{ inviteStatus: "accepted" }],
    payments: [],
  };
  const tx = {
    tournament: { findUnique: async () => tournament },
    teamRegistration: {
      findUnique: async () => verifiedRegistration,
      count: async () => 0,
      findMany: async () => [],
      findFirst: async () => null,
      update: async ({ data }) => {
        registrationPaymentUpdate = data;
        return { ...verifiedRegistration, ...data };
      },
    },
    paymentTransaction: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }) => {
        createdPayment = data;
        return { ...data, status: "created" };
      },
    },
    adminSlotReservation: {
      findUnique: async () => ({
        id: "hold-1",
        assignedSlotNumber: 4,
        quotedFeeAmount: 1750,
        quotedFeeCurrency: "LKR",
      }),
      delete: async ({ where }) => {
        consumedHoldId = where.id;
      },
    },
  };
  const prisma = {
    savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    // Registration resolves every roster Discord handle from connected
    // accounts now, so the captain's link has to exist for the flow to run.
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    tournament: { findFirst: async () => tournament },
    teamRegistration: { findFirst: async () => verifiedRegistration },
    $transaction: async (work) => work(tx),
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async () => undefined,
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
    [paymentServicePath]: {
      assertPayHereConfigured: () => undefined,
      createPayHereCheckout: ({ transaction }) => ({ orderId: transaction.providerOrderId }),
    },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => ({}),
      getBankTransferAmountForSlot: () => 2500,
    },
  });

  try {
    const result = await registrationService.createConfiguredRegistration({
      slug: tournament.slug,
      body: { resumePayment: true },
      user,
    });

    assert.equal(registrationPaymentUpdate.paymentStatus, "pending");
    assert.equal(registrationPaymentUpdate.verificationStatus, "verified");
    assert.equal(registrationPaymentUpdate.assignedSlotNumber, 4);
    assert.equal(registrationPaymentUpdate.quotedFeeAmount, 1750);
    assert.equal(createdPayment.amount, 1750);
    assert.equal(consumedHoldId, "hold-1");
    assert.ok(registrationPaymentUpdate.reservedUntil instanceof Date);
    assert.match(result.paymentOrderId, /^TOUR-/);
    assert.equal(result.checkout.orderId, result.paymentOrderId);
  } finally {
    restore();
  }
});

test("createConfiguredRegistration lets an active payment reservation retry after registration closes", async () => {
  const removedUploads = [];
  const sentRegistrationConfirmations = [];
  let registrationUpdate;
  let memberRows;
  const retryTournament = {
    ...tournament,
    status: "upcoming",
    series: {
      registrationOpenAt: new Date(Date.now() - 120_000),
      registrationCloseAt: new Date(Date.now() - 60_000),
      registrationStatusOverride: null,
    },
  };
  const existing = {
    id: "registration-1",
    teamLogoName: "old-logo.png",
    paymentStatus: "pending",
    verificationStatus: "verified",
    members: [{ inviteStatus: "accepted" }],
    reservedUntil: new Date(Date.now() + 5 * 60 * 1000),
    payments: [{ provider: "payhere", status: "failed", providerOrderId: "old-order" }],
  };
  const tx = {
    tournament: { findUnique: async () => retryTournament },
    teamRegistration: {
      findUnique: async () => existing,
      count: async () => 0,
      findMany: async () => [],
      findFirst: async () => null,
      update: async ({ data }) => {
        registrationUpdate = data;
        return { ...existing, ...data, entryType: "team" };
      },
    },
    registrationMember: {
      deleteMany: async () => ({ count: 1 }),
      createMany: async ({ data }) => {
        memberRows = data;
        return { count: data.length };
      },
    },
    paymentTransaction: {
      updateMany: async () => ({ count: 1 }),
      create: async ({ data }) => ({ ...data, status: "created" }),
    },
  };
  const prisma = {
    // Registration resolves every roster Discord handle from connected
    // accounts now, so the captain's link has to exist for the flow to run.
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    tournament: { findFirst: async () => retryTournament },
    teamRegistration: {
      findFirst: async () => existing,
      count: async () => 0,
    },
    savedTeam: { count: async () => 0 },
    $transaction: async (work) => work(tx),
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => ({ filename: "new-logo.png" }),
      removeUploadFile: async ({ filename }) => removedUploads.push(filename),
      removeUploadFiles: async (uploads) => {
        removedUploads.push(...uploads.map((upload) => upload.filename));
      },
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async () => undefined,
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
    [registrationMailModulePath]: {
      sendRegistrationReceivedEmail: async (confirmation) =>
        sentRegistrationConfirmations.push(confirmation),
    },
    [paymentServicePath]: {
      assertPayHereConfigured: () => undefined,
      createPayHereCheckout: ({ transaction }) => ({ orderId: transaction.providerOrderId }),
    },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => ({}),
      getBankTransferAmountForSlot: () => 2500,
    },
  });

  try {
    const result = await registrationService.createConfiguredRegistration({
      slug: retryTournament.slug,
      body,
      file: { originalname: "new-logo.png" },
      user,
    });

    assert.equal(registrationUpdate.teamName, "Updated Quest");
    assert.equal(registrationUpdate.captainName, "Updated Captain");
    assert.equal(registrationUpdate.teamLogoName, "new-logo.png");
    assert.equal(registrationUpdate.status, "pending");
    assert.equal(registrationUpdate.verificationStatus, "pending");
    assert.equal(memberRows.length, 1);
    assert.equal(memberRows[0].role, "CAPTAIN");
    assert.equal(memberRows[0].name, "Updated Captain");
    assert.deepEqual(removedUploads, ["old-logo.png"]);
    assert.match(result.paymentOrderId, /^TOUR-/);
    assert.equal(sentRegistrationConfirmations.length, 1);
    assert.equal(sentRegistrationConfirmations[0].registrationId, existing.id);
  } finally {
    restore();
  }
});

test("createConfiguredRegistration removes a newly persisted retry logo when the transaction fails", async () => {
  const removedUploads = [];
  const existing = {
    id: "registration-1",
    teamLogoName: "old-logo.png",
    paymentStatus: "pending",
    verificationStatus: "verified",
    members: [{ inviteStatus: "accepted" }],
    payments: [{ provider: "payhere", status: "failed", providerOrderId: "old-order" }],
  };
  const prisma = {
    savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    // Registration resolves every roster Discord handle from connected
    // accounts now, so the captain's link has to exist for the flow to run.
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    tournament: { findFirst: async () => tournament },
    teamRegistration: { findFirst: async () => existing },
    $transaction: async () => {
      throw new Error("database unavailable");
    },
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => ({ filename: "new-logo.png" }),
      removeUploadFile: async ({ filename }) => removedUploads.push(filename),
      removeUploadFiles: async (uploads) => {
        removedUploads.push(...uploads.map((upload) => upload.filename));
      },
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async () => undefined,
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
    [paymentServicePath]: {
      assertPayHereConfigured: () => undefined,
      createPayHereCheckout: () => ({}),
    },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => ({}),
      getBankTransferAmountForSlot: () => 2500,
    },
  });

  try {
    await assert.rejects(
      registrationService.createConfiguredRegistration({
        slug: tournament.slug,
        body,
        file: { originalname: "new-logo.png" },
        user,
      }),
      /database unavailable/
    );
    assert.deepEqual(removedUploads, ["new-logo.png"]);
  } finally {
    restore();
  }
});

test("public waitlist retry releases a stale admin hold before clearing the slot", async () => {
  const waitlistTournament = {
    ...tournament,
    entryType: "solo",
    maxTeams: 0,
    waitlistEnabled: true,
  };
  let currentRegistration = {
    id: "registration-waitlist-retry",
    entryType: "solo",
    status: "pending",
    paymentStatus: "unpaid",
    verificationStatus: "verified",
    waitlistPosition: null,
    assignedSlotNumber: 1,
    reservedUntil: null,
    members: [],
    payments: [{ provider: "payhere", status: "failed", providerOrderId: "old-order" }],
  };
  const deletedHolds = [];
  let registrationUpdate;
  const tx = {
    tournament: { findUnique: async () => waitlistTournament },
    teamRegistration: {
      count: async () => 0,
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => ({ ...currentRegistration, status: "waitlisted", waitlistPosition: 4 }),
      update: async ({ data }) => {
        registrationUpdate = data;
        currentRegistration = { ...currentRegistration, ...data };
        return currentRegistration;
      },
    },
    adminSlotReservation: {
      findUnique: async () => ({ id: "hold-1", assignedSlotNumber: 1 }),
      delete: async ({ where }) => deletedHolds.push(where),
    },
  };
  const prisma = {
    savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    // Registration resolves every roster Discord handle from connected
    // accounts now, so the captain's link has to exist for the flow to run.
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    tournament: { findFirst: async () => waitlistTournament },
    teamRegistration: { findFirst: async () => currentRegistration },
    $transaction: async (work) => work(tx),
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServicePath]: {
      ensureTeamRegistrationSaved: async () => undefined,
      sendTeamInvites: async () => undefined,
    },
    [registrationMailModulePath]: { sendRegistrationReceivedEmail: async () => undefined },
    [paymentServicePath]: { assertPayHereConfigured: () => undefined },
    [bankTransferServicePath]: {},
  });

  try {
    const result = await registrationService.createConfiguredRegistration({
      slug: waitlistTournament.slug,
      body,
      user,
    });
    assert.equal(result.waitlisted, true);
    assert.deepEqual(deletedHolds, [{ id: "hold-1" }]);
    assert.equal(registrationUpdate.assignedSlotNumber, null);
    assert.equal(registrationUpdate.reservedUntil, null);
    assert.equal(registrationUpdate.status, "waitlisted");
    assert.equal(registrationUpdate.waitlistPosition, 4, "a waitlisted retry keeps its queue position");
    const second = await registrationService.createConfiguredRegistration({
      slug: waitlistTournament.slug,
      body,
      user,
    });
    assert.equal(second.waitlisted, true);
    assert.equal(deletedHolds.length, 1, "duplicate submission must not allocate or release again");
  } finally {
    restore();
  }
});

test("active same-tournament registrations enforce coach/player identity separation", async () => {
  const conflictTournament = {
    ...tournament,
    registrationFeeAmount: 0,
    game: "Valorant",
    allowCoach: true,
    coachRequired: false,
  };
  const cases = [
    {
      label: "existing coach blocks captain by email only",
      existingMembers: [{ role: "COACH", email: " CAPTAIN@EXAMPLE.COM ", riotId: "OtherCoach#123" }],
      registrationBody: body,
    },
    {
      label: "existing coach blocks captain by Riot ID only",
      existingMembers: [{ role: "COACH", email: "other-coach@example.com", riotId: " captain#002 " }],
      registrationBody: body,
    },
    {
      label: "existing player blocks submitted coach by email only",
      existingMembers: [{ role: "PLAYER", email: "coach@example.com", riotId: "OtherPlayer#123" }],
      registrationBody: {
        ...body,
        coach: JSON.stringify({
          name: "Coach Example",
          email: " COACH@EXAMPLE.COM ",
          phone: "0772222222",
          discord: "coach-discord",
          gameId: "CoachName#456",
        }),
      },
    },
    {
      label: "existing player blocks submitted coach by Riot ID only",
      existingMembers: [{ role: "PLAYER", email: "other-player@example.com", riotId: "CoachName#123" }],
      registrationBody: {
        ...body,
        coach: JSON.stringify({
          name: "Coach Example",
          email: "coach@example.com",
          phone: "0772222222",
          discord: "coach-discord",
          gameId: " coachname#123 ",
        }),
      },
    },
  ];

  for (const { label, existingMembers, registrationBody } of cases) {
    const queryCalls = [];
    const activeRows = [
      {
        id: "active-same-paid",
        tournamentId: conflictTournament.id,
        status: "approved",
        paymentStatus: "paid",
        reservedUntil: null,
        members: existingMembers,
      },
      {
        id: "active-same-pending",
        tournamentId: conflictTournament.id,
        status: "pending",
        paymentStatus: "pending",
        reservedUntil: new Date(Date.now() + 60_000),
        members: existingMembers,
      },
      {
        id: "rejected-same-tournament",
        tournamentId: conflictTournament.id,
        status: "rejected",
        paymentStatus: "paid",
        reservedUntil: null,
        members: existingMembers,
      },
      {
        id: "waitlisted-same-tournament",
        tournamentId: conflictTournament.id,
        status: "waitlisted",
        paymentStatus: "paid",
        reservedUntil: null,
        members: existingMembers,
      },
      {
        id: "expired-same-tournament",
        tournamentId: conflictTournament.id,
        status: "pending",
        paymentStatus: "pending",
        reservedUntil: new Date(Date.now() - 60_000),
        members: existingMembers,
      },
      {
        id: "active-different-tournament",
        tournamentId: "different-tournament",
        status: "approved",
        paymentStatus: "paid",
        reservedUntil: null,
        members: existingMembers,
      },
    ];
    const tx = {
      tournament: { findUnique: async () => conflictTournament },
      teamRegistration: {
        count: async () => 0,
        findMany: async (args) => {
          queryCalls.push(args);
          const now = new Date();
          return activeRows.filter((row) =>
            row.tournamentId === args.where.tournamentId &&
            (!args.where.id?.not || row.id !== args.where.id.not) &&
            !args.where.status.notIn.includes(row.status) &&
            (row.paymentStatus === "paid" ||
              (row.paymentStatus === "pending" && row.reservedUntil > now))
          );
        },
        findFirst: async () => null,
        create: async ({ data }) => ({ ...data, id: data.id }),
      },
      registrationMember: { createMany: async () => ({ count: 1 }) },
    };
    const prisma = {
      savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    // Registration resolves every roster Discord handle from connected
    // accounts now, so the captain's link has to exist for the flow to run.
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
      tournament: { findFirst: async () => conflictTournament },
      teamRegistration: { findFirst: async () => null },
      $transaction: async (work) => work(tx),
    };
    const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
      [prismaModulePath]: { prisma },
      [uploadModulePath]: { persistTeamLogoUpload: async () => null },
      [teamServicePath]: { ensureTeamRegistrationSaved: async () => undefined },
      [registrationMailModulePath]: { sendRegistrationReceivedEmail: async () => undefined },
      [paymentServicePath]: {},
      [bankTransferServicePath]: {},
    });

    try {
      await assert.rejects(
        () => registrationService.createConfiguredRegistration({
          slug: conflictTournament.slug,
          body: registrationBody,
          user,
        }),
        (error) => error.statusCode === 409 &&
          error.message === "This person cannot be both a coach and a player in the same tournament.",
        label
      );
      assert.equal(queryCalls.length, 1);
      assert.equal(queryCalls[0].where.tournamentId, conflictTournament.id);
      assert.deepEqual(queryCalls[0].where.status, { notIn: ["rejected", "waitlisted"] });
      assert.equal(queryCalls[0].where.OR[0].paymentStatus, "paid");
      assert.equal(queryCalls[0].where.OR[1].paymentStatus, "pending");
      assert.ok(queryCalls[0].where.OR[1].reservedUntil.gt instanceof Date);
      assert.equal(queryCalls[0].where.id, undefined);
    } finally {
      restore();
    }
  }
});

test("rejected and different-tournament registrations do not block coach/player reuse", async () => {
  const reusableTournament = {
    ...tournament,
    registrationFeeAmount: 0,
    game: "Valorant",
    allowCoach: true,
    coachRequired: false,
  };
  for (const [label, ignoredRow] of [
    ["rejected registration", {
      id: "rejected-registration",
      tournamentId: reusableTournament.id,
      status: "rejected",
      paymentStatus: "paid",
    }],
    ["different tournament", {
      id: "different-tournament-registration",
      tournamentId: "different-tournament",
      status: "approved",
      paymentStatus: "paid",
    }],
  ]) {
    let created = false;
    const queryCalls = [];
    const tx = {
      tournament: { findUnique: async () => reusableTournament },
      teamRegistration: {
        count: async () => 0,
        findMany: async (args) => {
          queryCalls.push(args);
          const now = new Date();
          const row = { ...ignoredRow, members: [{ role: "PLAYER", email: "coach@example.com", riotId: "CoachName#123" }] };
          return row.tournamentId === args.where.tournamentId &&
            !args.where.status.notIn.includes(row.status) &&
            (row.paymentStatus === "paid" ||
              (row.paymentStatus === "pending" && row.reservedUntil > now))
            ? [row]
            : [];
        },
        findFirst: async () => null,
        create: async ({ data }) => {
          created = true;
          return { ...data, id: data.id };
        },
      },
      registrationMember: { createMany: async () => ({ count: 1 }) },
    };
    const prisma = {
      savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    // Registration resolves every roster Discord handle from connected
    // accounts now, so the captain's link has to exist for the flow to run.
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
      tournament: { findFirst: async () => reusableTournament },
      teamRegistration: { findFirst: async () => null },
      $transaction: async (work) => work(tx),
    };
    const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
      [prismaModulePath]: { prisma },
      [uploadModulePath]: { persistTeamLogoUpload: async () => null },
      [teamServicePath]: { ensureTeamRegistrationSaved: async () => undefined },
      [registrationMailModulePath]: { sendRegistrationReceivedEmail: async () => undefined },
      [paymentServicePath]: {},
      [bankTransferServicePath]: {},
    });

    try {
      await registrationService.createConfiguredRegistration({
        slug: reusableTournament.slug,
        body: {
          ...body,
          coach: JSON.stringify({
            name: "Coach Example",
            email: "coach@example.com",
            phone: "0772222222",
            discord: "coach-discord",
            gameId: "CoachName#123",
          }),
        },
        user,
      });
      assert.equal(created, true, `${label} should not block reuse`);
      assert.equal(queryCalls.length, 1);
      assert.equal(queryCalls[0].where.tournamentId, reusableTournament.id);
      assert.deepEqual(queryCalls[0].where.status, { notIn: ["rejected", "waitlisted"] });
      assert.equal(queryCalls[0].where.OR[0].paymentStatus, "paid");
      assert.equal(queryCalls[0].where.OR[1].paymentStatus, "pending");
      assert.ok(queryCalls[0].where.OR[1].reservedUntil.gt instanceof Date);
      assert.equal(ignoredRow.tournamentId === reusableTournament.id && ignoredRow.status === "rejected", label === "rejected registration");
    } finally {
      restore();
    }
  }
});

test("retry and payment continuation recheck same-tournament role conflicts", async () => {
  const conflictTournament = {
    ...tournament,
    registrationFeeAmount: 2500,
    game: "Valorant",
    allowCoach: true,
    coachRequired: false,
  };
  const coachBody = {
    ...body,
    coach: JSON.stringify({
      name: "Coach Example",
      email: "coach@example.com",
      phone: "0772222222",
      discord: "coach-discord",
      gameId: "CoachName#123",
    }),
  };
  const cases = [
    {
      label: "unpaid retry",
      existing: {
        id: "retry-conflict",
        status: "pending",
        paymentStatus: "pending",
        verificationStatus: "verified",
        reservedUntil: new Date(Date.now() - 60_000),
        members: [{ role: "CAPTAIN", inviteStatus: "accepted" }],
        payments: [],
      },
      body: coachBody,
      activeMembers: [{ role: "PLAYER", email: "coach@example.com", riotId: "CoachName#123" }],
    },
    {
      label: "payment continuation",
      existing: {
        id: "payment-conflict",
        status: "pending",
        paymentStatus: "unpaid",
        verificationStatus: "verified",
        reservedUntil: null,
        members: [{ role: "CAPTAIN", inviteStatus: "accepted" }],
        payments: [{ provider: "payhere", status: "failed", providerOrderId: "old-order" }],
      },
      body: { resumePayment: true },
      currentMembers: [
        { role: "CAPTAIN", email: user.email, riotId: "Captain#002", inviteStatus: "accepted" },
        { role: "PLAYER", email: "coach@example.com", riotId: "CoachName#123", inviteStatus: "accepted" },
      ],
      activeMembers: [{ role: "COACH", email: "other@example.com", riotId: "CoachName#123" }],
    },
  ];

  for (const testCase of cases) {
    const queryCalls = [];
    const tx = {
      tournament: { findUnique: async () => conflictTournament },
      teamRegistration: {
        findUnique: async () => ({
          ...testCase.existing,
          entryType: "team",
          members: testCase.currentMembers || testCase.existing.members,
        }),
        findMany: async (args) => {
          queryCalls.push(args);
          const activeRows = [
            {
              id: testCase.existing.id,
              tournamentId: conflictTournament.id,
              status: "approved",
              paymentStatus: "paid",
              reservedUntil: null,
              members: testCase.activeMembers,
            },
            {
              id: `${testCase.existing.id}-other`,
              tournamentId: conflictTournament.id,
              status: "approved",
              paymentStatus: "paid",
              reservedUntil: null,
              members: testCase.activeMembers,
            },
          ];
          return activeRows
            .filter((row) => row.id !== args.where.id.not)
            .map((row) => ({ members: row.members }));
        },
        count: async () => 0,
        findFirst: async () => null,
      },
    };
    const prisma = {
      savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    // Registration resolves every roster Discord handle from connected
    // accounts now, so the captain's link has to exist for the flow to run.
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
      tournament: { findFirst: async () => conflictTournament },
      teamRegistration: { findFirst: async () => testCase.existing },
      $transaction: async (work) => work(tx),
    };
    const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
      [prismaModulePath]: { prisma },
      [uploadModulePath]: { persistTeamLogoUpload: async () => null },
      [teamServicePath]: { ensureTeamRegistrationSaved: async () => undefined },
      [registrationMailModulePath]: { sendRegistrationReceivedEmail: async () => undefined },
      [paymentServicePath]: { assertPayHereConfigured: () => undefined },
      [bankTransferServicePath]: {},
    });

    try {
      await assert.rejects(
        () => registrationService.createConfiguredRegistration({
          slug: conflictTournament.slug,
          body: testCase.body,
          user,
        }),
        (error) => error.statusCode === 409 &&
          error.message === "This person cannot be both a coach and a player in the same tournament.",
        testCase.label
      );
      assert.equal(queryCalls.length, 1, `${testCase.label} should query active registrations once`);
      assert.equal(queryCalls[0].where.tournamentId, conflictTournament.id);
      assert.equal(queryCalls[0].where.id.not, testCase.existing.id);
      assert.deepEqual(queryCalls[0].where.status, { notIn: ["rejected", "waitlisted"] });
    } finally {
      restore();
    }
  }
});

test("active bank-transfer continuation checks role conflicts before returning instructions", async () => {
  const bankTournament = {
    ...tournament,
    paymentMethod: "bank_transfer",
    game: "Valorant",
    allowCoach: true,
    coachRequired: false,
  };
  const reservedUntil = new Date(Date.now() + 5 * 60_000);
  const existing = {
    id: "bank-transfer-conflict",
    status: "pending",
    paymentStatus: "pending",
    verificationStatus: "verified",
    reservedUntil,
    captainPhone: user.phone,
    country: "Sri Lanka",
    members: [{ role: "CAPTAIN", inviteStatus: "accepted" }],
    payments: [{ provider: "bank_transfer", status: "pending", providerOrderId: "bank-order" }],
  };
  let instructionCalls = 0;
  const currentRegistration = {
    ...existing,
    entryType: "team",
    members: [{
      role: "CAPTAIN",
      email: user.email,
      riotId: "Captain#002",
      inviteStatus: "accepted",
    }],
  };
  const tx = {
    tournament: { findUnique: async () => bankTournament },
    teamRegistration: {
      findUnique: async () => currentRegistration,
      findMany: async () => [{
        members: [{ role: "COACH", email: user.email, riotId: "OtherCoach#123" }],
      }],
    },
  };
  const prisma = {
    savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    // Registration resolves every roster Discord handle from connected
    // accounts now, so the captain's link has to exist for the flow to run.
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    tournament: { findFirst: async () => bankTournament },
    teamRegistration: { findFirst: async () => existing },
    $transaction: async (work) => work(tx),
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServicePath]: { ensureTeamRegistrationSaved: async () => undefined },
    [registrationMailModulePath]: { sendRegistrationReceivedEmail: async () => undefined },
    [paymentServicePath]: { assertBankTransferConfigured: () => undefined },
    [bankTransferServicePath]: {
      assertBankTransferConfigured: () => undefined,
      buildBankTransferInstructions: () => {
        instructionCalls += 1;
        return {};
      },
    },
  });

  try {
    await assert.rejects(
      () => registrationService.createConfiguredRegistration({
        slug: bankTournament.slug,
        body,
        user,
      }),
      (error) => error.statusCode === 409 &&
        error.message === "This person cannot be both a coach and a player in the same tournament."
    );
    assert.equal(instructionCalls, 0);
  } finally {
    restore();
  }
});

test("active explicit payment resume checks role conflicts before reusing the payment", async () => {
  const payHereTournament = {
    ...tournament,
    game: "Valorant",
    allowCoach: true,
    coachRequired: false,
  };
  const existing = {
    id: "payhere-resume-conflict",
    status: "pending",
    paymentStatus: "pending",
    verificationStatus: "verified",
    reservedUntil: new Date(Date.now() + 5 * 60_000),
    captainPhone: user.phone,
    country: "Sri Lanka",
    members: [{ role: "CAPTAIN", inviteStatus: "accepted" }],
    payments: [{ provider: "payhere", status: "pending", providerOrderId: "payhere-order" }],
  };
  let checkoutCalls = 0;
  const tx = {
    tournament: { findUnique: async () => payHereTournament },
    teamRegistration: {
      findUnique: async () => ({
        ...existing,
        entryType: "team",
        members: [{
          role: "CAPTAIN",
          email: user.email,
          riotId: "Captain#002",
          inviteStatus: "accepted",
        }],
      }),
      findMany: async () => [{
        members: [{ role: "COACH", email: user.email, riotId: "OtherCoach#123" }],
      }],
    },
  };
  const prisma = {
    savedTeam: { findUnique: async () => ({ logoName: "saved-team.webp" }) },
    // Registration resolves every roster Discord handle from connected
    // accounts now, so the captain's link has to exist for the flow to run.
    oAuthAccount: {
      findFirst: async () => ({
        providerUserId: "900000000000000001",
        user: { discordTag: "captain-discord" },
      }),
      findMany: async () => [],
    },
    user: { findMany: async () => [] },
    tournament: { findFirst: async () => payHereTournament },
    teamRegistration: { findFirst: async () => existing },
    $transaction: async (work) => work(tx),
  };
  const { module: registrationService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServicePath]: { ensureTeamRegistrationSaved: async () => undefined },
    [registrationMailModulePath]: { sendRegistrationReceivedEmail: async () => undefined },
    [paymentServicePath]: {
      assertPayHereConfigured: () => undefined,
      createPayHereCheckout: () => {
        checkoutCalls += 1;
        return {};
      },
    },
    [bankTransferServicePath]: {},
  });

  try {
    await assert.rejects(
      () => registrationService.createConfiguredRegistration({
        slug: payHereTournament.slug,
        body: { resumePayment: true },
        user,
      }),
      (error) => error.statusCode === 409 &&
        error.message === "This person cannot be both a coach and a player in the same tournament."
    );
    assert.equal(checkoutCalls, 0);
  } finally {
    restore();
  }
});
