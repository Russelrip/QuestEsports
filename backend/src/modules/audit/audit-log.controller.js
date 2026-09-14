const { asyncHandler } = require("../../lib/async-handler");
const { listAuditLogFacets, listAuditLogs } = require("./audit-log.service");

const respond = (res, data) =>
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });

// Reading the audit log is not itself audited: it changes nothing, and a row
// per page view would bury the changes the log exists to show.
const getAuditLogs = asyncHandler(async (req, res) => {
  const result = await listAuditLogs(req.query);
  respond(res, { entries: result.items, pagination: result.pagination });
});

const getAuditLogFacets = asyncHandler(async (_req, res) => {
  respond(res, await listAuditLogFacets());
});

module.exports = { getAuditLogFacets, getAuditLogs };
