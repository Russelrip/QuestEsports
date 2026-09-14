import { adminNavigationGroups, adminRequest, type AdminNavigationLink } from "@/lib/admin";

// Areas of the admin panel that can be delegated to someone who is not an
// admin. Mirrors STAFF_PERMISSIONS in
// backend/src/modules/permissions/staff-permission.service.js — the backend is
// what actually enforces access; this only decides what to show.
export const STAFF_PERMISSIONS = {
  valorant_leaderboard: {
    label: "VALORANT leaderboard",
    description: "Search leaderboard registrations and remove players from the leaderboard.",
  },
} as const;

export type StaffPermission = keyof typeof STAFF_PERMISSIONS;

export const STAFF_PERMISSION_KEYS = Object.keys(STAFF_PERMISSIONS) as StaffPermission[];

type PermissionHolder = { role: string; permissions?: readonly string[] | null } | null | undefined;

const isAdmin = (user: PermissionHolder) => user?.role === "admin";

export const hasStaffPermission = (user: PermissionHolder, permission: StaffPermission) =>
  isAdmin(user) || Boolean(user?.permissions?.includes(permission));

// A navigation link without a permission is admin-only.
export const canSeeAdminLink = (user: PermissionHolder, link: AdminNavigationLink) =>
  isAdmin(user) || (link.permission ? hasStaffPermission(user, link.permission) : false);

const pathMatchesLink = (pathname: string, href: string) =>
  pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));

export const canOpenAdminPath = (user: PermissionHolder, pathname: string) => {
  if (isAdmin(user)) return true;
  return adminNavigationGroups.some((group) =>
    group.links.some((link) => canSeeAdminLink(user, link) && pathMatchesLink(pathname, link.href))
  );
};

// Where the admin panel starts for this user, or null when they have no area.
export const adminHomeFor = (user: PermissionHolder): string | null => {
  if (isAdmin(user)) return "/admin";
  for (const group of adminNavigationGroups) {
    const link = group.links.find((candidate) => canSeeAdminLink(user, candidate));
    if (link) return link.href;
  }
  return null;
};

export type UserStaffPermissions = {
  catalog: Array<{ key: StaffPermission; label: string; description: string }>;
  permissions: StaffPermission[];
};

export const fetchUserStaffPermissions = async (userId: string) =>
  (await adminRequest<{ data: UserStaffPermissions }>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/staff-permissions`
  )).data;

export const updateUserStaffPermissions = async (userId: string, permissions: StaffPermission[]) =>
  (await adminRequest<{ data: UserStaffPermissions }>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/staff-permissions`,
    { method: "PUT", json: { permissions } }
  )).data;
