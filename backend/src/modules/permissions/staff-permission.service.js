const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");

// Areas of the admin panel that a staff role can open, like the permission
// toggles on a Discord role. `users.role = admin` still opens everything; a
// user who is not an admin opens the areas granted by any role they hold.
//
// Adding an area is an entry here, the same entry in
// frontend/lib/staff-permissions.ts, `requireStaffPermission("<key>")` on its
// routes, and `permission` on its navigation link. Role permissions are stored
// as text, so no migration is needed. Removing an entry revokes it everywhere:
// keys the catalog no longer knows are ignored on read.
//
// Deliberately not delegable, so absent here: the overview dashboard, users,
// staff roles, the audit log, the support queue, match and veto rooms (they run
// on tournament staff assignments), and VALORANT operations.
const STAFF_PERMISSIONS = Object.freeze({
  tournaments: Object.freeze({
    group: "Competition",
    label: "Tournaments and events",
    description: "Create, edit and delete tournaments, events and event series, including sponsors, brackets and Challonge.",
  }),
  registrations: Object.freeze({
    group: "Competition",
    label: "Registrations",
    description: "Review, approve, correct, export and delete team registrations.",
  }),
  rulebooks: Object.freeze({
    group: "Competition",
    label: "Rulebooks",
    description: "Create, edit and delete rulebooks.",
  }),
  games: Object.freeze({
    group: "Competition",
    label: "Games",
    description: "Manage game categories and their artwork.",
  }),
  media: Object.freeze({
    group: "Content",
    label: "Media and posters",
    description: "Upload and delete images, manage posters, and manage event albums.",
  }),
  teams: Object.freeze({
    group: "People",
    label: "Teams",
    description: "Edit saved teams, logos and organisation labels, transfer captains and delete teams.",
  }),
  recruitment: Object.freeze({
    group: "People",
    label: "Recruitment",
    description: "Review, export and delete Join Quest applications.",
  }),
  contact_messages: Object.freeze({
    group: "People",
    label: "Contact messages",
    description: "Read and delete messages sent through the contact form.",
  }),
  tickets: Object.freeze({
    group: "Commerce",
    label: "Ticketing",
    description: "Manage ticket events, orders and attendees, and scan and check in tickets.",
  }),
  shop: Object.freeze({
    group: "Commerce",
    label: "Shop",
    description: "Manage products, stock and product images, and fulfil orders.",
  }),
  payments: Object.freeze({
    group: "Commerce",
    label: "Payments",
    description: "Review bank transfers and reconcile PayHere and cash payments.",
  }),
  expenses: Object.freeze({
    group: "Commerce",
    label: "Expenses",
    description: "Record, edit and delete expenses.",
  }),
  game_accounts: Object.freeze({
    group: "Game Operations",
    label: "Account changes",
    description: "Approve or reject players' game account change requests.",
  }),
  valorant_leaderboard: Object.freeze({
    group: "Game Operations",
    label: "VALORANT leaderboard",
    description: "Search leaderboard registrations, remove and restore players, and review server checks.",
  }),
});

const STAFF_PERMISSION_KEYS = Object.freeze(Object.keys(STAFF_PERMISSIONS));

const ROLE_NAME_MAX_LENGTH = 40;
const ROLE_DESCRIPTION_MAX_LENGTH = 200;
const ROLE_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

const isAdmin = (user) => user?.role === "admin";

// Super admin is only meaningful on an admin; the database refuses the flag on
// anyone else, and this refuses to trust it there either.
const isSuperAdmin = (user) => isAdmin(user) && user?.isSuperAdmin === true;

const listStaffPermissionCatalog = () =>
  STAFF_PERMISSION_KEYS.map((key) => ({ key, ...STAFF_PERMISSIONS[key] }));

// Catalog order, known keys only, no duplicates.
const knownPermissions = (keys) => STAFF_PERMISSION_KEYS.filter((key) => (keys ?? []).includes(key));

const listRolePermissionsForUser = async (userId) => {
  const holdings = await prisma.userStaffRole.findMany({
    where: { userId },
    select: { role: { select: { permissions: true } } },
  });
  return knownPermissions(holdings.flatMap((holding) => holding.role?.permissions ?? []));
};

// What the user can actually open: every area for an admin, the union of their
// roles otherwise. This is what the session reports to the frontend.
const listEffectivePermissions = async (user) => {
  if (!user) return [];
  if (isAdmin(user)) return [...STAFF_PERMISSION_KEYS];
  return listRolePermissionsForUser(user.id);
};

// True when the user can open at least one of `permissions`.
const hasStaffPermission = async (user, ...permissions) => {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const holding = await prisma.userStaffRole.findFirst({
    where: { userId: user.id, role: { permissions: { hasSome: permissions.flat() } } },
    select: { id: true },
  });
  return Boolean(holding);
};

const normalizePermissionList = (value) => {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "permissions must be a list.");
  }
  const unknown = value.filter((key) => !STAFF_PERMISSION_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new HttpError(400, `Unknown staff permission: ${unknown.map(String).join(", ")}.`);
  }
  return knownPermissions(value);
};

