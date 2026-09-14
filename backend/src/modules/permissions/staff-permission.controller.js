const { asyncHandler } = require("../../lib/async-handler");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const {
  listGrantedPermissions,
  listStaffPermissionCatalog,
  setUserStaffPermissions,
} = require("./staff-permission.service");

const respond = (res, data) =>
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });

const getUserStaffPermissions = asyncHandler(async (req, res) => {
  const permissions = await listGrantedPermissions(req.params.userId);
  respond(res, { catalog: listStaffPermissionCatalog(), permissions });
});

const updateUserStaffPermissions = asyncHandler(async (req, res) => {
  const result = await setUserStaffPermissions({
    userId: req.params.userId,
    permissions: req.body?.permissions,
    actorUserId: req.user.id,
  });
  if (result.added.length > 0 || result.removed.length > 0) {
    await recordAudit({
      ...requestAuditContext(req),
      action: "admin.user.staff_permissions.updated",
      targetType: "User",
      targetId: req.params.userId,
      beforeData: { permissions: result.before },
      afterData: { permissions: result.after, added: result.added, removed: result.removed },
      source: "admin",
    });
  }
  respond(res, { catalog: listStaffPermissionCatalog(), permissions: result.after });
});

module.exports = { getUserStaffPermissions, updateUserStaffPermissions };
