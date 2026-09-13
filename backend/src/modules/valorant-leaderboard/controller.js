const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const {
  listAdminRegistrations,
  removeAdminRegistration,
  listLeaderboard,
  searchLeaderboardPlayers,
  checkPuuid: serviceCheckPuuid,
  previewRegistration: servicePreviewRegistration,
  submitRegistration: serviceSubmitRegistration,
} = require("./service");

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const respond = (res, data) =>
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });

const getLeaderboard = asyncHandler(async (req, res) => {
  const page = Math.max(1, parsePositiveInt(req.query.page, 1));
  const perPage = clamp(parsePositiveInt(req.query.per_page, 50), 1, 200);
  const data = await listLeaderboard({ page, perPage });
  respond(res, data);
});

const SEARCH_LIMIT_MAX = 50;
const SEARCH_LIMIT_DEFAULT = 25;

const searchLeaderboard = asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim();
  const limit = clamp(parsePositiveInt(req.query.limit, SEARCH_LIMIT_DEFAULT), 1, SEARCH_LIMIT_MAX);
  const entries = query ? await searchLeaderboardPlayers(query, { limit }) : [];
  // `entry` is the legacy single-result field, kept so older clients keep working.
  respond(res, { entries, entry: entries[0] ?? null });
});

const checkPuuid = asyncHandler(async (req, res) => {
  const data = await serviceCheckPuuid({
    userId: req.user.id,
    puuid: String(req.body?.puuid || ""),
  });
  respond(res, data);
});

const previewRegistration = asyncHandler(async (req, res) => {
  const data = await servicePreviewRegistration({
    userId: req.user.id,
    puuid: String(req.body?.puuid || ""),
  });
  respond(res, data);
});

const submitRegistration = asyncHandler(async (req, res) => {
  const data = await serviceSubmitRegistration({
    userId: req.user.id,
    puuid: String(req.body?.puuid || ""),
  });
  respond(res, data);
});

const ADMIN_QUERY_MAX_LENGTH = 100;
const REMOVAL_REASON_MAX_LENGTH = 500;

const listRegistrations = asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, ADMIN_QUERY_MAX_LENGTH);
  const page = Math.max(1, parsePositiveInt(req.query.page, 1));
  const perPage = clamp(parsePositiveInt(req.query.per_page, 50), 1, 200);
  const data = await listAdminRegistrations({ query, page, perPage, actorUserId: req.user.id });
  respond(res, data);
});

const removeRegistration = asyncHandler(async (req, res) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    throw new HttpError(400, "Give a reason for removing this player from the leaderboard.");
  }
  if (reason.length > REMOVAL_REASON_MAX_LENGTH) {
    throw new HttpError(400, `Keep the reason under ${REMOVAL_REASON_MAX_LENGTH} characters.`);
  }

  const data = await removeAdminRegistration({ puuid: req.params.puuid, actorUserId: req.user.id });
  const { removed } = data;
  // The audit policy keeps PUUIDs out of audit rows, so the Riot ID and Discord
  // handle are what identify the removed registration.
  await recordAudit({
    ...requestAuditContext(req),
    action: "valorant.leaderboard_player.remove",
    targetType: "valorant_leaderboard_player",
    targetId: null,
    beforeData: {
      riotId: `${removed.name}#${removed.tag}`,
      discordUsername: removed.discordUsername,
      currentTier: removed.currentTier,
      elo: removed.elo,
      lastPlayed: removed.lastPlayed,
      updateSource: removed.updateSource,
      updatedAt: removed.updatedAt,
      onLeaderboard: removed.onLeaderboard,
    },
    afterData: { removed: true, rankingsCleared: data.rankingsCleared },
    source: "admin",
    reason,
  });
  respond(res, data);
});

module.exports = {
  listRegistrations,
  removeRegistration,
  getLeaderboard,
  searchLeaderboard,
  checkPuuid,
  previewRegistration,
  submitRegistration,
};
