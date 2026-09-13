const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");

// Areas of the admin panel that can be delegated to someone who is not an
// admin. `users.role = admin` still opens everything; a grant here opens one
// area and nothing else. Adding an area is an entry here, the matching value in
// the StaffPermission enum (schema + migration), and a route guarded with
// requireStaffPermission. The frontend mirrors this list in
// frontend/lib/staff-permissions.ts.
const STAFF_PERMISSIONS = Object.freeze({
  valorant_leaderboard: Object.freeze({
    label: "VALORANT leaderboard",
    description: "Search leaderboard registrations and remove players from the leaderboard.",
  }),
});

const STAFF_PERMISSION_KEYS = Object.freeze(Object.keys(STAFF_PERMISSIONS));

const isAdmin = (user) => user?.role === "admin";

const listStaffPermissionCatalog = () =>
  STAFF_PERMISSION_KEYS.map((key) => ({ key, ...STAFF_PERMISSIONS[key] }));

const listGrantedPermissions = async (userId) => {
  const rows = await prisma.userStaffPermission.findMany({
    where: { userId },
    select: { permission: true },
  });
  return rows.map((row) => row.permission).filter((key) => STAFF_PERMISSION_KEYS.includes(key));
};

// What the user can actually open: every area for an admin, their grants
// otherwise. This is what the session reports to the frontend.
const listEffectivePermissions = async (user) => {
  if (!user) return [];
  if (isAdmin(user)) return [...STAFF_PERMISSION_KEYS];
  return listGrantedPermissions(user.id);
};

const hasStaffPermission = async (user, permission) => {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const grant = await prisma.userStaffPermission.findUnique({
    where: { userId_permission: { userId: user.id, permission } },
    select: { id: true },
  });
  return Boolean(grant);
};

const normalizePermissionList = (value) => {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "permissions must be a list.");
  }
  const unknown = value.filter((key) => !STAFF_PERMISSION_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new HttpError(400, `Unknown staff permission: ${unknown.map(String).join(", ")}.`);
  }
  return [...new Set(value)];
};

// Replace a user's grants with exactly `permissions`. Returns before and after
// so the caller can audit the change.
const setUserStaffPermissions = async ({ userId, permissions, actorUserId }) => {
  const next = normalizePermissionList(permissions);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user) throw new HttpError(404, "User not found.");

  return prisma.$transaction(async (tx) => {
    const current = (await tx.userStaffPermission.findMany({
      where: { userId },
      select: { permission: true },
    })).map((row) => row.permission);

    const toRemove = current.filter((key) => !next.includes(key));
    const toAdd = next.filter((key) => !current.includes(key));

    if (toRemove.length > 0) {
      await tx.userStaffPermission.deleteMany({ where: { userId, permission: { in: toRemove } } });
    }
    if (toAdd.length > 0) {
      await tx.userStaffPermission.createMany({
        data: toAdd.map((permission) => ({
          id: crypto.randomUUID(),
          userId,
          permission,
          grantedByUserId: actorUserId || null,
        })),
        skipDuplicates: true,
      });
    }

    return {
      userRole: user.role,
      before: [...current].sort(),
      after: [...next].sort(),
      added: toAdd,
      removed: toRemove,
    };
  });
};

module.exports = {
  STAFF_PERMISSIONS,
  STAFF_PERMISSION_KEYS,
  hasStaffPermission,
  listEffectivePermissions,
  listGrantedPermissions,
  listStaffPermissionCatalog,
  setUserStaffPermissions,
};
