const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/tournaments/tournament.service.js");
const prismaModulePath = path.join(__dirname, "../src/lib/prisma.js");
const uploadModulePath = path.join(__dirname, "../src/middleware/upload.js");
const teamServiceModulePath = path.join(__dirname, "../src/modules/teams/team.service.js");
const paymentServiceModulePath = path.join(__dirname, "../src/modules/payments/payment.service.js");
const bracketServiceModulePath = path.join(__dirname, "../src/modules/tournaments/bracket.service.js");
const loggerModulePath = path.join(__dirname, "../src/lib/logger.js");
const auditModulePath = path.join(__dirname, "../src/lib/audit.js");

const buildAdminTournamentBody = (overrides = {}) => ({
  title: "Quest Date Cup",
  slug: "quest-date-cup",
  game: "valorant",
  shortDescription: "Short description",
  fullDescription: "Full description",
  format: "Single elimination",
  teamSize: "5",
  maxTeams: "16",
  prizePool: "LKR 50,000",
  status: "draft",
  startDate: "2026-08-01T10:00:00.000Z",
  endDate: "2026-08-02T10:00:00.000Z",
  registrationDeadline: "2026-07-30T10:00:00.000Z",
  ...overrides,
});

test("Challonge URLs are restricted and normalized for safe module embeds", () => {
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
  });

  try {
    assert.equal(
      tournamentService.normalizeChallongeUrl("https://challonge.com/quest-cup?ref=site#matches"),
      "https://challonge.com/quest-cup"
    );
    assert.equal(
      tournamentService.buildChallongeEmbedUrl("https://quest.challonge.com/finals/module"),
      "https://quest.challonge.com/finals/module"
    );
    assert.equal(tournamentService.normalizeChallongeUrl("http://challonge.com/quest-cup"), null);
    assert.equal(tournamentService.normalizeChallongeUrl("https://challonge.com.evil.test/quest-cup"), null);
    assert.equal(tournamentService.normalizeChallongeUrl("https://challonge.com"), null);
  } finally {
    restore();
  }
});

test("admin tournament listing rejects unsupported status filters", async () => {
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
  });

  try {
    await assert.rejects(
      tournamentService.listAdminTournaments({ status: "registration_closed" }),
      (error) => error.statusCode === 400 && error.message === "Tournament status is invalid."
    );
  } finally {
    restore();
  }
});

test("registration status includes coach invitations in verification and payment gating", async () => {
  let repairedRegistrationId = null;
  const prisma = {
    tournament: {
      findUnique: async () => ({ id: "tournament-1", registrationFeeAmount: 2500 }),
    },
    teamRegistration: {
      findFirst: async () => ({
        id: "registration-1",
        status: "pending",
        paymentStatus: "pending",
        verificationStatus: "pending",
        members: [
          { role: "CAPTAIN", inviteStatus: "accepted" },
          { role: "COACH", inviteStatus: "declined" },
          { role: "COACH", inviteStatus: "pending" },
        ],
        reservedUntil: new Date("2099-08-01T10:00:00.000Z"),
        assignedSlotNumber: 7,
        payments: [{
          providerOrderId: "QST-0123456789",
          provider: "bank_transfer",
          status: "pending",
        }],
      }),
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {
      ensureTeamRegistrationSaved: async (registrationId) => {
        repairedRegistrationId = registrationId;
      },
    },
  });

  try {
    const result = await tournamentService.getTournamentRegistrationStatus({
      slug: "quest-cup",
      user: { id: "user-1", email: "captain@example.com" },
    });
    assert.equal(result.isRegistered, true);
    assert.equal(result.registration.verificationStatus, "flagged");
    assert.equal(result.registration.pendingInviteCount, 1);
    assert.equal(result.registration.assignedSlotNumber, 7);
    assert.equal(repairedRegistrationId, "registration-1");
    assert.deepEqual(result.registration.payment, {
      orderId: "QST-0123456789",
      provider: "bank_transfer",
      status: "pending",
    });
  } finally {
    restore();
  }
});

test("admin tournaments can store optional descriptions and TBA/TBD dates", async () => {
  let savedData;
  const prismaMock = {
    prisma: {
      tournament: {
        findFirst: async () => null,
        create: async ({ data }) => {
          savedData = data;
          return {
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { teamRegistrations: 0 },
          };
        },
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
      removeUploadFiles: async () => undefined,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    const tournament = await tournamentService.createAdminTournament({
      body: buildAdminTournamentBody({
        shortDescription: "",
        fullDescription: "",
        startDateStatus: "tba",
        endDateStatus: "tbd",
        registrationDeadlineStatus: "tba",
      }),
      files: {},
    });

    assert.equal(savedData.startDate, null);
    assert.equal(savedData.endDate, null);
    assert.equal(savedData.registrationDeadline, null);
    assert.equal(savedData.shortDescription, "");
    assert.equal(savedData.fullDescription, "");
    assert.equal(tournament.startDateStatus, "tba");
    assert.equal(tournament.endDateStatus, "tbd");
    assert.equal(tournament.registrationDeadlineStatus, "tba");
  } finally {
    restore();
  }
});

test("coach settings normalize missing and boolean flags", () => {
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
    [paymentServiceModulePath]: { isPayHereConfigured: () => false },
    [bracketServiceModulePath]: { buildShortCode: (name) => name, mapPublicBracket: () => null },
    [loggerModulePath]: {},
  });

  try {
    const defaults = tournamentService.normalizeTournamentInput({
      body: buildAdminTournamentBody(),
    });
    assert.equal(defaults.allowCoach, false);
    assert.equal(defaults.coachRequired, false);
    assert.equal(defaults.showBracketPublicly, true);

    const existingHidden = tournamentService.normalizeTournamentInput({
      body: buildAdminTournamentBody(),
      existingTournament: { ...buildAdminTournamentBody(), showBracketPublicly: false },
    });
    assert.equal(existingHidden.showBracketPublicly, false);

    const enabled = tournamentService.normalizeTournamentInput({
      body: buildAdminTournamentBody({ allowCoach: "true", coachRequired: "on" }),
    });
    assert.equal(enabled.allowCoach, true);
    assert.equal(enabled.coachRequired, true);

    const disabled = tournamentService.normalizeTournamentInput({
      body: buildAdminTournamentBody({
        allowCoach: "false",
        coachRequired: "false",
        showBracketPublicly: "false",
      }),
    });
    assert.equal(disabled.allowCoach, false);
    assert.equal(disabled.coachRequired, false);
    assert.equal(disabled.showBracketPublicly, false);

    assert.throws(
      () => tournamentService.normalizeTournamentInput({
        body: buildAdminTournamentBody({ allowCoach: "false", coachRequired: "true" }),
      }),
      /Coach requirement requires coaches to be allowed/
    );
  } finally {
    restore();
  }
});

