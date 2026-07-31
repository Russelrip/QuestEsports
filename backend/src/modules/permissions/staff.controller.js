const { asyncHandler } = require("../../lib/async-handler");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const {
  listTournamentStaff,
  assignTournamentStaff,
  removeTournamentStaff,
} = require("./staff.service");

const listStaff = asyncHandler(async (req, res) => {
  const data = await listTournamentStaff(req.params.id);
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });
});

const assignStaff = asyncHandler(async (req, res) => {
  const data = await assignTournamentStaff({ tournamentId: req.params.id, body: req.body });
  await recordAudit({
    ...requestAuditContext(req),
    action: "tournament.staff.assigned",
    targetType: "TournamentStaffAssignment",
    targetId: data.id,
    afterData: data,
  });
  res.status(201).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });
});

const removeStaff = asyncHandler(async (req, res) => {
  await removeTournamentStaff({ tournamentId: req.params.id, assignmentId: req.params.assignmentId });
  await recordAudit({
    ...requestAuditContext(req),
    action: "tournament.staff.removed",
    targetType: "TournamentStaffAssignment",
    targetId: req.params.assignmentId,
  });
  res.status(200).json({ success: true, data: { removed: true }, meta: { serverNow: new Date().toISOString() } });
});

module.exports = { listStaff, assignStaff, removeStaff };
