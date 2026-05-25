const crypto = require("crypto");
const { Prisma } = require("../../generated/prisma");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { persistTeamLogoUpload, persistTournamentBannerUpload } = require("../../middleware/upload");
const {
  syncSavedTeamFromRegistration,
  sendTeamInvites,
} = require("../teams/team.service");
const {
  buildPagination,
  buildPagedResponse,
} = require("../../lib/pagination");
const {
  normalizeEmail,
  normalizeText,
  normalizeSlug,
  normalizeInteger,
  normalizeOptionalUrl,
  isValidEmail,
} = require("../../lib/validation");

const TOURNAMENT_STATUSES = new Set([
  "draft",
  "upcoming",
  "registration_open",
  "ongoing",
  "completed",
  "cancelled",
]);

const requiredPlayerIndexes = [2, 3, 4, 5];
const registrationCountInclude = {
  _count: {
    select: {
      teamRegistrations: true,
    },
  },
};
const adminRegistrationSummarySelect = {
  id: true,
  teamName: true,
  captainName: true,
  captainEmail: true,
  contactEmail: true,
  status: true,
  paymentStatus: true,
  verificationStatus: true,
  createdAt: true,
};
const registrationAvailabilitySelect = {
  id: true,
  maxTeams: true,
  status: true,
  registrationDeadline: true,
  ...registrationCountInclude,
};
const DUPLICATE_REGISTRATION_MESSAGE =
  "This team or captain email is already registered for the selected tournament.";
const CLOSED_REGISTRATION_MESSAGE =
  "Registration is closed for the selected tournament.";
const FULL_REGISTRATION_MESSAGE =
  "Registration is full for the selected tournament.";

const normalizeBooleanFlag = (value) =>
  value === true || value === "true" || value === "on" || value === 1 || value === "1";

const parseDateValue = (value, fieldLabel) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new HttpError(400, `${fieldLabel} is required.`);
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, `${fieldLabel} must be a valid date.`);
  }

  return parsed;
};

const parseOptionalDateValue = (value) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseTournamentStatus = (value) => {
  const normalized = normalizeText(value).toLowerCase();

  if (!TOURNAMENT_STATUSES.has(normalized)) {
    throw new HttpError(400, "Invalid tournament status.");
  }

  return normalized;
};

const ensureSlugAvailable = async (slug, excludedTournamentId) => {
  const existingTournament = await prisma.tournament.findFirst({
    where: {
      slug,
      ...(excludedTournamentId ? { id: { not: excludedTournamentId } } : {}),
    },
    select: { id: true },
  });

  if (existingTournament) {
    throw new HttpError(400, "A tournament with this slug already exists.");
  }
};

const getTournamentBannerUrl = (bannerImageName) =>
  bannerImageName ? `/api/uploads/tournament-banners/${bannerImageName}` : null;

const withRegistrationCount = (tournament) => ({
  ...tournament,
  registrationCount:
    tournament.registrationCount || tournament._count?.teamRegistrations || 0,
});

const getRegistrationState = (tournament) => {
  const now = new Date();
  const registrationCount = tournament.registrationCount || 0;

  if (registrationCount >= tournament.maxTeams) {
    return "slots_full";
  }

  if (tournament.registrationDeadline && tournament.registrationDeadline < now) {
    return "registration_closed";
  }

  if (tournament.status !== "registration_open") {
    return "registration_closed";
  }

  return "registration_open";
};

