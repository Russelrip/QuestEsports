const crypto = require("crypto");
const { BracketsManager } = require("brackets-manager");
const { Status } = require("brackets-model");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { normalizeText } = require("../../lib/validation");

const BRACKET_TABLES = ["participant", "stage", "group", "round", "match", "match_game"];
const MATCH_STATUSES = new Map([
  [Status.Locked, "locked"],
  [Status.Waiting, "waiting"],
  [Status.Ready, "ready"],
  [Status.Running, "live"],
  [Status.Completed, "completed"],
  [Status.Archived, "completed"],
  [Status.GameCancelled, "paused"],
]);

class MemoryBracketStorage {
  constructor(data = {}) {
    this.data = {};
    this.nextIds = {};

    BRACKET_TABLES.forEach((table) => {
      this.data[table] = Array.isArray(data[table])
        ? data[table].map((item) => ({ ...item }))
        : [];
    });
  }

  ensure(table) {
    if (!this.data[table]) {
      this.data[table] = [];
    }

    if (this.nextIds[table] === undefined) {
      this.nextIds[table] =
        this.data[table].reduce((maximum, item) => Math.max(maximum, Number(item.id) || 0), -1) + 1;
    }
  }

  async insert(table, value) {
    this.ensure(table);

    if (Array.isArray(value)) {
      value.forEach((item) => {
        const nextItem = { ...item };
        if (nextItem.id === undefined || nextItem.id === null) {
          nextItem.id = this.nextIds[table]++;
        }
        this.data[table].push(nextItem);
      });
      return true;
    }

    const nextItem = { ...value };
    if (nextItem.id === undefined || nextItem.id === null) {
      nextItem.id = this.nextIds[table]++;
    }
    this.data[table].push(nextItem);
    return nextItem.id;
  }

  async select(table, key) {
    this.ensure(table);

    if (key === undefined) {
      return this.data[table].map((item) => ({ ...item }));
    }

    if (typeof key === "number" || typeof key === "string") {
      const item = this.data[table].find((candidate) => candidate.id === key);
      return item ? { ...item } : null;
    }

    return this.data[table]
      .filter((item) => Object.entries(key).every(([field, value]) => item[field] === value))
      .map((item) => ({ ...item }));
  }

  async update(table, key, value) {
    this.ensure(table);
    const indexes =
      typeof key === "number" || typeof key === "string"
        ? [this.data[table].findIndex((item) => item.id === key)]
        : this.data[table]
            .map((item, index) =>
              Object.entries(key).every(([field, fieldValue]) => item[field] === fieldValue)
                ? index
                : -1
            )
            .filter((index) => index >= 0);

    indexes.forEach((index) => {
      if (index >= 0) {
        this.data[table][index] = { ...this.data[table][index], ...value };
      }
    });

    return true;
  }

  async delete(table, filter) {
    this.ensure(table);

    if (!filter) {
      this.data[table] = [];
      return true;
    }

    this.data[table] = this.data[table].filter(
      (item) => !Object.entries(filter).every(([field, value]) => item[field] === value)
    );
    return true;
  }
}

const createManager = (data) => new BracketsManager(new MemoryBracketStorage(data));

const getNextPowerOfTwo = (value) => {
  let size = 1;
  while (size < value) {
    size *= 2;
  }
  return size;
};

const buildShortCode = (teamName) => {
  const words = normalizeText(teamName)
    .split(/\s+/)
    .filter(Boolean);
  const code = words.length > 1
    ? words.map((word) => word[0]).join("")
    : normalizeText(teamName).replace(/[^a-z0-9]/gi, "").slice(0, 4);

  return (code || "TBD").slice(0, 5).toUpperCase();
};

const parseIntegerValue = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const getTeamLogoUrl = (teamLogoName) =>
  teamLogoName ? `/api/uploads/team-logos/${teamLogoName}` : null;

const mapBracketRecord = (bracket) => {
  if (!bracket) {
    return null;
  }

  return {
    id: bracket.id,
    tournamentId: bracket.tournamentId,
    format: bracket.format,
    status: bracket.status,
    seedData: bracket.seedData,
    bracketData: bracket.bracketData,
    summary: buildBracketSummary(bracket.bracketData, bracket.lastUpdatedAt),
    generatedAt: bracket.generatedAt,
    publishedAt: bracket.publishedAt,
    lastUpdatedAt: bracket.lastUpdatedAt,
  };
};

const buildBracketSummary = (bracketData, lastUpdatedAt) => {
  const matches = Array.isArray(bracketData?.match) ? bracketData.match : [];
  const counts = matches.reduce(
    (summary, match) => {
      const normalizedStatus = MATCH_STATUSES.get(match.status) || "pending";
      if (normalizedStatus === "completed") {
        summary.completed += 1;
      } else if (normalizedStatus === "live") {
        summary.live += 1;
      } else if (normalizedStatus === "paused") {
        summary.paused += 1;
      } else {
        summary.pending += 1;
      }
      return summary;
    },
    { total: matches.length, completed: 0, live: 0, paused: 0, pending: 0 }
  );

  return {
    ...counts,
    lastUpdatedAt,
  };
};

