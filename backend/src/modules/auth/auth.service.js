const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { createTokenPair, hashToken } = require("../../lib/tokens");
const { sendVerificationEmail } = require("../../lib/mail/sendVerificationEmail");
const { sendResetPasswordEmail } = require("../../lib/mail/sendResetPasswordEmail");
const {
  normalizeEmail,
  normalizeText,
  normalizeUsername,
  isNonEmptyString,
  isValidEmail,
  getSignupFieldErrors,
} = require("../../lib/validation");

const PUBLIC_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  username: true,
  phone: true,
  discordTag: true,
  role: true,
  emailVerified: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
};

const mapUserForResponse = (user) => ({
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  username: user.username,
  phone: user.phone,
  discordTag: user.discordTag,
  role: user.role,
  emailVerified: Boolean(user.emailVerified),
  emailVerifiedAt: user.emailVerifiedAt || null,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
});

const markOutstandingTokensAsUsed = async ({
  tx,
  model,
  userId,
  excludeId,
  usedAt = new Date(),
}) => {
  await tx[model].updateMany({
    where: {
      userId,
      usedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    data: {
      usedAt,
    },
  });

  return usedAt;
};

const issueUserToken = async ({
  tx,
  model,
  userId,
  token,
}) => {
  await markOutstandingTokensAsUsed({
    tx,
    model,
    userId,
  });

  return tx[model].create({
    data: {
      id: crypto.randomUUID(),
      userId,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
    },
  });
};

const consumeUserToken = async ({
  tx,
  model,
  recordId,
  userId,
  usedAt = new Date(),
}) => {
  await tx[model].update({
    where: { id: recordId },
    data: { usedAt },
  });

  await markOutstandingTokensAsUsed({
    tx,
    model,
    userId,
    excludeId: recordId,
    usedAt,
  });

  return usedAt;
};

const validateUserBasics = ({
  firstName,
  lastName,
  email,
  username,
}) => {
  const fieldErrors = {};

  if (!isNonEmptyString(firstName)) {
    fieldErrors.firstName = "First name is required.";
  }

  if (!isNonEmptyString(lastName)) {
    fieldErrors.lastName = "Last name is required.";
  }

  if (!isNonEmptyString(username)) {
    fieldErrors.username = "Username is required.";
  }

  if (!normalizeEmail(email)) {
    fieldErrors.email = "Email is required.";
  }

  return fieldErrors;
};

const createSignup = async ({ body }) => {
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
  const verificationToken = createTokenPair({ hours: 24 });

  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        id: crypto.randomUUID(),
        firstName,
        lastName,
        email,
        emailNormalized: email,
        username,
        usernameNormalized,
        passwordHash,
        role: "user",
        phone,
        discordTag,
        emailVerified: false,
      },
      select: PUBLIC_USER_SELECT,
    });

    await issueUserToken({
      tx,
      model: "verificationToken",
      userId: createdUser.id,
      token: verificationToken,
    });

    return createdUser;
  });

  try {
    await sendVerificationEmail({
      email: user.email,
      firstName: user.firstName,
      rawToken: verificationToken.rawToken,
    });
  } catch (error) {
    logger.error("Failed to send verification email after signup.", {
      userId: user.id,
      email: user.email,
      error,
    });
  }

  return mapUserForResponse(user);
};

const authenticateUser = async ({ body, requestMeta = {} }) => {
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
      ...PUBLIC_USER_SELECT,
      passwordHash: true,
    },
  });

  if (!user) {
    logger.warn("Failed login attempt", {
      ...requestMeta,
      emailOrUsername,
      reason: "user_not_found",
    });
    throw new HttpError(401, "Invalid credentials.");
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    logger.warn("Failed login attempt", {
      ...requestMeta,
      emailOrUsername,
      userId: user.id,
      reason: "invalid_password",
    });
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
    select: PUBLIC_USER_SELECT,
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
    select: PUBLIC_USER_SELECT,
  });

  return mapUserForResponse(user);
};

const verifyEmailAddress = async ({ token }) => {
  const tokenHash = hashToken(token);
  const now = new Date();

  const verificationRecord = await prisma.verificationToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: {
        gt: now,
      },
    },
    include: {
      user: {
        select: PUBLIC_USER_SELECT,
      },
    },
  });

  if (!verificationRecord) {
    throw new HttpError(400, "This verification link is invalid or has expired.");
  }

  const emailVerifiedAt = new Date();

  const user = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: verificationRecord.userId },
      data: {
        emailVerified: true,
        emailVerifiedAt,
      },
      select: PUBLIC_USER_SELECT,
    });

    await consumeUserToken({
      tx,
      model: "verificationToken",
      recordId: verificationRecord.id,
      userId: verificationRecord.userId,
      usedAt: emailVerifiedAt,
    });

    return updatedUser;
  });

  return mapUserForResponse(user);
};

const resendVerificationEmail = async ({ body }) => {
  const email = normalizeEmail(body.email);

  if (!isValidEmail(email)) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { emailNormalized: email },
    select: PUBLIC_USER_SELECT,
  });

  if (!user || user.emailVerified) {
    return;
  }

  const verificationToken = createTokenPair({ hours: 24 });

  await prisma.$transaction(async (tx) => {
    await issueUserToken({
      tx,
      model: "verificationToken",
      userId: user.id,
      token: verificationToken,
    });
  });

  try {
    await sendVerificationEmail({
      email: user.email,
      firstName: user.firstName,
      rawToken: verificationToken.rawToken,
    });
  } catch (error) {
    logger.error("Failed to resend verification email.", {
      userId: user.id,
      email: user.email,
      error,
    });
  }
};

const requestPasswordReset = async ({ body }) => {
  const email = normalizeEmail(body.email);

  if (!isValidEmail(email)) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { emailNormalized: email },
    select: PUBLIC_USER_SELECT,
  });

  if (!user) {
    return;
  }

  const resetToken = createTokenPair({ minutes: 20 });

  await prisma.$transaction(async (tx) => {
    await issueUserToken({
      tx,
      model: "passwordResetToken",
      userId: user.id,
      token: resetToken,
    });
  });

  try {
    await sendResetPasswordEmail({
      email: user.email,
      firstName: user.firstName,
      rawToken: resetToken.rawToken,
    });
  } catch (error) {
    logger.error("Failed to send password reset email.", {
      userId: user.id,
      email: user.email,
      error,
    });
  }
};

const resetPassword = async ({ body }) => {
  const token = normalizeText(body.token);
  const newPassword = String(body.newPassword || "");

  if (!token || !newPassword) {
    throw new HttpError(400, "Token and new password are required.");
  }

  if (newPassword.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters long.");
  }

  const resetRecord = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash: hashToken(token),
      usedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!resetRecord) {
    throw new HttpError(400, "This password reset link is invalid or has expired.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const usedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: resetRecord.userId },
      data: { passwordHash },
    });

    await consumeUserToken({
      tx,
      model: "passwordResetToken",
      recordId: resetRecord.id,
      userId: resetRecord.userId,
      usedAt,
    });

    await tx.session.deleteMany({
      where: {
        userId: resetRecord.userId,
      },
    });
  });
};

module.exports = {
  PUBLIC_USER_SELECT,
  createSignup,
  authenticateUser,
  getUserProfile,
  updateUserProfile,
  verifyEmailAddress,
  resendVerificationEmail,
  requestPasswordReset,
  resetPassword,
  mapUserForResponse,
  validateUserBasics,
};