const mapTournament = (tournament) => {
  const tournamentWithRegistrationCount = withRegistrationCount(tournament);
  const registrationState = getRegistrationState(tournamentWithRegistrationCount);

  return {
    id: tournamentWithRegistrationCount.id,
    slug: tournamentWithRegistrationCount.slug,
    title: tournamentWithRegistrationCount.title,
    game: tournamentWithRegistrationCount.game,
    bannerUrl: getTournamentBannerUrl(tournamentWithRegistrationCount.bannerImageName),
    shortDescription: tournamentWithRegistrationCount.shortDescription,
    fullDescription: tournamentWithRegistrationCount.fullDescription,
    rules: tournamentWithRegistrationCount.rules,
    startDate: tournamentWithRegistrationCount.startDate,
    endDate: tournamentWithRegistrationCount.endDate,
    registrationDeadline: tournamentWithRegistrationCount.registrationDeadline,
    format: tournamentWithRegistrationCount.format,
    teamSize: tournamentWithRegistrationCount.teamSize,
    maxTeams: tournamentWithRegistrationCount.maxTeams,
    registrationCount: tournamentWithRegistrationCount.registrationCount,
    prizePool: tournamentWithRegistrationCount.prizePool,
    status: tournamentWithRegistrationCount.status,
    isPublished: tournamentWithRegistrationCount.isPublished,
    bracketLink: tournamentWithRegistrationCount.bracketLink,
    contactLink: tournamentWithRegistrationCount.contactLink,
    isFeatured: tournamentWithRegistrationCount.isFeatured,
    registrationState,
    isRegistrationOpen: registrationState === "registration_open",
    isSlotsFull: registrationState === "slots_full",
    isRegistrationClosed: registrationState === "registration_closed",
    createdAt: tournamentWithRegistrationCount.createdAt,
    updatedAt: tournamentWithRegistrationCount.updatedAt,
  };
};

const mapTournamentWithRegistrations = (tournament) => ({
  ...mapTournament(tournament),
  registrations: (tournament.teamRegistrations || []).map((registration) => ({
    id: registration.id,
    teamName: registration.teamName,
    captainName: registration.captainName,
    captainEmail: registration.captainEmail,
    contactEmail: registration.contactEmail,
    status: registration.status,
    paymentStatus: registration.paymentStatus,
    verificationStatus: registration.verificationStatus,
    createdAt: registration.createdAt,
  })),
});

