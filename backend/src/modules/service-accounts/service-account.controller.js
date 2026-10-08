const { asyncHandler } = require("../../lib/async-handler");
const { requestAuditContext } = require("../../lib/audit");
const {
  DEFAULT_TOKEN_DAYS,
  MAX_TOKEN_DAYS,
  createServiceAccount,
  issueServiceToken,
  listServiceAccounts,
  revokeServiceToken,
} = require("./service-account.service");

const respond = (res, data, status = 200) =>
  res.status(status).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });

const getServiceAccounts = asyncHandler(async (req, res) => {
  respond(res, {
    accounts: await listServiceAccounts(),
    tokenDays: { default: DEFAULT_TOKEN_DAYS, max: MAX_TOKEN_DAYS },
  });
});

const postServiceAccount = asyncHandler(async (req, res) => {
  respond(res, await createServiceAccount(req.body, requestAuditContext(req)), 201);
});

const postServiceToken = asyncHandler(async (req, res) => {
  // Never cached anywhere: this response is the token's only copy.
  res.setHeader("Cache-Control", "no-store");
  respond(res, await issueServiceToken(req.params.userId, req.body, requestAuditContext(req)), 201);
});

const deleteServiceToken = asyncHandler(async (req, res) => {
  respond(res, await revokeServiceToken(req.params.userId, req.params.tokenId, requestAuditContext(req)));
});

module.exports = {
  deleteServiceToken,
  getServiceAccounts,
  postServiceAccount,
  postServiceToken,
};
