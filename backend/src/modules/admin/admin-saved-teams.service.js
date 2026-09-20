const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { removeTeamLogoIfUnreferenced } = require("../../lib/upload-cleanup");
const { buildPagination, buildPagedResponse } = require("../../lib/pagination");
const { normalizeEmail, normalizeText } = require("../../lib/validation");

const SAVED_TEAM_CAPTAIN_SELECT = {
  firstName: true,
  lastName: true,
  username: true,
};

const SAVED_TEAM_MEMBER_SELECT = {
  id: true,
  userId: true,
  role: true,
  name: true,
  email: true,
  emailNormalized: true,
  phone: true,
  discord: true,
  riotId: true,
  inviteStatus: true,
  // The member's own connected account, which is what `gameId` should be.
  // `riotId` is a string a captain or an admin typed and nothing ever checked;
  // a game account was resolved against Riot, is keyed by PUUID rather than a
  // display name, and cannot be claimed by two Quest users at once.
  player: {
    select: {
      gameAccounts: {
        where: { status: { in: ["active", "locked"] } },
        orderBy: { linkedAt: "desc" },
        select: { game: true, username: true, tagline: true, verificationStatus: true },
      },
    },
  },
};

// `Name#TAG`, the form every VALORANT surface here expects. Null unless both
// halves are present: half an identifier is worse than none, because it looks
// like a value and matches nothing.
const gameAccountRiotId = (account) =>
  account?.username && account?.tagline ? `${account.username}#${account.tagline}` : null;

const connectedGameId = (member, game = "valorant") => {
  const account = (member.player?.gameAccounts || []).find(
    (candidate) => candidate.game === game
  );
  return gameAccountRiotId(account);
};

const getSavedTeamCaptainName = (team) =>
  [team.captainUser?.firstName, team.captainUser?.lastName].filter(Boolean).join(" ").trim() ||
  team.captainUser?.username ||
  "Unknown captain";

const mapAdminSavedTeamSummary = (team) => ({
  id: team.id,
  name: team.name,
  teamTag: team.teamTag,
  logoUrl: team.logoName ? `/api/uploads/team-logos/${team.logoName}` : null,
  country: team.country,
  organizationName: team.organizationName || "Independent",
  captainName: getSavedTeamCaptainName(team),
  memberCount: team._count.members,
  updatedAt: team.updatedAt,
});

// What a roster member's own Quest account says about them.
//
// Discord and game ids stopped being typed into rosters: they arrive when the
// person connects them, and new roster rows are written without them. Reading
// only the row therefore left every newer team blank on this page even when
// each member had connected everything. The account is found the way the
// captain's own roster finds it: the linked user, or for an invitation nobody
// has answered yet, an account that has proven it owns the address.
const ACCOUNT_DETAIL_SELECT = {
  id: true,
  emailNormalized: true,
  emailVerified: true,
  phone: true,
  discordTag: true,
  oauthAccounts: { where: { provider: "discord" }, select: { id: true }, take: 1 },
  player: {
    select: {
      gameAccounts: {
        where: { status: { in: ["active", "locked"] } },
        orderBy: { linkedAt: "desc" },
        select: { game: true, username: true, tagline: true, verificationStatus: true },
      },
    },
  },
};

