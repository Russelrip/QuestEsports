const { asyncHandler } = require("../../lib/async-handler");
const { resolveValorantAccount } = require("./game-account.service");

const respond = (res, data) =>
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });

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

module.exports = {
  resolveValorant,
};