test("public tournament output maps coach settings", () => {
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
    [paymentServiceModulePath]: { isPayHereConfigured: () => false },
    [bracketServiceModulePath]: { buildShortCode: (name) => name, mapPublicBracket: () => null },
    [loggerModulePath]: {},
  });

  try {
    const source = {
      id: "tournament-1",
      slug: "coach-cup",
      title: "Coach Cup",
      game: "valorant",
      shortDescription: "Short",
      fullDescription: "Full",
      format: "Single elimination",
      registrationMode: "open_entry",
      entryType: "team",
      teamSize: 5,
      minRosterSize: 5,
      maxRosterSize: 5,
      maxSubstitutes: 0,
      allowCoach: true,
      coachRequired: true,
      showBracketPublicly: false,
      maxTeams: 16,
      status: "registration_open",
      createdAt: new Date(),
      updatedAt: new Date(),
      sponsors: [],
    };
    const tournament = tournamentService.mapTournament(source);

    assert.equal(tournament.allowCoach, true);
    assert.equal(tournament.coachRequired, true);
    assert.equal(tournament.showBracketPublicly, false);
    assert.equal(tournamentService.mapTournament({ ...source, showBracketPublicly: undefined }).showBracketPublicly, true);
  } finally {
    restore();
  }
});

test("admin tournament registration counts exclude coach rows", () => {
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
    [paymentServiceModulePath]: { isPayHereConfigured: () => false },
    [bracketServiceModulePath]: { buildShortCode: (name) => name, mapPublicBracket: () => null },
    [loggerModulePath]: {},
  });

  try {
    const result = tournamentService.mapTournamentWithRegistrations(
      { id: "tournament-1", status: "registration_open", maxTeams: 16 },
      [{
        id: "registration-1",
        teamName: "Quest Five",
        status: "approved",
        paymentStatus: "paid",
        verificationStatus: "verified",
        createdAt: new Date(),
        teamLogoName: "stale-logo.png",
        savedTeam: { logoName: "replacement-logo.webp" },
        captainName: "Captain",
        captainEmail: "captain@example.com",
        members: [
          { role: "CAPTAIN" },
          { role: "PLAYER" },
          { role: "PLAYER" },
          { role: "COACH" },
        ],
        _count: { members: 99 },
      }, {
        id: "registration-legacy",
        teamName: "Legacy Team",
        status: "approved",
        paymentStatus: "paid",
        verificationStatus: "verified",
        createdAt: new Date(),
        teamLogoName: "historical-logo.png",
        savedTeam: null,
        captainName: "Legacy Captain",
        captainEmail: "legacy@example.com",
        _count: { members: 7 },
      }]
    );

    assert.equal(result.registrations[0].memberCount, 3);
    assert.equal(result.registrations[1].memberCount, 7);
    assert.equal(result.registrations[0].logoUrl, "/api/uploads/team-logos/replacement-logo.webp");
    assert.equal(result.registrations[1].logoUrl, "/api/uploads/team-logos/historical-logo.png");
  } finally {
    restore();
  }
});