const loadMemberAccounts = async (members = []) => {
  const userIds = [...new Set(members.map((member) => member.userId).filter(Boolean))];
  const emails = [
    ...new Set(
      members
        .filter((member) => !member.userId)
        .map((member) => member.emailNormalized || normalizeEmail(member.email))
        .filter(Boolean)
    ),
  ];
  if ((userIds.length === 0 && emails.length === 0) || typeof prisma.user?.findMany !== "function") {
    return () => null;
  }

  const accounts = await prisma.user.findMany({
    where: {
      OR: [
        ...(userIds.length ? [{ id: { in: userIds } }] : []),
        ...(emails.length ? [{ emailNormalized: { in: emails }, emailVerified: true }] : []),
      ],
    },
    select: ACCOUNT_DETAIL_SELECT,
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const byVerifiedEmail = new Map(
    accounts
      .filter((account) => account.emailVerified && account.emailNormalized)
      .map((account) => [account.emailNormalized, account])
  );
  return (member) =>
    (member.userId ? byId.get(member.userId) : null) ||
    (!member.userId ? byVerifiedEmail.get(member.emailNormalized || normalizeEmail(member.email)) : null) ||
    null;
};

const mapAdminSavedTeamDetail = (team, accountFor = () => null) => ({
  ...mapAdminSavedTeamSummary(team),
  members: (team.members || []).map((member) => {
    const account = accountFor(member);
    // The connected account first, the typed string only as a fallback for a
    // roster that predates game accounts. Reported separately so a surface can
    // tell a verified identity from an inherited guess rather than having to
    // treat them alike.
    const connected = connectedGameId(member) ?? (account ? connectedGameId(account) : null);
    return {
      id: member.id,
      role: member.role,
      name: member.name,
      email: member.email,
      // `phone` and `discord` stay what the row itself carries, so saving the
      // page writes back only what was typed and never copies account data
      // onto the roster. What the account says is under `account`.
      phone: member.phone ?? null,
      discord: member.discord,
      gameId: connected ?? member.riotId,
      gameAccountConnected: Boolean(connected),
      legacyGameId: member.riotId ?? null,
      inviteStatus: member.inviteStatus,
      account: account
        ? {
            phone: account.phone || null,
            // A handle counts only while the Discord link that wrote it exists.
            discord: account.oauthAccounts?.length ? account.discordTag || null : null,
            discordConnected: Boolean(account.oauthAccounts?.length),
          }
        : null,
    };
  }),
});

const listAdminSavedTeams = async ({ page, pageSize, search } = {}) => {
  const pagination = buildPagination({ page, pageSize });
  const normalizedSearch = normalizeText(search);
  const textFilter = { contains: normalizedSearch, mode: "insensitive" };
  const where = normalizedSearch
    ? {
        OR: [
          { name: textFilter },
          { teamTag: textFilter },
          { country: textFilter },
          { organizationName: textFilter },
          { captainUser: { is: { OR: [
            { firstName: textFilter },
            { lastName: textFilter },
            { username: textFilter },
            { email: textFilter },
          ] } } },
          { members: { some: { OR: [
            { name: textFilter },
            { email: textFilter },
            { discord: textFilter },
            { riotId: textFilter },
          ] } } },
        ],
      }
    : {};
  const [total, teams] = await prisma.$transaction([
    prisma.savedTeam.count({ where }),
    prisma.savedTeam.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: {
        id: true,
        name: true,
        teamTag: true,
        logoName: true,
        country: true,
        organizationName: true,
        updatedAt: true,
        captainUser: { select: SAVED_TEAM_CAPTAIN_SELECT },
        _count: { select: { members: true } },
      },
    }),
  ]);
  return buildPagedResponse({
    items: teams.map(mapAdminSavedTeamSummary),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
};

const getAdminSavedTeamById = async (teamId) => {
  const team = await prisma.savedTeam.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      teamTag: true,
      logoName: true,
      country: true,
      organizationName: true,
      updatedAt: true,
      captainUser: { select: SAVED_TEAM_CAPTAIN_SELECT },
      members: {
        orderBy: [{ role: "asc" }, { memberOrder: "asc" }],
        select: SAVED_TEAM_MEMBER_SELECT,
      },
      _count: { select: { members: true } },
    },
  });
  if (!team) throw new HttpError(404, "Team not found.");
  return mapAdminSavedTeamDetail(team, await loadMemberAccounts(team.members));
};

const updateAdminSavedTeamOrganization = async (teamId, body) => {
  const requested = normalizeText(body.organizationName);
  if (requested.length > 120) throw new HttpError(400, "Organization name is too long.");
  const updated = await prisma.savedTeam.updateMany({
    where: { id: teamId },
    data: { organizationName: requested && requested.toLowerCase() !== "independent" ? requested : null },
  });
  if (!updated.count) throw new HttpError(404, "Team not found.");
  return { organizationName: requested && requested.toLowerCase() !== "independent" ? requested : "Independent" };
};

const deleteAdminSavedTeam = async (teamId) => {
  const team = await prisma.savedTeam.findUnique({
    where: { id: teamId },
    select: { id: true, logoName: true },
  });
  if (!team) throw new HttpError(404, "Team not found.");

  const activeBinding = await prisma.valorantTeamBinding.findFirst({
    where: { savedTeamId: team.id, status: "active" },
    select: { id: true },
  });
  if (activeBinding) {
    throw new HttpError(
      409,
      "This team cannot be deleted because it has an active VALORANT binding. Detach the VALORANT binding first."
    );
  }

  const deleted = await prisma.savedTeam.deleteMany({
    where: { id: team.id },
  });
  if (!deleted.count) throw new HttpError(404, "Team not found.");

  if (team.logoName) {
    await removeTeamLogoIfUnreferenced({
      prisma,
      filename: team.logoName,
      context: { operation: "deleteAdminSavedTeam", teamId },
    });
  }
};

module.exports = {
  listAdminSavedTeams,
  getAdminSavedTeamById,
  updateAdminSavedTeamOrganization,
  deleteAdminSavedTeam,
};
