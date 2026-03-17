const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const {
  normalizeEmail,
  normalizeText,
  normalizeUsername,
  isNonEmptyString,
  getSignupFieldErrors,
} = require("../../lib/validation");

const mapUserForResponse = (user) => ({
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  username: user.username,
  phone: user.phone,
  discordTag: user.discordTag,
  role: user.role,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
});

const createSignup = async ({ body, adminEmails }) => {
  const firstName = normalizeText(body.firstName);
  const lastName = normalizeText(body.lastName);
  const email = normalizeEmail(body.email);
  const username = normalizeText(body.username);
  const usernameNormalized = normalizeUsername(body.username);
  const password = String(body.password || "");
  const confirmPassword = String(body.confirmPassword || "");
  const terms = body.terms === true;
  const phone = normalizeText(body.phone) || null;
  const discordTag = normalizeText(body.discordTag) || null;
  const role = adminEmails.includes(email) ? "admin" : "user";

  const fieldErrors = getSignupFieldErrors({
    firstName,
    lastName,
    email,
    username,
    password,
    confirmPassword,
    terms,
  });

  if (Object.keys(fieldErrors).length > 0) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors,
    });
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ emailNormalized: email }, { usernameNormalized }],
    },
    select: {
      emailNormalized: true,
    },
  });

  if (existingUser) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors: existingUser.emailNormalized === email
        ? { email: "Email already exists." }
        : { username: "Username already exists." },
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      firstName,
      lastName,
      email,
      emailNormalized: email,
      username,
      usernameNormalized,
      passwordHash,
      role,
      phone,
      discordTag,
    },
  });
};

const authenticateUser = async ({ body }) => {
  const emailOrUsername = normalizeText(body.emailOrUsername);
  const password = String(body.password || "");

  if (!emailOrUsername || !password) {
    throw new HttpError(400, "Email/username and password are required.");
  }

  const normalizedLookup = normalizeUsername(emailOrUsername);
  const normalizedEmail = normalizeEmail(emailOrUsername);

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { emailNormalized: normalizedEmail },
        { usernameNormalized: normalizedLookup },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      username: true,
      phone: true,
      discordTag: true,
      role: true,
      lastLoginAt: true,
      passwordHash: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new HttpError(401, "Invalid credentials.");
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new HttpError(401, "Invalid credentials.");
  }

  const lastLoginAt = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt },
  });

  return {
    userId: user.id,
    rememberMe: Boolean(body.remember),
    user: mapUserForResponse({
      ...user,
      lastLoginAt: lastLoginAt.toISOString(),
    }),
  };
};

const getUserProfile = async ({ requestedUserId, currentUser }) => {
  if (currentUser.id !== requestedUserId && currentUser.role !== "admin") {
    throw new HttpError(403, "You do not have permission to view this profile.");
  }

  const user = await prisma.user.findUnique({
    where: { id: requestedUserId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      username: true,
      phone: true,
      discordTag: true,
      role: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new HttpError(404, "User not found.");
  }

  return mapUserForResponse(user);
};

const updateUserProfile = async ({ requestedUserId, currentUser, body }) => {
  if (currentUser.id !== requestedUserId && currentUser.role !== "admin") {
    throw new HttpError(
      403,
      "You do not have permission to update this profile."
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: requestedUserId },
    select: { id: true },
  });

  if (!existingUser) {
    throw new HttpError(404, "User not found.");
  }

  const firstName = normalizeText(body.firstName);
  const lastName = normalizeText(body.lastName);
  const username = normalizeText(body.username);
  const usernameNormalized = normalizeUsername(username);
  const phone = normalizeText(body.phone) || null;
  const discordTag = normalizeText(body.discordTag) || null;

  if (
    !isNonEmptyString(firstName) ||
    !isNonEmptyString(lastName) ||
    !isNonEmptyString(username)
  ) {
    throw new HttpError(400, "First name, last name, and username are required.");
  }

  const conflictingUser = await prisma.user.findFirst({
    where: {
      usernameNormalized,
      id: { not: requestedUserId },
    },
    select: { id: true },
  });

  if (conflictingUser) {
    throw new HttpError(400, "Username already exists.");
  }

  const user = await prisma.user.update({
    where: { id: requestedUserId },
    data: {
      firstName,
      lastName,
      username,
      usernameNormalized,
      phone,
      discordTag,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      username: true,
      phone: true,
      discordTag: true,
      role: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  return mapUserForResponse(user);
};

const getAdminDashboardData = async () => {
  const [totalUsers, totalAdmins, totalContacts, totalTeamRegistrations, users] =
    await prisma.$transaction([
      prisma.user.count(),
      prisma.user.count({ where: { role: "admin" } }),
      prisma.contactSubmission.count(),
      prisma.teamRegistration.count(),
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          username: true,
          role: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
    ]);

  return {
    stats: {
      totalUsers,
      totalAdmins,
      totalContacts,
      totalTeamRegistrations,
    },
    users: users.map(mapUserForResponse),
  };
};

module.exports = {
  createSignup,
  authenticateUser,
  getUserProfile,
  updateUserProfile,
  getAdminDashboardData,
  mapUserForResponse,
};