test("coach settings persist through admin create and update responses", async () => {
  let createdData;
  let updatedData;
  const existingTournament = {
    id: "tournament-1",
    ...buildAdminTournamentBody(),
    allowCoach: false,
    coachRequired: false,
  };
  const prismaMock = {
    prisma: {
      tournament: {
        findFirst: async () => null,
        findUnique: async () => existingTournament,
        create: async ({ data }) => {
          createdData = data;
          return {
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { teamRegistrations: 0 },
            sponsors: [],
          };
        },
        update: async ({ data }) => {
          updatedData = data;
          return {
            ...existingTournament,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { teamRegistrations: 0 },
            sponsors: [],
          };
        },
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
      removeUploadFiles: async () => undefined,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
    [paymentServiceModulePath]: { isPayHereConfigured: () => false },
    [bracketServiceModulePath]: { buildShortCode: (name) => name, mapPublicBracket: () => null },
    [loggerModulePath]: {},
  });

  try {
    const created = await tournamentService.createAdminTournament({
      body: buildAdminTournamentBody({ allowCoach: "true", coachRequired: "true" }),
      files: {},
    });
    assert.equal(createdData.allowCoach, true);
    assert.equal(createdData.coachRequired, true);
    assert.equal(created.allowCoach, true);
    assert.equal(created.coachRequired, true);

    const updated = await tournamentService.updateAdminTournament({
      tournamentId: existingTournament.id,
      body: buildAdminTournamentBody({ allowCoach: "false", coachRequired: "false" }),
      files: {},
    });
    assert.equal(updatedData.allowCoach, false);
    assert.equal(updatedData.coachRequired, false);
    assert.equal(updated.allowCoach, false);
    assert.equal(updated.coachRequired, false);
  } finally {
    restore();
  }
});

test("admin tournament discord requirement normalizes, persists, preserves, and maps", async () => {
  let createdData;
  let updatedData;
  const existingTournament = {
    id: "tournament-discord",
    ...buildAdminTournamentBody(),
    discordRequired: true,
  };
  const prismaMock = {
    prisma: {
      tournament: {
        findFirst: async () => null,
        findUnique: async () => existingTournament,
        create: async ({ data }) => {
          createdData = data;
          return {
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { teamRegistrations: 0 },
            sponsors: [],
          };
        },
        update: async ({ data }) => {
          updatedData = data;
          return {
            ...existingTournament,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { teamRegistrations: 0 },
            sponsors: [],
          };
        },
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
      removeUploadFiles: async () => undefined,
    },
    [teamServiceModulePath]: {},
    [paymentServiceModulePath]: { isPayHereConfigured: () => false },
    [bracketServiceModulePath]: { buildShortCode: (name) => name, mapPublicBracket: () => null },
    [loggerModulePath]: {},
  });

  try {
    assert.equal(
      tournamentService.normalizeTournamentInput({ body: buildAdminTournamentBody() }).discordRequired,
      false
    );
    for (const value of [true, "true", "on", 1, "1"]) {
      assert.equal(
        tournamentService.normalizeTournamentInput({
          body: buildAdminTournamentBody({ discordRequired: value }),
        }).discordRequired,
        true
      );
    }
    assert.equal(
      tournamentService.normalizeTournamentInput({
        body: buildAdminTournamentBody(),
        existingTournament,
      }).discordRequired,
      true
    );

    const created = await tournamentService.createAdminTournament({
      body: buildAdminTournamentBody({ discordRequired: "on" }),
      files: {},
    });
    assert.equal(createdData.discordRequired, true);
    assert.equal(created.discordRequired, true);

    const updated = await tournamentService.updateAdminTournament({
      tournamentId: existingTournament.id,
      body: buildAdminTournamentBody(),
      files: {},
    });
    assert.equal(updatedData.discordRequired, true);
    assert.equal(updated.discordRequired, true);
  } finally {
    restore();
  }
});

test("child tournament create and attachment audit series relationship evidence transactionally", async () => {
  const audits = [];
  const existing = { id: "tournament-1", ...buildAdminTournamentBody(), seriesId: null, seriesOrder: null };
  const prisma = {
    tournament: {
      findFirst: async () => null,
      findUnique: async () => existing,
      create: async ({ data }) => ({ ...existing, ...data, _count: { teamRegistrations: 0 }, sponsors: [] }),
      update: async ({ data }) => ({ ...existing, ...data, _count: { teamRegistrations: 0 }, sponsors: [] }),
    },
  };
  prisma.$transaction = async (work) => work({
    tournament: prisma.tournament,
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  });
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: { persistTournamentBannerUpload: async () => null, persistTournamentScheduleUpload: async () => null },
    [teamServiceModulePath]: { syncSavedTeamFromRegistration: async () => [], sendTeamInvites: async () => undefined },
    [paymentServiceModulePath]: { isPayHereConfigured: () => false },
    [bracketServiceModulePath]: { buildShortCode: (name) => name, mapPublicBracket: () => null },
    [auditModulePath]: {
      recordAuditInTransaction: async (tx, entry) => tx.auditLog.create({ data: entry }),
    },
  });

  try {
    await tournamentService.createAdminTournament({
      body: buildAdminTournamentBody({ seriesId: "event-1", seriesOrder: "2" }),
      files: {},
      auditContext: { actorUserId: "admin-1", requestId: "req-child", ipAddress: "127.0.0.1" },
    });
    await tournamentService.attachTournamentToSeries({
      tournamentId: "tournament-1",
      seriesId: "event-2",
      seriesOrder: 4,
      auditContext: { actorUserId: "admin-1", requestId: "req-attach", ipAddress: "127.0.0.1" },
    });
    assert.deepEqual(audits.map((audit) => [audit.action, audit.afterData.seriesId, audit.afterData.seriesOrder]), [
      ["tournament.created", "event-1", 2],
      ["tournament.series_attached", "event-2", 4],
    ]);
    assert.equal(audits[1].beforeData.seriesId, null);
    assert.equal(audits[1].beforeData.seriesOrder, null);
  } finally {
    restore();
  }
});

test("child tournament attachment fails closed when its transaction audit fails", async () => {
  let updateCalls = 0;
  const existing = { id: "tournament-audit", seriesId: null, seriesOrder: null };
  const prisma = {
    tournament: {
      findUnique: async () => existing,
      update: async ({ data }) => { updateCalls += 1; return { ...existing, ...data, _count: { teamRegistrations: 0 }, sponsors: [] }; },
    },
    $transaction: async (work) => work(prisma),
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
    [auditModulePath]: { recordAuditInTransaction: async () => { throw new Error("child tournament audit unavailable"); } },
  });
  try {
    await assert.rejects(
      tournamentService.attachTournamentToSeries({
        tournamentId: existing.id,
        seriesId: "event-audit",
        seriesOrder: 3,
        auditContext: { actorUserId: "admin-1", requestId: "req-child-audit", ipAddress: "127.0.0.1" },
      }),
      /child tournament audit unavailable/,
    );
    assert.equal(updateCalls, 1, "the mutation reaches the transaction before the audit veto");
  } finally { restore(); }
});

