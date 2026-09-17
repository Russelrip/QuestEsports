import { adminNavigationGroups, adminRequest, type AdminNavigationLink } from "@/lib/admin";

// Areas of the admin panel a staff role can open, like the permission toggles on
// a Discord role. Mirrors STAFF_PERMISSIONS in
// backend/src/modules/permissions/staff-permission.service.js — the backend is
// what actually enforces access; this only decides what to show.
export const STAFF_PERMISSIONS = {
  tournaments: {
    group: "Competition",
    label: "Tournaments and events",
    description: "Create, edit and delete tournaments, events and event series, including sponsors, brackets and Challonge.",
  },
  registrations: {
    group: "Competition",
    label: "Registrations",
    description: "Review, approve, correct, export and delete team registrations.",
  },
  rulebooks: {
    group: "Competition",
    label: "Rulebooks",
    description: "Create, edit and delete rulebooks.",
  },
  games: {
    group: "Competition",
    label: "Games",
    description: "Manage game categories and their artwork.",
  },
  media: {
    group: "Content",
    label: "Media and posters",
    description: "Upload and delete images, manage posters, and manage event albums.",
  },
  teams: {
    group: "People",
    label: "Teams",
    description: "Edit saved teams, logos and organisation labels, transfer captains and delete teams.",
  },
  recruitment: {
    group: "People",
    label: "Recruitment",
    description: "Review, export and delete Join Quest applications.",
  },
  contact_messages: {
    group: "People",
    label: "Contact messages",
    description: "Read and delete messages sent through the contact form.",
  },
  tickets: {
    group: "Commerce",
    label: "Ticketing",
    description: "Manage ticket events, orders and attendees, and scan and check in tickets.",
  },
  shop: {
    group: "Commerce",
    label: "Shop",
    description: "Manage products, stock and product images, and fulfil orders.",
  },
  payments: {
    group: "Commerce",
    label: "Payments",
    description: "Review bank transfers and reconcile PayHere and cash payments.",
  },
  expenses: {
    group: "Commerce",
    label: "Expenses",
    description: "Record, edit and delete expenses.",
  },
  game_accounts: {
    group: "Game Operations",
    label: "Account changes",
    description: "Approve or reject players' game account change requests.",
  },
  valorant_leaderboard: {
    group: "Game Operations",
    label: "VALORANT leaderboard",
    description: "Search leaderboard registrations, remove and restore players, and review server checks.",
  },
} as const;

export type StaffPermission = keyof typeof STAFF_PERMISSIONS;

export const STAFF_PERMISSION_KEYS = Object.keys(STAFF_PERMISSIONS) as StaffPermission[];

type PermissionHolder = {
  role: string;
  isSuperAdmin?: boolean | null;
  permissions?: readonly string[] | null;
} | null | undefined;

const isAdmin = (user: PermissionHolder) => user?.role === "admin";

// The owner tier. Only a super admin can change roles, who holds them, or who is
// an admin; the backend refuses everyone else.
export const isSuperAdmin = (user: PermissionHolder) => isAdmin(user) && user?.isSuperAdmin === true;

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

// The catalog grouped the way the admin navigation is, for permission toggles.
export const staffPermissionGroups = () => {
  const groups = new Map<string, Array<{ key: StaffPermission; label: string; description: string }>>();
  for (const key of STAFF_PERMISSION_KEYS) {
    const { group, label, description } = STAFF_PERMISSIONS[key];
    groups.set(group, [...(groups.get(group) ?? []), { key, label, description }]);
  }
  return [...groups.entries()].map(([label, areas]) => ({ label, areas }));
};

export type StaffRole = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  permissions: StaffPermission[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type StaffRoleMember = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  role: "admin" | "user";
  assignedAt: string;
};

export type StaffRoleDetail = StaffRole & { members: StaffRoleMember[] };

export type StaffRoleInput = {
  name: string;
  description: string;
  color: string;
  permissions: StaffPermission[];
};

// Every role gets a colour for its chip; roles saved without one use this.
export const DEFAULT_ROLE_COLOR = "#99aab5";

export const ROLE_COLOR_SWATCHES = [
  "#5865f2", "#57f287", "#fee75c", "#eb459e", "#ed4245",
  "#f47b67", "#9b59b6", "#3498db", "#1abc9c", "#99aab5",
] as const;

const staffRolesPath = "/api/v1/admin/staff-roles";

export const fetchStaffRoles = async () =>
  (await adminRequest<{ data: { roles: StaffRole[] } }>(staffRolesPath)).data.roles;

export const fetchStaffRole = async (roleId: string) =>
  (await adminRequest<{ data: StaffRoleDetail }>(`${staffRolesPath}/${encodeURIComponent(roleId)}`)).data;

export const createStaffRole = async (input: StaffRoleInput) =>
  (await adminRequest<{ data: StaffRole }>(staffRolesPath, { method: "POST", json: input })).data;

export const updateStaffRole = async (roleId: string, input: StaffRoleInput) =>
  (await adminRequest<{ data: StaffRole }>(`${staffRolesPath}/${encodeURIComponent(roleId)}`, { method: "PATCH", json: input })).data;

export const deleteStaffRole = async (roleId: string) => {
  await adminRequest(`${staffRolesPath}/${encodeURIComponent(roleId)}`, { method: "DELETE" });
};

export const fetchUserStaffRoles = async (userId: string) =>
  (await adminRequest<{ data: { roles: StaffRole[] } }>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/staff-roles`
  )).data.roles;

export const updateUserStaffRoles = async (userId: string, roleIds: string[]) =>
  (await adminRequest<{ data: { roles: StaffRole[] } }>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/staff-roles`,
    { method: "PUT", json: { roleIds } }
  )).data.roles;