const mapPublicBracket = (bracket) => {
  if (!bracket || bracket.status !== "published") {
    return {
      bracketSummary: null,
      bracketData: null,
    };
  }

  return {
    bracketSummary: buildBracketSummary(bracket.bracketData, bracket.lastUpdatedAt),
    bracketData: bracket.bracketData,
  };
};

const listApprovedBracketSeeds = async (tournamentId) => {
  const registrations = await prisma.teamRegistration.findMany({
    where: {
      tournamentId,
      status: "approved",
    },
    orderBy: [{ createdAt: "asc" }],
    include: {
      members: {
        select: { id: true },
      },
    },
  });

  return registrations.map((registration, index) => ({
    id: registration.id,
    seed: index + 1,
    name: registration.teamName,
    shortCode: buildShortCode(registration.teamName),
    logoUrl: getTeamLogoUrl(registration.teamLogoName),
    memberCount: registration.members.length,
  }));
};

const generateTournamentBracket = async (tournamentId) => {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, title: true },
  });

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  const seeds = await listApprovedBracketSeeds(tournamentId);

  if (seeds.length < 2) {
    throw new HttpError(400, "Approve at least two teams before generating a bracket.");
  }

  const size = getNextPowerOfTwo(seeds.length);
  const seeding = [
    ...seeds.map((seed) => ({
      name: seed.name,
      registrationId: seed.id,
      shortCode: seed.shortCode,
      logoUrl: seed.logoUrl,
      seed: seed.seed,
    })),
    ...Array.from({ length: size - seeds.length }, () => null),
  ];
  const manager = createManager();

  await manager.create.stage({
    tournamentId: 0,
    name: `${tournament.title} Bracket`,
    type: "double_elimination",
    seeding,
    settings: {
      size,
      balanceByes: true,
      grandFinal: "double",
      seedOrdering: ["natural"],
    },
  });

  const bracketData = await manager.export();
  const bracket = await prisma.tournamentBracket.upsert({
    where: { tournamentId },
    create: {
      id: crypto.randomUUID(),
      tournamentId,
      format: "double_elimination",
      status: "draft",
      seedData: seeds,
      bracketData,
      generatedAt: new Date(),
      publishedAt: null,
    },
    update: {
      format: "double_elimination",
      status: "draft",
      seedData: seeds,
      bracketData,
      generatedAt: new Date(),
      publishedAt: null,
    },
  });

  return mapBracketRecord(bracket);
};

const getAdminTournamentBracket = async (tournamentId) => {
  const bracket = await prisma.tournamentBracket.findUnique({
    where: { tournamentId },
  });

  return mapBracketRecord(bracket);
};

const updateTournamentBracketMatch = async (tournamentId, matchId, body) => {
  const bracket = await prisma.tournamentBracket.findUnique({
    where: { tournamentId },
  });

  if (!bracket) {
    throw new HttpError(404, "Bracket not found.");
  }

  const parsedMatchId = parseIntegerValue(matchId);
  const opponent1Score = parseIntegerValue(body.opponent1Score);
  const opponent2Score = parseIntegerValue(body.opponent2Score);
  const winner = normalizeText(body.winner);

  if (parsedMatchId === null || parsedMatchId === undefined) {
    throw new HttpError(400, "Match ID must be valid.");
  }

  if (opponent1Score === null || opponent2Score === null) {
    throw new HttpError(400, "Both scores are required.");
  }

  if (!["opponent1", "opponent2"].includes(winner)) {
    throw new HttpError(400, "Winner must be opponent1 or opponent2.");
  }

  const manager = createManager(bracket.bracketData);
  const match = await manager.storage.select("match", parsedMatchId);

  if (!match) {
    throw new HttpError(404, "Match not found.");
  }

  await manager.update.match({
    id: parsedMatchId,
    opponent1: {
      score: opponent1Score,
      result: winner === "opponent1" ? "win" : "loss",
    },
    opponent2: {
      score: opponent2Score,
      result: winner === "opponent2" ? "win" : "loss",
    },
  });

  const bracketData = await manager.export();
  const updated = await prisma.tournamentBracket.update({
    where: { tournamentId },
    data: {
      bracketData,
      status: bracket.status,
    },
  });

  return mapBracketRecord(updated);
};

const publishTournamentBracket = async (tournamentId, body) => {
  const bracket = await prisma.tournamentBracket.findUnique({
    where: { tournamentId },
  });

  if (!bracket) {
    throw new HttpError(404, "Bracket not found.");
  }

  const publish =
    body?.isPublished === undefined
      ? true
      : ["true", "1", "yes", "on"].includes(normalizeText(body.isPublished).toLowerCase());
  const updated = await prisma.tournamentBracket.update({
    where: { tournamentId },
    data: {
      status: publish ? "published" : "draft",
      publishedAt: publish ? new Date() : null,
    },
  });

  return mapBracketRecord(updated);
};

module.exports = {
  buildBracketSummary,
  buildShortCode,
  generateTournamentBracket,
  getAdminTournamentBracket,
  listApprovedBracketSeeds,
  mapPublicBracket,
  updateTournamentBracketMatch,
  publishTournamentBracket,
};