test("admin tournament update reads its forensic before state inside the mutation transaction", async () => {
  let transactionActive = false;
  let readInsideTransaction = false;
  let updateInsideTransaction = false;
  const existing = { id: "tournament-update-boundary", ...buildAdminTournamentBody() };
  const prisma = {
    tournament: {
      findUnique: async () => {
        readInsideTransaction = transactionActive;
        return existing;
      },
      findFirst: async () => null,
      update: async ({ data }) => {
        updateInsideTransaction = transactionActive;
        return { ...existing, ...data, _count: { teamRegistrations: 0 }, teamRegistrations: [], adminSlotReservations: [], sponsors: [] };
      },
    },
    $transaction: async (work) => {
      transactionActive = true;
      try { return await work(prisma); } finally { transactionActive = false; }
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: { persistTournamentBannerUpload: async () => null, persistTournamentScheduleUpload: async () => null, removeUploadFiles: async () => undefined },
    [teamServiceModulePath]: {},
    [paymentServiceModulePath]: { isPayHereConfigured: () => false },
    [bracketServiceModulePath]: { buildShortCode: (name) => name, mapPublicBracket: () => null },
    [auditModulePath]: { recordAuditInTransaction: async () => undefined },
  });
  try {
    await tournamentService.updateAdminTournament({
      tournamentId: existing.id,
      body: buildAdminTournamentBody({ title: "Updated Quest Cup" }),
      files: {},
      auditContext: { actorUserId: "admin-1", requestId: "req-update-boundary" },
    });
    assert.equal(readInsideTransaction, true);
    assert.equal(updateInsideTransaction, true);
  } finally { restore(); }
});

test("admin tournament creation carries request context and fails closed on audit failure", async () => {
  const auditEntries = [];
  const prisma = {
    tournament: {
      findFirst: async () => null,
      create: async ({ data }) => ({ ...data, _count: { teamRegistrations: 0 }, sponsors: [] }),
    },
    $transaction: async (work) => work(prisma),
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: { persistTournamentBannerUpload: async () => null, persistTournamentScheduleUpload: async () => null, removeUploadFiles: async () => undefined },
    [teamServiceModulePath]: { syncSavedTeamFromRegistration: async () => [], sendTeamInvites: async () => undefined },
    [paymentServiceModulePath]: { isPayHereConfigured: () => false },
    [bracketServiceModulePath]: { buildShortCode: (name) => name, mapPublicBracket: () => null },
    [auditModulePath]: {
      recordAuditInTransaction: async (_tx, entry) => {
        auditEntries.push(entry);
        throw new Error("tournament audit unavailable");
      },
    },
  });
  try {
    await assert.rejects(
      tournamentService.createAdminTournament({
        body: buildAdminTournamentBody(),
        files: {},
        auditContext: { actorUserId: "admin-1", requestId: "req-tournament-audit", ipAddress: "127.0.0.1" },
      }),
      /tournament audit unavailable/,
    );
    assert.equal(auditEntries[0].requestId, "req-tournament-audit");
    assert.equal(auditEntries[0].action, "tournament.created");
  } finally { restore(); }
});