const normalizeRoleInput = (body = {}) => {
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const color = typeof body.color === "string" ? body.color.trim().toLowerCase() : "";
  const fieldErrors = {};

  if (!name) fieldErrors.name = "Role name is required.";
  else if (name.length > ROLE_NAME_MAX_LENGTH) fieldErrors.name = `Role name must be ${ROLE_NAME_MAX_LENGTH} characters or fewer.`;
  if (description.length > ROLE_DESCRIPTION_MAX_LENGTH) {
    fieldErrors.description = `Description must be ${ROLE_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }
  if (color && !ROLE_COLOR_PATTERN.test(color)) fieldErrors.color = "Colour must be a hex value like #5865f2.";

  if (Object.keys(fieldErrors).length > 0) {
    throw new HttpError(400, "Please correct the highlighted fields.", { fieldErrors });
  }

  return {
    name,
    description: description || null,
    color: color || null,
    permissions: normalizePermissionList(body.permissions ?? []),
  };
};

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  color: true,
  permissions: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: true } },
};

const mapRole = (role) => ({
  id: role.id,
  name: role.name,
  description: role.description ?? null,
  color: role.color ?? null,
  permissions: knownPermissions(role.permissions),
  memberCount: role._count?.members ?? 0,
  createdAt: role.createdAt,
  updatedAt: role.updatedAt,
});

const assertRoleNameAvailable = async (name, excludeRoleId) => {
  const clash = await prisma.staffRole.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(excludeRoleId ? { id: { not: excludeRoleId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw new HttpError(409, "A role with that name already exists.", {
      fieldErrors: { name: "A role with that name already exists." },
    });
  }
};

const listStaffRoles = async () => {
  const roles = await prisma.staffRole.findMany({ orderBy: { name: "asc" }, select: ROLE_SELECT });
  return roles.map(mapRole);
};

const getStaffRole = async (roleId) => {
  const role = await prisma.staffRole.findUnique({
    where: { id: roleId },
    select: {
      ...ROLE_SELECT,
      members: {
        orderBy: { createdAt: "asc" },
        select: {
          createdAt: true,
          user: { select: { id: true, username: true, firstName: true, lastName: true, role: true } },
        },
      },
    },
  });
  if (!role) throw new HttpError(404, "Role not found.");
  return {
    ...mapRole(role),
    members: role.members.map((member) => ({ ...member.user, assignedAt: member.createdAt })),
  };
};

const createStaffRole = async ({ body, actorUserId }) => {
  const input = normalizeRoleInput(body);
  await assertRoleNameAvailable(input.name);
  const role = await prisma.staffRole.create({
    data: { id: crypto.randomUUID(), ...input, createdByUserId: actorUserId || null },
    select: ROLE_SELECT,
  });
  return mapRole(role);
};

// Returns before and after so the caller can audit the change.
const updateStaffRole = async ({ roleId, body }) => {
  const existing = await prisma.staffRole.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
  if (!existing) throw new HttpError(404, "Role not found.");
  const input = normalizeRoleInput(body);
  await assertRoleNameAvailable(input.name, roleId);
  const role = await prisma.staffRole.update({ where: { id: roleId }, data: input, select: ROLE_SELECT });
  return { before: mapRole(existing), after: mapRole(role) };
};

const deleteStaffRole = async (roleId) => {
  const existing = await prisma.staffRole.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
  if (!existing) throw new HttpError(404, "Role not found.");
  await prisma.staffRole.delete({ where: { id: roleId } });
  return mapRole(existing);
};

const listUserStaffRoles = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new HttpError(404, "User not found.");
  const holdings = await prisma.userStaffRole.findMany({
    where: { userId },
    orderBy: { role: { name: "asc" } },
    select: { role: { select: ROLE_SELECT } },
  });
  return holdings.map((holding) => mapRole(holding.role));
};

// Replace the roles a user holds with exactly `roleIds`. Returns before and
// after (as role summaries) so the caller can audit the change.
const setUserStaffRoles = async ({ userId, roleIds, actorUserId }) => {
  if (!Array.isArray(roleIds) || roleIds.some((id) => typeof id !== "string" || !id)) {
    throw new HttpError(400, "roleIds must be a list of role ids.");
  }
  const next = [...new Set(roleIds)];
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new HttpError(404, "User not found.");

  const roles = next.length > 0
    ? await prisma.staffRole.findMany({ where: { id: { in: next } }, select: { id: true, name: true } })
    : [];
  if (roles.length !== next.length) throw new HttpError(400, "One or more roles no longer exist.");
  const nameOf = new Map(roles.map((role) => [role.id, role.name]));

  return prisma.$transaction(async (tx) => {
    const current = await tx.userStaffRole.findMany({
      where: { userId },
      select: { roleId: true, role: { select: { name: true } } },
    });
    for (const holding of current) nameOf.set(holding.roleId, holding.role?.name ?? holding.roleId);
    const currentIds = current.map((holding) => holding.roleId);

    const toRemove = currentIds.filter((id) => !next.includes(id));
    const toAdd = next.filter((id) => !currentIds.includes(id));

    if (toRemove.length > 0) {
      await tx.userStaffRole.deleteMany({ where: { userId, roleId: { in: toRemove } } });
    }
    if (toAdd.length > 0) {
      await tx.userStaffRole.createMany({
        data: toAdd.map((roleId) => ({
          id: crypto.randomUUID(),
          userId,
          roleId,
          grantedByUserId: actorUserId || null,
        })),
        skipDuplicates: true,
      });
    }

    const names = (ids) => ids.map((id) => nameOf.get(id)).sort();
    return {
      before: names(currentIds),
      after: names(next),
      added: names(toAdd),
      removed: names(toRemove),
    };
  });
};

module.exports = {
  STAFF_PERMISSIONS,
  STAFF_PERMISSION_KEYS,
  isAdmin,
  isSuperAdmin,
  hasStaffPermission,
  listEffectivePermissions,
  listStaffPermissionCatalog,
  listStaffRoles,
  getStaffRole,
  createStaffRole,
  updateStaffRole,
  deleteStaffRole,
  listUserStaffRoles,
  setUserStaffRoles,
};
