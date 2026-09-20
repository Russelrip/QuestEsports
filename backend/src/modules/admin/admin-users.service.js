const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { buildPagination, buildPagedResponse } = require("../../lib/pagination");
const {
  normalizeEmail,
  normalizeText,
  normalizeUsername,
  isValidEmail,
  isPasswordWithinBcryptLimit,
} = require("../../lib/validation");
const { mapUserForResponse, validateUserBasics } = require("../auth/auth.service");
const { isSuperAdmin } = require("../permissions/staff-permission.service");
const { USER_ROLES, ADMIN_USER_SELECT } = require("./admin-shared");

const findUserIdentityConflict = ({ email, usernameNormalized, excludeUserId }) =>
  prisma.user.findFirst({
    where: {
      OR: [{ emailNormalized: email }, { usernameNormalized }],
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: {
      emailNormalized: true,
      usernameNormalized: true,
    },
  });

const listAdminUsers = async ({ page, pageSize, search, role }) => {
  const pagination = buildPagination({ page, pageSize });
  const normalizedSearch = normalizeText(search);
  const normalizedRole = normalizeText(role).toLowerCase();
  const where = normalizedSearch
    ? {
        OR: [
          { firstName: { contains: normalizedSearch, mode: "insensitive" } },
          { lastName: { contains: normalizedSearch, mode: "insensitive" } },
          { email: { contains: normalizedSearch, mode: "insensitive" } },
          { username: { contains: normalizedSearch, mode: "insensitive" } },
        ],
      }
    : {};

  if (USER_ROLES.has(normalizedRole)) {
    where.role = normalizedRole;
  } else if (normalizedRole === "staff") {
    // Not a role: users who are not admins but hold at least one staff role.
    where.role = "user";
    where.staffRoles = { some: {} };
  }

  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: {
        ...ADMIN_USER_SELECT,
        staffRoles: {
          orderBy: { role: { name: "asc" } },
          select: { role: { select: { id: true, name: true, color: true } } },
        },
      },
    }),
  ]);

  return buildPagedResponse({
    items: users.map((user) => ({
      ...mapUserForResponse(user),
      staffRoles: (user.staffRoles ?? []).map((holding) => holding.role),
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });
};

const getAdminUserById = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: ADMIN_USER_SELECT,
  });

  if (!user) {
    throw new HttpError(404, "User not found.");
  }

  return mapUserForResponse(user);
};

// Admin accounts can open every admin area, so making one, unmaking one, or
// changing another admin's email or password is reserved for super admins.
const SUPER_ADMIN_ONLY_MESSAGE = "Only a super admin can do this to an admin account.";

const createAdminUser = async ({ body, currentUser }) => {
  const firstName = normalizeText(body.firstName);
  const lastName = normalizeText(body.lastName);
  const email = normalizeEmail(body.email);
  const username = normalizeText(body.username);
  const usernameNormalized = normalizeUsername(username);
  const password = String(body.password || "");
  const confirmPassword = String(body.confirmPassword || "");
  const phone = normalizeText(body.phone) || null;
  const role = USER_ROLES.has(normalizeText(body.role).toLowerCase())
    ? normalizeText(body.role).toLowerCase()
    : "user";

  if (role === "admin" && !isSuperAdmin(currentUser)) {
    throw new HttpError(403, "Only a super admin can create an admin account.");
  }

  const fieldErrors = validateUserBasics({
    firstName,
    lastName,
    email,
    username,
  });
  if (phone && phone.length > 50) fieldErrors.phone = "Phone must be 50 characters or fewer.";

  if (!isValidEmail(email)) {
    fieldErrors.email = "Please enter a valid email address.";
  }

  if (!password) {
    fieldErrors.password = "Password is required.";
  } else if (password.length < 8) {
    fieldErrors.password = "Password must be at least 8 characters long.";
  } else if (!isPasswordWithinBcryptLimit(password)) {
    fieldErrors.password = "Password must be no more than 72 UTF-8 bytes.";
  }

  if (!confirmPassword) {
    fieldErrors.confirmPassword = "Please confirm the password.";
  } else if (password !== confirmPassword) {
    fieldErrors.confirmPassword = "Confirm password must match.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors,
    });
  }

  const existingUser = await findUserIdentityConflict({
    email,
    usernameNormalized,
  });

  if (existingUser) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors:
        existingUser.emailNormalized === email
          ? { email: "Email already exists." }
          : { username: "Username already exists." },
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const passwordSetAt = new Date();

  const user = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      firstName,
      lastName,
      email,
      emailNormalized: email,
      username,
      usernameNormalized,
      passwordHash,
      passwordSetAt,
      role,
      phone,
    },
    select: ADMIN_USER_SELECT,
  });

  return mapUserForResponse(user);
};

