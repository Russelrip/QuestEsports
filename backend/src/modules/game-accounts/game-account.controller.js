const { asyncHandler } = require("../../lib/async-handler");
const { requestAuditContext } = require("../../lib/audit");
const {
  resolveValorantAccount,
  linkValorantAccount,
  importValorantAccountFromLeaderboard,
  listGameAccountsForUser,
  findLeaderboardRegistration,
  compareWithLeaderboard,
  withoutExternalId,
} = require("./game-account.service");
const { getRegistrationReadiness } = require("./registration-readiness.service");
const {
  requestAccountChange,
  withdrawAccountChange,
  listChangeRequests,
  reviewChangeRequest,
} = require("./game-account-change.service");

const respond = (res, data, status = 200) =>
  res.status(status).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });

// Resolution is a lookup, not a claim: it tells the player which Riot account
// Quest found so they can confirm it. Nothing is stored here.
const resolveValorant = asyncHandler(async (req, res) => {
  const data = await resolveValorantAccount({
    riotId: req.body?.riotId,
    name: req.body?.name,
    tag: req.body?.tag,
    userId: req.user.id,
  });
  // Whether this is the account the player's Discord is registered with on the
  // leaderboard, so the confirmation card can warn before they connect a
  // different one. Compared by stable identifier here because the browser never
  // sees it.
  const leaderboard = await compareWithLeaderboard({
    userId: req.user.id,
    externalId: data.externalId,
  });
  // The identifier is what made the comparison possible, not something the
  // player needs; it stays on the server like everywhere else in this module.
  respond(res, { ...withoutExternalId(data), leaderboard });
});

// The confirmation step. The browser sends the Riot ID it displayed, never a
// stable identifier: the PUUID is re-resolved server-side so a crafted request
// cannot bind an account the player never saw.
const linkValorant = asyncHandler(async (req, res) => {
  const result = await linkValorantAccount({
    riotId: req.body?.riotId,
    name: req.body?.name,
    tag: req.body?.tag,
    userId: req.user.id,
    displayName: req.user.username || req.user.firstName || "Player",
    audit: requestAuditContext(req),
  });
  // The leaderboard outcome rides along so the panel can say what happened,
  // including the one case the player has to act on: an entry still pointing at
  // an account they no longer use.
  respond(
    res,
    { ...result.account, leaderboard: result.leaderboard ?? null },
    result.alreadyLinked ? 200 : 201
  );
});

// Adopts the account this user already registered on the leaderboard, which
// asked for the same proof through a longer door.
const importValorantFromLeaderboard = asyncHandler(async (req, res) => {
  const result = await importValorantAccountFromLeaderboard({
    userId: req.user.id,
    displayName: req.user.username || req.user.firstName || "Player",
    audit: requestAuditContext(req),
  });
  // The leaderboard outcome rides along so the panel can say what happened,
  // including the one case the player has to act on: an entry still pointing at
  // an account they no longer use.
  respond(
    res,
    { ...result.account, leaderboard: result.leaderboard ?? null },
    result.alreadyLinked ? 200 : 201
  );
});

// Names the account a not-yet-connected player registered on the leaderboard,
// so the profile can offer that exact account rather than a blind import.
const getMyLeaderboardRegistration = asyncHandler(async (req, res) => {
  const data = await findLeaderboardRegistration({ userId: req.user.id });
  respond(res, data);
});

const listMyGameAccounts = asyncHandler(async (req, res) => {
  const data = await listGameAccountsForUser({ userId: req.user.id });
  respond(res, data);
});

// The authoritative answer to "can this team register?". The frontend renders
// this result; it must not recompute the rules.
const getTeamRegistrationReadiness = asyncHandler(async (req, res) => {
  const data = await getRegistrationReadiness({
    teamId: req.params.teamId,
    tournamentId: req.query.tournamentId ? String(req.query.tournamentId) : null,
    user: req.user,
  });
  respond(res, data);
});

// A rename and a replacement arrive through the same door and are told apart
// by the stable identifier, not by what the player calls it.
const requestValorantChange = asyncHandler(async (req, res) => {
  const data = await requestAccountChange({
    userId: req.user.id,
    riotId: req.body?.riotId,
    name: req.body?.name,
    tag: req.body?.tag,
    reason: req.body?.reason,
    audit: requestAuditContext(req),
  });
  respond(res, data, data.kind === "replacement" ? 202 : 200);
});

const withdrawValorantChange = asyncHandler(async (req, res) => {
  const data = await withdrawAccountChange({
    userId: req.user.id,
    audit: requestAuditContext(req),
  });
  respond(res, data);
});

const listAdminChangeRequests = asyncHandler(async (req, res) => {
  const data = await listChangeRequests({
    status: req.query.status ? String(req.query.status) : "pending",
  });
  respond(res, { requests: data });
});

const reviewAdminChangeRequest = asyncHandler(async (req, res) => {
  const data = await reviewChangeRequest({
    requestId: req.params.requestId,
    approve: req.body?.approve === true,
    adminUserId: req.user.id,
    adminNote: req.body?.adminNote,
    audit: requestAuditContext(req),
  });
  respond(res, data);
});

module.exports = {
  resolveValorant,
  requestValorantChange,
  withdrawValorantChange,
  getMyLeaderboardRegistration,
  listAdminChangeRequests,
  reviewAdminChangeRequest,
  linkValorant,
  importValorantFromLeaderboard,
  listMyGameAccounts,
  getTeamRegistrationReadiness,
};
