const { asyncHandler } = require("../../lib/async-handler");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const {
  createStaffRole,
  deleteStaffRole,
  getStaffRole,
  listStaffPermissionCatalog,
  listStaffRoles,
  listUserStaffRoles,
  setUserStaffRoles,
  updateStaffRole,
} = require("./staff-permission.service");

const respond = (res, data, status = 200) =>
  res.status(status).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });

const auditedRole = (role) => ({
  name: role.name,
  description: role.description,
  color: role.color,
  permissions: role.permissions,
});

const getStaffRoles = asyncHandler(async (req, res) => {
  respond(res, { catalog: listStaffPermissionCatalog(), roles: await listStaffRoles() });
});

const getStaffRoleDetail = asyncHandler(async (req, res) => {
  respond(res, await getStaffRole(req.params.roleId));
});

const postStaffRole = asyncHandler(async (req, res) => {
  const role = await createStaffRole({ body: req.body, actorUserId: req.user.id });
  await recordAudit({
    ...requestAuditContext(req),
    action: "admin.staff_role.created",
    targetType: "StaffRole",
    targetId: role.id,
    afterData: auditedRole(role),
    source: "admin",
  });
  respond(res, role, 201);
});

const patchStaffRole = asyncHandler(async (req, res) => {
  const { before, after } = await updateStaffRole({ roleId: req.params.roleId, body: req.body });
  await recordAudit({
    ...requestAuditContext(req),
    action: "admin.staff_role.updated",
    targetType: "StaffRole",
    targetId: after.id,
    beforeData: auditedRole(before),
    afterData: auditedRole(after),
    source: "admin",
  });
  respond(res, after);
});

const removeStaffRole = asyncHandler(async (req, res) => {
  const role = await deleteStaffRole(req.params.roleId);
  await recordAudit({
    ...requestAuditContext(req),
    action: "admin.staff_role.deleted",
    targetType: "StaffRole",
    targetId: role.id,
    beforeData: { ...auditedRole(role), memberCount: role.memberCount },
    source: "admin",
  });
  respond(res, { removed: true });
});

const getUserStaffRoles = asyncHandler(async (req, res) => {
  respond(res, { roles: await listUserStaffRoles(req.params.userId) });
});

const updateUserStaffRoles = asyncHandler(async (req, res) => {
  const result = await setUserStaffRoles({
    userId: req.params.userId,
    roleIds: req.body?.roleIds,
    actorUserId: req.user.id,
  });
  if (result.added.length > 0 || result.removed.length > 0) {
    await recordAudit({
      ...requestAuditContext(req),
      action: "admin.user.staff_roles.updated",
      targetType: "User",
      targetId: req.params.userId,
      beforeData: { roles: result.before },
      afterData: { roles: result.after, added: result.added, removed: result.removed },
      source: "admin",
    });
  }
  respond(res, { roles: await listUserStaffRoles(req.params.userId) });
});

module.exports = {
  getStaffRoles,
  getStaffRoleDetail,
  postStaffRole,
  patchStaffRole,
  removeStaffRole,
  getUserStaffRoles,
  updateUserStaffRoles,
};