test("admin tournaments can save an editable schedule without a spreadsheet", async () => {
  let savedData;
  const prismaMock = {
    prisma: {
      tournament: {
        findFirst: async () => null,
        create: async ({ data }) => {
          savedData = data;
          return {
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { teamRegistrations: 0 },
          };
        },
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    await tournamentService.createAdminTournament({
      body: buildAdminTournamentBody({
        scheduleData: JSON.stringify({
          sheetName: "Quest Cup Schedule",
          headers: ["Date", "Match", "Team A", "Team B", "Time", "Format"],
          rows: [
            {
              Date: "2026-08-01",
              Match: "1",
              "Team A": "Alpha",
              "Team B": "Bravo",
              Time: "09:00 AM",
              Format: "Bo1",
            },
          ],
        }),
      }),
      files: {},
    });

    assert.equal(savedData.scheduleData.sheetName, "Quest Cup Schedule");
    assert.equal(savedData.scheduleData.rows[0]["Team A"], "Alpha");
    assert.equal(savedData.scheduleData.headers.length, 6);
  } finally {
    restore();
  }
});

test("updating a bank-transfer tournament returns its bank details to the editor", async () => {
  const existingTournament = {
    id: "tournament-1",
    ...buildAdminTournamentBody(),
    registrationFeeAmount: 2500,
    registrationFeeCurrency: "LKR",
    registrationFeeTiers: [],
    paymentMethod: "bank_transfer",
    bankName: "Quest Bank",
    bankBranch: "Colombo",
    bankAccountName: "Quest Esports",
    bankAccountNumber: "1234567890",
  };
  const prismaMock = {
    prisma: {
      tournament: {
        findUnique: async () => existingTournament,
        findFirst: async () => null,
        update: async ({ data }) => ({
          ...existingTournament,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { teamRegistrations: 0 },
          teamRegistrations: [],
          adminSlotReservations: [],
        }),
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
      removeUploadFiles: async () => undefined,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    const tournament = await tournamentService.updateAdminTournament({
      tournamentId: existingTournament.id,
      body: buildAdminTournamentBody({
        registrationFeeAmount: "2500",
        registrationFeeCurrency: "LKR",
        paymentMethod: "bank_transfer",
        bankName: "Quest Bank",
        bankBranch: "Colombo",
        bankAccountName: "Quest Esports",
        bankAccountNumber: "1234567890",
      }),
      files: {},
    });

    assert.equal(tournament.bankName, "Quest Bank");
    assert.equal(tournament.bankBranch, "Colombo");
    assert.equal(tournament.bankAccountName, "Quest Esports");
    assert.equal(tournament.bankAccountNumber, "1234567890");
  } finally {
    restore();
  }
});

test("editable schedule columns must be unique", async () => {
  const prismaMock = {
    prisma: {
      tournament: {
        findFirst: async () => null,
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
      removeUploadFiles: async () => undefined,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    await assert.rejects(
      tournamentService.createAdminTournament({
        body: buildAdminTournamentBody({
          scheduleData: JSON.stringify({
            sheetName: "Invalid",
            headers: ["Team", "team"],
            rows: [],
          }),
        }),
        files: {},
      }),
      /column names must be unique/
    );
  } finally {
    restore();
  }
});

test("scheduled tournament dates still require valid values", async () => {
  const prismaMock = {
    prisma: {
      tournament: { findFirst: async () => null },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    await assert.rejects(
      tournamentService.createAdminTournament({
        body: buildAdminTournamentBody({ startDate: "" }),
        files: {},
      }),
      /Start date is required/
    );
  } finally {
    restore();
  }
});

test("getPublicTournamentBySlug exposes approved public team card data", async () => {
  let capacityCountCalls = 0;
  const prismaMock = {
    prisma: {
      teamRegistration: {
        count: async () => {
          capacityCountCalls += 1;
          return 1;
        },
      },
      adminSlotReservation: {
        count: async () => {
          capacityCountCalls += 1;
          return 0;
        },
      },
      tournament: {
        findFirst: async () => ({
          id: "tournament-1",
          slug: "quest-cup",
          title: "Quest Cup",
          game: "valorant",
          displayPriority: 100,
          bannerImageName: "banner.jpg",
          shortDescription: "Short",
          fullDescription: "Full",
          rules: "Rules",
          startDate: new Date("2026-06-01T00:00:00.000Z"),
          endDate: new Date("2026-06-02T00:00:00.000Z"),
          registrationDeadline: new Date("2026-05-30T00:00:00.000Z"),
          format: "Single elimination",
          teamSize: 5,
          maxTeams: 16,
          prizePool: "LKR 100,000",
          status: "completed",
          isPublished: true,
          bracketLink: null,
          contactLink: null,
          isFeatured: false,
          scheduleData: null,
          completedPosterImageName: null,
          firstPlaceImageName: null,
          secondPlaceImageName: null,
          thirdPlaceImageName: null,
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-05-01T00:00:00.000Z"),
          _count: {
            // One approved participant plus one pending active payment reservation.
            teamRegistrations: 2,
            adminSlotReservations: 0,
          },
          adminSlotReservations: [],
          challongeIntegration: {
            enabled: true,
            snapshotData: {
              tournament: { state: "complete", completedAt: "2026-06-02T12:00:00.000Z" },
              participants: [
                { id: "10", name: "Quest Five", seed: 2, finalRank: 1 },
                { id: "20", name: "Final Boss", seed: 1, finalRank: 2 },
                { id: "30", name: "Third Wave", seed: 3, finalRank: 3 },
              ],
              matches: [],
            },
            participantLinks: [
              {
                externalParticipantId: "10",
                displayName: "Quest Five",
                isConfirmed: true,
                registration: {
                  teamName: "Quest Five",
                  teamLogoName: "private-logo.png",
                  savedTeam: { logoName: "current-logo.webp" },
                },
              },
            ],
          },
          teamRegistrations: [
            {
              id: "registration-1",
              teamName: "Quest Five",
              captainName: "Captain Quest",
              teamLogoName: "private-logo.png",
              savedTeam: { logoName: "current-logo.webp" },
              status: "approved",
              paymentStatus: "paid",
              members: [
                { id: "member-1", role: "CAPTAIN" },
                { id: "member-2", role: "PLAYER" },
                { id: "member-3", role: "PLAYER" },
                { id: "member-4", role: "PLAYER" },
                { id: "member-5", role: "PLAYER" },
                { id: "coach-1", role: "COACH" },
              ],
            },
          ],
        }),
      },
    },
  };

  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    const tournament = await tournamentService.getPublicTournamentBySlug("quest-cup");

    assert.deepEqual(tournament.registeredTeams, [
      {
        id: "registration-1",
        teamName: "Quest Five",
        logoUrl: "/api/uploads/team-logos/current-logo.webp",
        shortCode: "QF",
        memberCount: 5,
        status: "approved",
        captainName: "Captain Quest",
      },
    ]);
    assert.equal(tournament.bracketSummary, null);
    assert.equal(tournament.bracketData, null);
    assert.deepEqual(tournament.resultSummary, {
      status: "complete",
      completedAt: "2026-06-02T12:00:00.000Z",
      standings: [
        { rank: 1, name: "Quest Five", seed: 2, logoUrl: "/api/uploads/team-logos/current-logo.webp" },
        { rank: 2, name: "Final Boss", seed: 1, logoUrl: null },
        { rank: 3, name: "Third Wave", seed: 3, logoUrl: null },
      ],
    });
    assert.equal(tournament.registrationCount, 1);
    assert.equal(tournament.capacityUsed, 2);
    assert.equal("participantPagination" in tournament, false);
    assert.equal(capacityCountCalls, 1);
  } finally {
    restore();
  }
});

test("public tournament participant pagination keeps full registration totals", async () => {
  let findOptions;
  let countOptions;
  let bracketFindOptions;
  const registrations = [
    { id: "registration-1", teamName: "Alpha", captainName: "A", status: "approved", paymentStatus: "paid", members: [] },
    { id: "registration-2", teamName: "Bravo", captainName: "B", status: "approved", paymentStatus: "paid", members: [] },
  ];
  const prisma = {
    teamRegistration: {
      count: async (options) => { countOptions = options; return 25; },
      findMany: async (options) => {
        bracketFindOptions = options;
        return [{
          id: "registration-outside-page",
          teamName: "Outside Page",
          teamLogoName: "stale.png",
          savedTeam: { logoName: "current.png" },
        }];
      },
    },
    tournament: {
      findFirst: async (options) => {
        findOptions = options;
        return {
          id: "tournament-1",
          slug: "quest-cup",
          title: "Quest Cup",
          game: "valorant",
          status: "registration_open",
          isPublished: true,
          registrationMode: "open_entry",
          teamSize: 5,
          maxTeams: 32,
          prizePool: "LKR 100,000",
          format: "Single elimination",
          registrationFeeAmount: 0,
          bracket: {
            status: "published",
            bracketData: {
              participant: [{
                registrationId: "registration-outside-page",
                name: "Stale Name",
                logoUrl: "/stale-logo.png",
              }],
              match: [],
            },
          },
          _count: { teamRegistrations: 4, adminSlotReservations: 0 },
          adminSlotReservations: [],
          teamRegistrations: registrations,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
  });

  try {
    const tournament = await tournamentService.getPublicTournamentBySlug("quest-cup", {
      participantPage: "2",
      participantPageSize: "75",
    });

    assert.equal(findOptions.include.teamRegistrations.skip, 50);
    assert.equal(findOptions.include.teamRegistrations.take, 50);
    assert.deepEqual(findOptions.include.teamRegistrations.orderBy, [
      { teamName: "asc" },
      { id: "asc" },
    ]);
    assert.equal(countOptions.where.tournamentId, "tournament-1");
    assert.equal(tournament.registrationCount, 25);
    assert.equal(tournament.capacityUsed, 4);
    assert.equal(bracketFindOptions.where.tournamentId, "tournament-1");
    assert.deepEqual(tournament.bracketData.participant[0], {
      registrationId: "registration-outside-page",
      name: "Outside Page",
      shortCode: "OP",
      logoUrl: "/api/uploads/team-logos/current.png",
    });
    assert.deepEqual(tournament.participantPagination, {
      page: 2,
      pageSize: 50,
      total: 25,
      totalPages: 1,
    });
    assert.equal(tournament.registeredParticipants.length, 2);
  } finally {
    restore();
  }
});

test("public tournament detail bounds the default participant projection", async () => {
  let findOptions;
  const registrations = Array.from({ length: 50 }, (_, index) => ({
    id: `registration-${index + 1}`,
    teamName: `Team ${index + 1}`,
    captainName: `Captain ${index + 1}`,
    entryType: "team",
    status: "approved",
    members: [],
  }));
  const prisma = {
    teamRegistration: {
      count: async () => 75,
    },
    tournament: {
      findFirst: async (options) => {
        findOptions = options;
        return {
          id: "tournament-1",
          slug: "quest-cup",
          title: "Quest Cup",
          game: "valorant",
          status: "registration_open",
          isPublished: true,
          teamRegistrations: registrations,
          _count: { teamRegistrations: 0, adminSlotReservations: 0 },
          adminSlotReservations: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
  });

  try {
    const tournament = await tournamentService.getPublicTournamentBySlug("quest-cup");

    assert.equal(findOptions.include.teamRegistrations.skip, 0);
    assert.equal(findOptions.include.teamRegistrations.take, 50);
    assert.equal(tournament.registrationCount, 75);
    assert.equal(tournament.registeredParticipants.length, 50);
    assert.equal("participantPagination" in tournament, false);
  } finally {
    restore();
  }
});

test("page-only participant pagination preserves the shared default page size", async () => {
  let findOptions;
  let countCalls = 0;
  const prisma = {
    teamRegistration: {
      count: async () => {
        countCalls += 1;
        return 25;
      },
    },
    tournament: {
      findFirst: async (options) => {
        findOptions = options;
        return {
          id: "tournament-1",
          slug: "quest-cup",
          title: "Quest Cup",
          game: "valorant",
          status: "registration_open",
          isPublished: true,
          teamRegistrations: [],
          _count: { teamRegistrations: 0, adminSlotReservations: 0 },
          adminSlotReservations: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
  });

  try {
    const tournament = await tournamentService.getPublicTournamentBySlug("quest-cup", {
      participantPage: "2",
    });

    assert.equal(findOptions.include.teamRegistrations.skip, 10);
    assert.equal(findOptions.include.teamRegistrations.take, 10);
    assert.equal(countCalls, 1);
    assert.deepEqual(tournament.participantPagination, {
      page: 2,
      pageSize: 10,
      total: 25,
      totalPages: 3,
    });
  } finally {
    restore();
  }
});

test("admin tournament detail overlays live logos on its bracket field", () => {
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
  });
  try {
    const result = tournamentService.mapTournamentWithRegistrations({
      id: "tournament-1",
      slug: "quest-cup",
      title: "Quest Cup",
      game: "valorant",
      status: "draft",
      registrationMode: "open_entry",
      teamSize: 5,
      maxTeams: 16,
      registrationFeeAmount: 0,
      bracket: {
        status: "published",
        seedData: [{ id: "registration-1", logoUrl: "/old-seed.png" }],
        bracketData: {
          participant: [{ registrationId: "registration-1", logoUrl: "/old-participant.png" }],
          match: [],
        },
      },
    }, [{
      id: "registration-1",
      teamName: "Quest Five",
      teamLogoName: "stale.png",
      savedTeam: { logoName: "current.webp" },
    }]);

    assert.equal(result.bracket.seedData[0].logoUrl, "/api/uploads/team-logos/current.webp");
    assert.equal(
      result.bracket.bracketData.participant[0].logoUrl,
      "/api/uploads/team-logos/current.webp"
    );
  } finally {
    restore();
  }
});

test("future registrationOpenAt keeps an otherwise open tournament closed", async () => {
  const prismaMock = {
    prisma: {
      tournament: {
        findMany: async () => [
          {
            id: "tournament-1",
            slug: "future-cup",
            title: "Future Cup",
            game: "valorant",
            displayPriority: 100,
            shortDescription: "Short",
            fullDescription: "Full",
            rules: "Rules",
            registrationOpenAt: new Date(Date.now() + 60_000),
            startDate: new Date(Date.now() + 3600_000),
            endDate: new Date(Date.now() + 7200_000),
            registrationDeadline: new Date(Date.now() + 1800_000),
            format: "Single elimination",
            registrationMode: "open_entry",
            teamSize: 5,
            maxTeams: 16,
            prizePool: "LKR 100,000",
            status: "registration_open",
            isPublished: true,
            isFeatured: false,
            _count: {
              teamRegistrations: 0,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    },
  };

  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    const [tournament] = await tournamentService.listPublicTournaments();

    assert.equal(tournament.registrationState, "registration_closed");
    assert.equal(tournament.isRegistrationOpen, false);
    assert.equal(tournament.isRegistrationClosed, true);
  } finally {
    restore();
  }
});

test("public slot count shows confirmed teams and does not count pending holds", () => {
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
  });

  try {
    const tournament = tournamentService.mapTournament({
      id: "tournament-1",
      slug: "held-slot-cup",
      title: "Held Slot Cup",
      status: "registration_open",
      maxTeams: 10,
      isPublished: true,
      _count: { adminSlotReservations: 1 },
      teamRegistrations: [
        { status: "approved", paymentStatus: "paid", reservedUntil: null },
        { status: "approved", paymentStatus: "paid", reservedUntil: null },
        { status: "pending", paymentStatus: "pending", reservedUntil: new Date(Date.now() + 60_000) },
      ],
      adminSlotReservations: [{
        registration: {
          status: "pending",
          paymentStatus: "pending",
          reservedUntil: new Date(Date.now() + 60_000),
        },
      }],
    });

    assert.equal(tournament.registrationCount, 2);
    assert.equal(tournament.capacityUsed, 3);
  } finally {
    restore();
  }
});

test("parent event registration windows constrain child state even when the child override is open", () => {
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
  });

  try {
    const child = {
      id: "child-1",
      slug: "child-cup",
      title: "Child Cup",
      status: "registration_open",
      maxTeams: 8,
      isPublished: true,
      series: { registrationStatusOverride: "open" },
    };
    assert.equal(
      tournamentService.mapTournament(child, {
        parentWindow: { registrationOpenAt: new Date(Date.now() - 60_000), registrationCloseAt: new Date(Date.now() - 1) },
      }).registrationState,
      "registration_closed"
    );
    assert.equal(
      tournamentService.mapTournament(child, {
        parentWindow: { registrationOpenAt: new Date(Date.now() + 60_000), registrationCloseAt: null },
      }).registrationState,
      "upcoming",
      "a child open override cannot bypass a parent that has not opened"
    );
  } finally {
    restore();
  }
});

test("public slot count does not present a private admin hold as a confirmed team", () => {
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma: {} },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
  });

  try {
    const tournament = tournamentService.mapTournament({
      id: "tournament-1",
      slug: "held-slot-cup",
      title: "Held Slot Cup",
      status: "registration_open",
      maxTeams: 10,
      isPublished: true,
      _count: { adminSlotReservations: 1 },
      teamRegistrations: [
        { status: "approved", paymentStatus: "paid", reservedUntil: null },
        { status: "pending", paymentStatus: "unpaid", reservedUntil: null },
      ],
      adminSlotReservations: [{
        registration: {
          status: "pending",
          paymentStatus: "unpaid",
          reservedUntil: null,
        },
      }],
    });

    assert.equal(tournament.registrationCount, 1);
    assert.equal(tournament.capacityUsed, 2);
  } finally {
    restore();
  }
});

test("a TBA registration deadline does not close an otherwise open tournament", async () => {
  const prismaMock = {
    prisma: {
      tournament: {
        findMany: async () => [
          {
            id: "tournament-tba",
            slug: "tba-cup",
            title: "TBA Cup",
            game: "valorant",
            displayPriority: 100,
            shortDescription: "Short",
            fullDescription: "Full",
            rules: null,
            registrationOpenAt: null,
            startDate: null,
            startDateStatus: "tba",
            endDate: null,
            endDateStatus: "tbd",
            registrationDeadline: null,
            registrationDeadlineStatus: "tba",
            format: "Single elimination",
            registrationMode: "open_entry",
            teamSize: 5,
            maxTeams: 16,
            prizePool: "TBA",
            status: "registration_open",
            isPublished: true,
            isFeatured: false,
            _count: { teamRegistrations: 0 },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: prismaMock,
    [uploadModulePath]: {
      persistTeamLogoUpload: async () => null,
      persistTournamentBannerUpload: async () => null,
      persistTournamentScheduleUpload: async () => null,
    },
    [teamServiceModulePath]: {
      syncSavedTeamFromRegistration: async () => [],
      sendTeamInvites: async () => undefined,
    },
  });

  try {
    const [tournament] = await tournamentService.listPublicTournaments();
    assert.equal(tournament.registrationState, "registration_open");
    assert.equal(tournament.startDate, null);
    assert.equal(tournament.startDateStatus, "tba");
  } finally {
    restore();
  }
});

test("deleteAdminTournament removes private proofs and only unreferenced registration logos", async () => {
  const removedUploads = [];
  let transactionActive = false;
  let readInsideTransaction = false;
  let deleteInsideTransaction = false;
  const prisma = {
    tournament: {
      findUnique: async () => {
        readInsideTransaction = transactionActive;
        return ({
        id: "tournament-1",
        bannerImageName: "banner.webp",
        heroImageName: null,
        completedPosterImageName: null,
        firstPlaceImageName: null,
        secondPlaceImageName: null,
        thirdPlaceImageName: null,
        scheduleFileName: null,
        sponsors: [],
        teamRegistrations: [
          {
            teamLogoName: "shared-logo.webp",
            payments: [
              { bankTransferProof: { storedFilename: "private-proof.webp" } },
            ],
          },
          { teamLogoName: "orphan-logo.webp", payments: [] },
        ],
        });
      },
      deleteMany: async () => {
        deleteInsideTransaction = transactionActive;
        return { count: 1 };
      },
    },
    teamRegistration: { count: async () => 0 },
    savedTeam: {
      count: async ({ where }) => where.logoName === "shared-logo.webp" ? 1 : 0,
    },
  };
  prisma.$transaction = async (work) => {
    transactionActive = true;
    try { return await work(prisma); } finally { transactionActive = false; }
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {
      removeUploadFiles: async (uploads) => removedUploads.push(...uploads),
      tournamentBannerDirectory: "uploads/tournament-banners",
      tournamentScheduleDirectory: "uploads/tournament-schedules",
      sponsorLogoDirectory: "uploads/sponsor-logos",
      bankTransferProofDirectory: "private/bank-transfer-proofs",
      teamLogoDirectory: "uploads/team-logos",
    },
    [teamServiceModulePath]: {},
  });

  try {
    await tournamentService.deleteAdminTournament("tournament-1");
    assert.equal(readInsideTransaction, true);
    assert.equal(deleteInsideTransaction, true);
    assert.deepEqual(removedUploads, [
      { directory: "uploads/tournament-banners", filename: "banner.webp" },
      { directory: "private/bank-transfer-proofs", filename: "private-proof.webp" },
      { directory: "uploads/team-logos", filename: "orphan-logo.webp" },
    ]);
  } finally {
    restore();
  }
});

test("the default public projection still resolves bracket teams outside the participant page", async () => {
  let bracketFindOptions;
  const registrations = Array.from({ length: 50 }, (_, index) => ({
    id: `registration-${index + 1}`,
    teamName: `Team ${index + 1}`,
    captainName: `Captain ${index + 1}`,
    entryType: "team",
    status: "approved",
    members: [],
  }));
  const prisma = {
    teamRegistration: {
      count: async () => 75,
      findMany: async (options) => {
        bracketFindOptions = options;
        return [{
          id: "registration-outside-page",
          teamName: "Outside Page",
          teamLogoName: "current.png",
          savedTeam: null,
        }];
      },
    },
    tournament: {
      findFirst: async () => ({
        id: "tournament-1",
        slug: "quest-cup",
        title: "Quest Cup",
        game: "valorant",
        status: "registration_open",
        isPublished: true,
        teamRegistrations: registrations,
        bracket: {
          status: "published",
          lastUpdatedAt: new Date(),
          bracketData: {
            participant: [{ registrationId: "registration-outside-page", name: "Stale Name" }],
          },
        },
        _count: { teamRegistrations: 0, adminSlotReservations: 0 },
        adminSlotReservations: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
  });

  try {
    // No participant pagination query: participants are still bounded to the
    // default page, so published-bracket names must come from their own
    // unbounded read rather than from the bounded participant page.
    const tournament = await tournamentService.getPublicTournamentBySlug("quest-cup");

    assert.equal(bracketFindOptions?.where.tournamentId, "tournament-1");
    assert.equal("participantPagination" in tournament, false);
    assert.equal(tournament.registeredParticipants.length, 50);
    assert.deepEqual(tournament.bracketData.participant[0], {
      registrationId: "registration-outside-page",
      name: "Outside Page",
      shortCode: "OP",
      logoUrl: "/api/uploads/team-logos/current.png",
    });
  } finally {
    restore();
  }
});

test("the default public projection skips the bracket read when no bracket is published", async () => {
  let bracketReads = 0;
  const prisma = {
    teamRegistration: {
      count: async () => 4,
      findMany: async () => {
        bracketReads += 1;
        return [];
      },
    },
    tournament: {
      findFirst: async () => ({
        id: "tournament-1",
        slug: "quest-cup",
        title: "Quest Cup",
        game: "valorant",
        status: "registration_open",
        isPublished: true,
        teamRegistrations: [],
        bracket: { status: "draft", lastUpdatedAt: new Date(), bracketData: { participant: [] } },
        _count: { teamRegistrations: 0, adminSlotReservations: 0 },
        adminSlotReservations: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  };
  const { module: tournamentService, restore } = loadModuleWithMocks(servicePath, {
    [prismaModulePath]: { prisma },
    [uploadModulePath]: {},
    [teamServiceModulePath]: {},
  });

  try {
    await tournamentService.getPublicTournamentBySlug("quest-cup");
    assert.equal(bracketReads, 0, "an unpublished bracket must not trigger an extra registration read");
  } finally {
    restore();
  }
});
