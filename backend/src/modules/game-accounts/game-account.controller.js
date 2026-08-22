const { asyncHandler } = require("../../lib/async-handler");
const { requestAuditContext } = require("../../lib/audit");
const {
  resolveValorantAccount,
  linkValorantAccount,
  listGameAccountsForUser,
} = require("./game-account.service");

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
  respond(res, data);
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
  respond(res, result.account, result.alreadyLinked ? 200 : 201);
});

const listMyGameAccounts = asyncHandler(async (req, res) => {
  const data = await listGameAccountsForUser({ userId: req.user.id });
  respond(res, data);
});

module.exports = {
  resolveValorant,
  linkValorant,
  listMyGameAccounts,
};