const sortPublicTournaments = (tournaments) =>
  [...tournaments].sort((left, right) => {
    if (left.isRegistrationOpen !== right.isRegistrationOpen) {
      return left.isRegistrationOpen ? -1 : 1;
    }

    if (left.isFeatured !== right.isFeatured) {
      return left.isFeatured ? -1 : 1;
    }

    const startDateDifference =
      new Date(left.startDate).getTime() - new Date(right.startDate).getTime();

    if (startDateDifference !== 0) {
      return startDateDifference;
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });

const getTournamentLookup = (body) => {
  const tournamentId = normalizeText(body.tournamentId);
  const tournamentSlug =
    normalizeText(body.tournamentSlug) || normalizeText(body.tournament);

  if (!tournamentId && !tournamentSlug) {
    throw new HttpError(400, "Tournament ID or slug is required.");
  }

  return { tournamentId, tournamentSlug };
};

const buildRequiredPlayers = (body) =>
  requiredPlayerIndexes.map((index) => ({
    order: index - 1,
    name: normalizeText(body[`player${index}Name`]),
    email: normalizeEmail(body[`player${index}Email`]),
    discord: normalizeText(body[`player${index}Discord`]),
    riotId: normalizeText(body[`player${index}RiotId`]),
  }));

const buildOptionalMembers = (body) => {
  const substitutes = [1, 2]
    .map((index) => ({
      role: "SUBSTITUTE",
      order: index,
      name: normalizeText(body[`sub${index}Name`]),
      email: normalizeEmail(body[`sub${index}Email`]),
      discord: normalizeText(body[`sub${index}Discord`]) || null,
      riotId: normalizeText(body[`sub${index}RiotId`]) || null,
    }))
    .filter((member) => member.name);

  const coachName = normalizeText(body.coachName);
  const coach = coachName
    ? [
        {
          role: "COACH",
          order: 1,
          name: coachName,
          email: normalizeEmail(body.coachEmail),
          discord: normalizeText(body.coachDiscord) || null,
          riotId: normalizeText(body.coachRiotId) || null,
        },
      ]
    : [];

  return [...substitutes, ...coach];
};

const ensureRegistrationOpen = (registrationState) => {
  if (registrationState === "registration_open") {
    return;
  }

  if (registrationState === "slots_full") {
    throw new HttpError(400, FULL_REGISTRATION_MESSAGE);
  }

  throw new HttpError(400, CLOSED_REGISTRATION_MESSAGE);
};

const buildTournamentRegistrationMembers = ({
  captainName,
  captainEmail,
  captainDiscord,
  captainRiotId,
  requiredPlayers,
  optionalMembers,
}) => [
  {
    role: "CAPTAIN",
    order: 1,
    name: captainName,
    email: captainEmail,
    discord: captainDiscord,
    riotId: captainRiotId,
  },
  ...requiredPlayers.map((player) => ({
    role: "PLAYER",
    ...player,
  })),
  ...optionalMembers,
];

const hasDuplicateMemberEmails = (members) => {
  const seenEmails = new Set();

  for (const member of members) {
    const email = normalizeEmail(member.email);

    if (!email) {
      continue;
    }

    if (seenEmails.has(email)) {
      return true;
    }

    seenEmails.add(email);
  }

  return false;
};

const parseTournamentPayload = ({ body, existingTournament }) => {
  const title = normalizeText(body.title);
  const titleFallback = existingTournament?.title || "";
  const slug =
    normalizeSlug(body.slug) ||
    normalizeSlug(title) ||
    normalizeSlug(titleFallback);
  const game = normalizeText(body.game).toLowerCase();
  const shortDescription = normalizeText(body.shortDescription);
  const fullDescription = normalizeText(body.fullDescription);
  const rules = normalizeText(body.rules);
  const format = normalizeText(body.format);
  const prizePool = normalizeText(body.prizePool);
  const teamSize = normalizeInteger(body.teamSize);
  const maxTeams = normalizeInteger(body.maxTeams);
  const status = parseTournamentStatus(body.status || existingTournament?.status);
  const startDate = parseDateValue(
    body.startDate || existingTournament?.startDate,
    "Start date"
  );
  const endDate = parseDateValue(
    body.endDate || existingTournament?.endDate,
    "End date"
  );
  const registrationDeadline = parseDateValue(
    body.registrationDeadline || existingTournament?.registrationDeadline,
    "Registration deadline"
  );
  const bracketLink = normalizeText(body.bracketLink)
    ? normalizeOptionalUrl(body.bracketLink)
    : null;
  const contactLink = normalizeText(body.contactLink)
    ? normalizeOptionalUrl(body.contactLink)
    : null;

  if (
    !title ||
    !slug ||
    !game ||
    !shortDescription ||
    !fullDescription ||
    !rules ||
    !format ||
    !prizePool
  ) {
    throw new HttpError(400, "Please fill all required tournament fields.");
  }

  if (!teamSize || teamSize <= 0 || !maxTeams || maxTeams <= 0) {
    throw new HttpError(400, "Team size and max teams must be valid numbers.");
  }

  if (registrationDeadline > startDate) {
    throw new HttpError(
      400,
      "Registration deadline must be before or on the tournament start date."
    );
  }

  if (endDate < startDate) {
    throw new HttpError(400, "End date must be after the start date.");
  }

  if (normalizeText(body.bracketLink) && !bracketLink) {
    throw new HttpError(400, "Bracket link must be a valid URL.");
  }

  if (normalizeText(body.contactLink) && !contactLink) {
    throw new HttpError(400, "Discord/contact link must be a valid URL.");
  }

  return {
    title,
    slug,
    game,
    shortDescription,
    fullDescription,
    rules,
    startDate,
    endDate,
    registrationDeadline,
    format,
    teamSize,
    maxTeams,
    prizePool,
    status,
    isPublished: normalizeBooleanFlag(body.isPublished),
    isFeatured: normalizeBooleanFlag(body.isFeatured),
    bracketLink,
    contactLink,
    isActive: status === "registration_open",
  };
};

const listPublicTournaments = async ({ game } = {}) => {
  const normalizedGame = normalizeText(game).toLowerCase();
  const tournaments = await prisma.tournament.findMany({
    where: {
      isPublished: true,
      ...(normalizedGame && normalizedGame !== "all" ? { game: normalizedGame } : {}),
    },
    orderBy: [{ isFeatured: "desc" }, { startDate: "asc" }, { createdAt: "desc" }],
    include: registrationCountInclude,
  });

  return sortPublicTournaments(tournaments.map(mapTournament));
};

const getPublicTournamentBySlug = async (slug) => {
  const normalizedSlug = normalizeSlug(slug);

  if (!normalizedSlug) {
    throw new HttpError(400, "Tournament slug is required.");
  }

  const tournament = await prisma.tournament.findFirst({
    where: {
      slug: normalizedSlug,
      isPublished: true,
    },
    include: registrationCountInclude,
  });

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  return mapTournament(tournament);
};

const listAdminTournaments = async ({ page, pageSize, search, status, isPublished } = {}) => {
  const pagination = buildPagination({ page, pageSize });
  const normalizedSearch = normalizeText(search);
  const normalizedStatus = normalizeText(status).toLowerCase();
  const visibilityFilter =
    typeof isPublished === "string" && isPublished.length > 0
      ? normalizeBooleanFlag(isPublished)
      : undefined;
  const where = {
    ...(normalizedSearch
      ? {
          OR: [
            { title: { contains: normalizedSearch, mode: "insensitive" } },
            { slug: { contains: normalizedSearch, mode: "insensitive" } },
            { game: { contains: normalizedSearch, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(TOURNAMENT_STATUSES.has(normalizedStatus) ? { status: normalizedStatus } : {}),
    ...(typeof visibilityFilter === "boolean" ? { isPublished: visibilityFilter } : {}),
  };

  const [total, tournaments] = await prisma.$transaction([
    prisma.tournament.count({ where }),
    prisma.tournament.findMany({
      where,
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      include: registrationCountInclude,
    }),
  ]);

  return buildPagedResponse({
    items: tournaments.map(mapTournament),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
};

const getAdminTournamentById = async (tournamentId) => {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      teamRegistrations: {
        orderBy: { createdAt: "desc" },
        select: adminRegistrationSummarySelect,
      },
      ...registrationCountInclude,
    },
  });

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  return mapTournamentWithRegistrations(tournament);
};

const createAdminTournament = async ({ body, file }) => {
  const payload = parseTournamentPayload({ body });
  await ensureSlugAvailable(payload.slug);
  const persistedBanner = await persistTournamentBannerUpload(file);

  const tournament = await prisma.tournament.create({
    data: {
      id: crypto.randomUUID(),
      ...payload,
      bannerImageName: persistedBanner ? persistedBanner.filename : null,
    },
    include: registrationCountInclude,
  });

  return mapTournament(tournament);
};

const updateAdminTournament = async ({ tournamentId, body, file }) => {
  const existingTournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
  });

  if (!existingTournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  const payload = parseTournamentPayload({ body, existingTournament });
  await ensureSlugAvailable(payload.slug, tournamentId);
  const persistedBanner = await persistTournamentBannerUpload(file);
  const removeBannerImage = normalizeBooleanFlag(body.removeBannerImage);

  const tournament = await prisma.tournament.update({
    where: { id: tournamentId },
    data: {
      ...payload,
      ...(removeBannerImage ? { bannerImageName: null } : {}),
      ...(persistedBanner ? { bannerImageName: persistedBanner.filename } : {}),
    },
    include: registrationCountInclude,
  });

  return mapTournament(tournament);
};

const deleteAdminTournament = async (tournamentId) => {
  const deleted = await prisma.tournament.deleteMany({
    where: { id: tournamentId },
  });

  if (deleted.count === 0) {
    throw new HttpError(404, "Tournament not found.");
  }
};

const getTournamentRegistrationStatus = async ({ slug, user }) => {
  const tournamentSlug = normalizeSlug(slug);

  if (!tournamentSlug) {
    throw new HttpError(400, "Tournament slug is required.");
  }

  const tournament = await prisma.tournament.findUnique({
    where: { slug: tournamentSlug },
    select: {
      id: true,
    },
  });

  if (!tournament) {
    throw new HttpError(404, "Tournament not found.");
  }

  const existingRegistration = await prisma.teamRegistration.findFirst({
    where: {
      tournamentId: tournament.id,
      captainEmail: normalizeEmail(user.email),
    },
    select: { id: true },
  });

  return {
    isRegistered: Boolean(existingRegistration),
  };
};

const createTournamentRegistration = async ({ body, file, user }) => {
  const { tournamentId, tournamentSlug } = getTournamentLookup(body);
  const teamName = normalizeText(body.teamName);
  const captainName = normalizeText(body.captainName);
  const captainEmail = normalizeEmail(user?.email);
  const captainPhone = normalizeText(body.captainPhone);
  const captainDiscord = normalizeText(body.captainDiscord);
  const captainRiotId = normalizeText(body.captainRiotId);
  const contactEmail = normalizeEmail(body.contactEmail);
  const rulebookAccepted = normalizeBooleanFlag(body.rulebook);
  const falsityWarningAccepted = normalizeBooleanFlag(body.falsityWarning);
  const requiredPlayers = buildRequiredPlayers(body);
  const optionalMembers = buildOptionalMembers(body);

  if (
    !captainEmail ||
    !teamName ||
    !captainName ||
    !captainPhone ||
    !captainDiscord ||
    !captainRiotId ||
    !isValidEmail(captainEmail) ||
    !isValidEmail(contactEmail) ||
    !rulebookAccepted ||
    !falsityWarningAccepted ||
    requiredPlayers.some((player) => !player.name || !player.discord || !player.riotId)
  ) {
    throw new HttpError(
      400,
      "Please fill all required fields and accept the agreements."
    );
  }

  const tournament = await prisma.tournament.findUnique({
    where: tournamentId ? { id: tournamentId } : { slug: normalizeSlug(tournamentSlug) },
    include: registrationCountInclude,
  });

  if (!tournament) {
    throw new HttpError(404, "Selected tournament was not found.");
  }

  const mappedTournament = mapTournament(tournament);
  ensureRegistrationOpen(mappedTournament.registrationState);

  const persistedLogo = await persistTeamLogoUpload(file);

  const members = buildTournamentRegistrationMembers({
    captainName,
    captainEmail,
    captainDiscord,
    captainRiotId,
    requiredPlayers,
    optionalMembers,
  });

  if (
    requiredPlayers.some(
      (player) => !player.name || !player.email || !player.discord || !player.riotId
    ) ||
    optionalMembers.some(
      (member) =>
        !member.name ||
        !member.email ||
        (member.role !== "COACH" && !member.discord) ||
        (member.role !== "COACH" && !member.riotId)
    ) ||
    members.some((member) => !isValidEmail(member.email)) ||
    hasDuplicateMemberEmails(members)
  ) {
    throw new HttpError(
      400,
      "Each roster member needs a unique valid email address before you can register."
    );
  }

  const registrationId = crypto.randomUUID();
  let inviteDispatches = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        const [currentTournament, existingRegistration] = await Promise.all([
          tx.tournament.findUnique({
            where: { id: tournament.id },
            select: registrationAvailabilitySelect,
          }),
          tx.teamRegistration.findFirst({
            where: {
              tournamentId: tournament.id,
              OR: [{ teamName }, { captainEmail }],
            },
            select: { id: true },
          }),
        ]);

        if (!currentTournament) {
          throw new HttpError(404, "Selected tournament was not found.");
        }

        ensureRegistrationOpen(getRegistrationState(withRegistrationCount(currentTournament)));

        if (existingRegistration) {
          throw new HttpError(400, DUPLICATE_REGISTRATION_MESSAGE);
        }

        await tx.teamRegistration.create({
          data: {
            id: registrationId,
            tournamentId: tournament.id,
            teamName,
            captainName,
            captainEmail,
            captainPhone,
            captainDiscord,
            captainRiotId,
            contactEmail,
            teamLogoName: persistedLogo ? persistedLogo.filename : null,
            rulebookAccepted,
            falsityWarningAccepted,
          },
        });

        await tx.registrationMember.createMany({
          data: members.map((member) => ({
            id: crypto.randomUUID(),
            registrationId,
            role: member.role,
            memberOrder: member.order,
            name: member.name,
            email: member.email,
            emailNormalized: normalizeEmail(member.email),
            discord: member.discord,
            riotId: member.riotId,
          })),
        });

        inviteDispatches = await syncSavedTeamFromRegistration({
          tx,
          user,
          teamName,
          logoName: persistedLogo ? persistedLogo.filename : null,
          members,
          tournamentTitle: tournament.title,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        throw new HttpError(400, DUPLICATE_REGISTRATION_MESSAGE);
      }

      if (error.code === "P2034") {
        throw new HttpError(
          409,
          "Registration changed while your request was being processed. Please try again."
        );
      }
    }

    throw error;
  }

  await sendTeamInvites(inviteDispatches);
};

module.exports = {
  listPublicTournaments,
  getPublicTournamentBySlug,
  listAdminTournaments,
  getAdminTournamentById,
  createAdminTournament,
  updateAdminTournament,
  deleteAdminTournament,
  getTournamentRegistrationStatus,
  createTournamentRegistration,
  parseOptionalDateValue,
};