const updateAdminUser = async ({ userId, body, currentUser }) => {
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isSuperAdmin: true,
    },
  });

  if (!existingUser) {
    throw new HttpError(404, "User not found.");
  }

  const editingAnotherAdmin = existingUser.role === "admin" && currentUser?.id !== userId;
  if (editingAnotherAdmin && !isSuperAdmin(currentUser)) {
    throw new HttpError(403, SUPER_ADMIN_ONLY_MESSAGE);
  }

  const firstName = normalizeText(body.firstName);
  const lastName = normalizeText(body.lastName);
  const email = normalizeEmail(body.email);
  const username = normalizeText(body.username);
  const usernameNormalized = normalizeUsername(username);
  const phone = normalizeText(body.phone) || null;
  const password = String(body.password || "");
  const confirmPassword = String(body.confirmPassword || "");
  const role = USER_ROLES.has(normalizeText(body.role).toLowerCase())
    ? normalizeText(body.role).toLowerCase()
    : existingUser.role;

  if (role !== existingUser.role && !isSuperAdmin(currentUser)) {
    throw new HttpError(403, "Only a super admin can make someone an admin or remove admin access.");
  }

  const fieldErrors = validateUserBasics({
    firstName,
    lastName,
    email,
    username,
  });
  if (phone && phone.length > 50) fieldErrors.phone = "Phone must be 50 characters or fewer.";

  if (!isValidEmail(email)) {
    fieldErrors.email = "Please enter a valid email address.";
  }

  if (password) {
    if (password.length < 8) {
      fieldErrors.password = "Password must be at least 8 characters long.";
    } else if (!isPasswordWithinBcryptLimit(password)) {
      fieldErrors.password = "Password must be no more than 72 UTF-8 bytes.";
    }

    if (password !== confirmPassword) {
      fieldErrors.confirmPassword = "Confirm password must match.";
    }
  }

  if (currentUser.id === userId && role !== "admin") {
    fieldErrors.role = "You cannot remove your own admin access.";
  } else if (existingUser.isSuperAdmin && role !== "admin") {
    fieldErrors.role = "A super admin stays an admin. Remove super admin on the server first.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors,
    });
  }

  const conflictingUser = await findUserIdentityConflict({
    email,
    usernameNormalized,
    excludeUserId: userId,
  });

  if (conflictingUser) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors:
        conflictingUser.emailNormalized === email
          ? { email: "Email already exists." }
          : { username: "Username already exists." },
    });
  }

  let nextPasswordHash = null;
  let nextPasswordSetAt = null;
  if (password) {
    nextPasswordHash = await bcrypt.hash(password, 10);
    nextPasswordSetAt = new Date();
  }

  const user = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        firstName,
        lastName,
        email,
        emailNormalized: email,
        username,
        usernameNormalized,
        phone,
        // Not settable by an admin either. The tag is written by the OAuth link
        // and cleared by unlinking; an admin typing one here would produce a
        // handle that looks verified to every flow that now trusts it.
        role,
        ...(nextPasswordHash
          ? { passwordHash: nextPasswordHash, passwordSetAt: nextPasswordSetAt }
          : {}),
      },
      select: ADMIN_USER_SELECT,
    });

    if (nextPasswordHash) {
      await tx.session.deleteMany({
        where: {
          userId,
        },
      });
    }

    return updatedUser;
  });

  return mapUserForResponse(user);
};

const deleteAdminUser = async ({ userId, currentUser }) => {
  if (currentUser.id === userId) {
    throw new HttpError(400, "You cannot delete your own account.");
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isSuperAdmin: true },
  });
  if (target?.isSuperAdmin) {
    throw new HttpError(400, "A super admin cannot be deleted. Remove super admin on the server first.");
  }
  if (target?.role === "admin" && !isSuperAdmin(currentUser)) {
    throw new HttpError(403, SUPER_ADMIN_ONLY_MESSAGE);
  }

  const deleted = await prisma.user.deleteMany({
    where: { id: userId },
  });

  if (deleted.count === 0) {
    throw new HttpError(404, "User not found.");
  }
};

module.exports = {
  listAdminUsers,
  getAdminUserById,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
};
