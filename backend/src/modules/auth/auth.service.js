const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { Prisma } = require("../../generated/prisma");
const { env } = require("../../config/env");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const { createTokenPair, hashToken } = require("../../lib/tokens");
const { encryptSecret, decryptSecret } = require("../../lib/secret-box");
const {
  generateTotpSecret,
  verifyTotpCode,
  buildOtpAuthUrl,
} = require("../../lib/totp");
const { sendVerificationEmail } = require("../../lib/mail/sendVerificationEmail");
const { sendEmailChangeEmail } = require("../../lib/mail/sendEmailChangeEmail");
const { sendResetPasswordEmail } = require("../../lib/mail/sendResetPasswordEmail");
const { sendSecurityEventEmail } = require("../../lib/mail/sendSecurityEventEmail");
const {
  normalizeEmail,
  normalizeText,
  normalizeUsername,
  isNonEmptyString,
  isValidEmail,
  getSignupFieldErrors,
} = require("../../lib/validation");

const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_MINUTES = 15;
const LOGIN_CHALLENGE_MINUTES = 10;
const BACKUP_CODE_COUNT = 8;

const PUBLIC_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  username: true,
  phone: true,
  discordTag: true,
  role: true,
  pendingEmail: true,
  emailVerified: true,
  emailVerifiedAt: true,
  mfaEnabled: true,
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
  pendingEmail: user.pendingEmail || null,
  emailVerified: Boolean(user.emailVerified),
  emailVerifiedAt: user.emailVerifiedAt || null,
  mfaEnabled: Boolean(user.mfaEnabled),
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
  extraData = {},
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
      ...extraData,
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

const createChallengeRecord = async ({ userId, rememberMe }) => {
  const challengeToken = createTokenPair({ minutes: LOGIN_CHALLENGE_MINUTES });

  await prisma.$transaction(async (tx) => {
    await tx.loginChallenge.updateMany({
      where: {
        userId,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    await tx.loginChallenge.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        tokenHash: challengeToken.tokenHash,
        expiresAt: challengeToken.expiresAt,
        rememberMe: Boolean(rememberMe),
      },
    });
  });

  return challengeToken;
};

const getLoginChallenge = async ({ token }) => {
  const challenge = await prisma.loginChallenge.findFirst({
    where: {
      tokenHash: hashToken(token),
      usedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    include: {
      user: {
        select: {
          ...PUBLIC_USER_SELECT,
          emailNormalized: true,
          passwordHash: true,
          mfaCredential: true,
        },
      },
    },
  });

  if (!challenge) {
    throw new HttpError(400, "This verification challenge is invalid or has expired.");
  }

  return challenge;
};

const markLoginChallengeUsed = async ({ challengeId }) => {
  await prisma.loginChallenge.update({
    where: { id: challengeId },
    data: { usedAt: new Date() },
  });
};

const buildLoginChallengeResponse = (user, challengeToken) => ({
  requiresMfa: true,
  challengeToken: challengeToken.rawToken,
  challengeExpiresAt: challengeToken.expiresAt.toISOString(),
  user: {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    mfaEnabled: true,
  },
});

const generateBackupCodeValues = () =>
  Array.from({ length: BACKUP_CODE_COUNT }, () =>
    crypto.randomBytes(4).toString("hex").toUpperCase()
  );

const normalizeBackupCode = (code) =>
  String(code || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();

const hashBackupCode = (code) => hashToken(normalizeBackupCode(code));

const issueBackupCodes = async ({ tx, userId }) => {
  const codes = generateBackupCodeValues();

  await tx.backupCode.deleteMany({
    where: { userId },
  });

  await tx.backupCode.createMany({
    data: codes.map((code) => ({
      id: crypto.randomUUID(),
      userId,
      codeHash: hashBackupCode(code),
    })),
  });

  return codes;
};

const sendSecurityAlert = async ({
  user,
  subject,
  title,
  message,
  actionLabel,
  actionUrl,
  outro,
}) => {
  try {
    await sendSecurityEventEmail({
      email: user.email,
      firstName: user.firstName,
      subject,
      title,
      message,
      actionLabel,
      actionUrl,
      outro,
    });
  } catch (error) {
    logger.error("Failed to send security alert email.", {
      userId: user.id,
      email: user.email,
      subject,
      error,
    });
  }
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
      failedLoginCount: true,
      lockedUntil: true,
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

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    logger.warn("Blocked login for locked account", {
      ...requestMeta,
      emailOrUsername,
      userId: user.id,
      lockedUntil: user.lockedUntil,
    });
    throw new HttpError(
      429,
      "Too many failed login attempts. Please try again later."
    );
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    const failedLoginCount = (user.failedLoginCount || 0) + 1;
    const lockAccount = failedLoginCount >= LOGIN_LOCKOUT_THRESHOLD;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lastFailedLoginAt: new Date(),
        lockedUntil: lockAccount
          ? new Date(Date.now() + LOGIN_LOCKOUT_MINUTES * 60 * 1000)
          : null,
      },
    });

    logger.warn("Failed login attempt", {
      ...requestMeta,
      emailOrUsername,
      userId: user.id,
      reason: "invalid_password",
      failedLoginCount,
    });
    throw new HttpError(401, "Invalid credentials.");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lastFailedLoginAt: null,
      lockedUntil: null,
    },
  });

  if (user.mfaEnabled) {
    const challengeToken = await createChallengeRecord({
      userId: user.id,
      rememberMe: Boolean(body.remember),
    });

    return buildLoginChallengeResponse(user, challengeToken);
  }

  return {
    userId: user.id,
    rememberMe: Boolean(body.remember),
    user: mapUserForResponse(user),
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

const markUserLoginSucceeded = async ({ userId }) => {
  const lastLoginAt = new Date();
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      lastLoginAt,
      failedLoginCount: 0,
      lastFailedLoginAt: null,
      lockedUntil: null,
    },
    select: PUBLIC_USER_SELECT,
  });

  return mapUserForResponse(user);
};

const completeMfaLogin = async ({ body }) => {
  const challengeToken = normalizeText(body.challengeToken);
  const verificationCode = normalizeText(body.code);
  const backupCode = normalizeBackupCode(body.backupCode);

  if (!challengeToken || (!verificationCode && !backupCode)) {
    throw new HttpError(400, "A verification challenge and code are required.");
  }

  const challenge = await getLoginChallenge({ token: challengeToken });
  const credential = challenge.user.mfaCredential;

  if (!credential || !challenge.user.mfaEnabled) {
    throw new HttpError(400, "Multi-factor authentication is not enabled for this account.");
  }

  let usedRecoveryCode = false;

  if (backupCode) {
    const backupCodeRecord = await prisma.backupCode.findFirst({
      where: {
        userId: challenge.userId,
        codeHash: hashBackupCode(backupCode),
        usedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!backupCodeRecord) {
      throw new HttpError(400, "Invalid recovery code.");
    }

    await prisma.backupCode.update({
      where: { id: backupCodeRecord.id },
      data: { usedAt: new Date() },
    });
    usedRecoveryCode = true;
  } else {
    const secret = decryptSecret(credential.secretCiphertext);
    if (!verifyTotpCode(secret, verificationCode)) {
      throw new HttpError(400, "Invalid verification code.");
    }
  }

  await markLoginChallengeUsed({ challengeId: challenge.id });

  return {
    userId: challenge.userId,
    rememberMe: Boolean(challenge.rememberMe),
    user: mapUserForResponse(challenge.user),
    usedRecoveryCode,
  };
};

const beginMfaSetup = async ({ currentUser }) => {
  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      mfaEnabled: true,
    },
  });

  if (!user) {
    throw new HttpError(404, "User not found.");
  }

  if (user.mfaEnabled) {
    throw new HttpError(400, "Multi-factor authentication is already enabled.");
  }

  const secret = generateTotpSecret();

  await prisma.mfaCredential.upsert({
    where: { userId: currentUser.id },
    update: {
      secretCiphertext: encryptSecret(secret),
      enabledAt: null,
    },
    create: {
      id: crypto.randomUUID(),
      userId: currentUser.id,
      secretCiphertext: encryptSecret(secret),
      enabledAt: null,
    },
  });

  return {
      secret,
      otpauthUrl: buildOtpAuthUrl({
        secret,
        accountName: user.email,
        issuer: env.MFA_ISSUER,
      }),
    };
};

const confirmMfaSetup = async ({ currentUser, body }) => {
  const code = normalizeText(body.code);

  if (!code) {
    throw new HttpError(400, "Verification code is required.");
  }

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: {
      ...PUBLIC_USER_SELECT,
      mfaCredential: true,
    },
  });

  if (!user || !user.mfaCredential) {
    throw new HttpError(400, "Start MFA setup before confirming it.");
  }

  const secret = decryptSecret(user.mfaCredential.secretCiphertext);
  if (!verifyTotpCode(secret, code)) {
    throw new HttpError(400, "Invalid verification code.");
  }

  const enabledAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: currentUser.id },
      data: { mfaEnabled: true },
      select: PUBLIC_USER_SELECT,
    });

    await tx.mfaCredential.update({
      where: { userId: currentUser.id },
      data: {
        enabledAt,
      },
    });

    const backupCodes = await issueBackupCodes({
      tx,
      userId: currentUser.id,
    });

    return {
      user: updatedUser,
      backupCodes,
    };
  });

  await sendSecurityAlert({
    user: result.user,
    subject: "Quest Esports MFA enabled",
    title: "Multi-factor authentication enabled",
    message:
      "multi-factor authentication has been enabled on your Quest Esports account.",
    outro:
      "If you did not enable MFA, change your password immediately and contact support.",
  });

  return {
    user: mapUserForResponse(result.user),
    backupCodes: result.backupCodes,
  };
};

const verifyUserSecurityCheck = async ({
  currentUser,
  currentPassword,
  code,
  backupCode,
}) => {
  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: {
      ...PUBLIC_USER_SELECT,
      passwordHash: true,
      mfaCredential: true,
    },
  });

  if (!user) {
    throw new HttpError(404, "User not found.");
  }

  const passwordMatches = await bcrypt.compare(String(currentPassword || ""), user.passwordHash);
  if (!passwordMatches) {
    throw new HttpError(400, "Current password is incorrect.");
  }

  if (user.mfaEnabled) {
    if (!code && !backupCode) {
      throw new HttpError(400, "An authenticator code or backup code is required.");
    }

    if (backupCode) {
      const backupCodeRecord = await prisma.backupCode.findFirst({
        where: {
          userId: currentUser.id,
          codeHash: hashBackupCode(backupCode),
          usedAt: null,
        },
        select: { id: true },
      });

      if (!backupCodeRecord) {
        throw new HttpError(400, "Invalid backup code.");
      }

      await prisma.backupCode.update({
        where: { id: backupCodeRecord.id },
        data: { usedAt: new Date() },
      });
    } else {
      const secret = decryptSecret(user.mfaCredential?.secretCiphertext || "");
      if (!verifyTotpCode(secret, code)) {
        throw new HttpError(400, "Invalid verification code.");
      }
    }
  }

  return user;
};

const disableMfa = async ({ currentUser, body }) => {
  const currentPassword = String(body.currentPassword || "");
  const code = normalizeText(body.code);
  const backupCode = normalizeBackupCode(body.backupCode);
  const user = await verifyUserSecurityCheck({
    currentUser,
    currentPassword,
    code,
    backupCode,
  });

  if (!user.mfaEnabled) {
    throw new HttpError(400, "Multi-factor authentication is not enabled.");
  }

  const updatedUser = await prisma.$transaction(async (tx) => {
    await tx.backupCode.deleteMany({
      where: { userId: currentUser.id },
    });
    await tx.mfaCredential.deleteMany({
      where: { userId: currentUser.id },
    });
    await tx.loginChallenge.deleteMany({
      where: { userId: currentUser.id },
    });

    return tx.user.update({
      where: { id: currentUser.id },
      data: { mfaEnabled: false },
      select: PUBLIC_USER_SELECT,
    });
  });

  await sendSecurityAlert({
    user: updatedUser,
    subject: "Quest Esports MFA disabled",
    title: "Multi-factor authentication disabled",
    message:
      "multi-factor authentication has been removed from your Quest Esports account.",
  });

  return mapUserForResponse(updatedUser);
};

const regenerateBackupCodes = async ({ currentUser, body }) => {
  const currentPassword = String(body.currentPassword || "");
  const code = normalizeText(body.code);
  const backupCode = normalizeBackupCode(body.backupCode);
  const user = await verifyUserSecurityCheck({
    currentUser,
    currentPassword,
    code,
    backupCode,
  });

  if (!user.mfaEnabled) {
    throw new HttpError(400, "Enable multi-factor authentication first.");
  }

  const backupCodes = await prisma.$transaction((tx) =>
    issueBackupCodes({
      tx,
      userId: currentUser.id,
    })
  );

  await sendSecurityAlert({
    user,
    subject: "Quest Esports backup codes regenerated",
    title: "Backup codes regenerated",
    message:
      "your Quest Esports backup codes were regenerated. Your previous backup codes no longer work.",
  });

  return backupCodes;
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

const requestEmailChange = async ({ currentUser, body }) => {
  const newEmail = normalizeEmail(body.newEmail);
  const currentPassword = String(body.currentPassword || "");

  const fieldErrors = {};

  if (!isValidEmail(newEmail)) {
    fieldErrors.newEmail = "Please enter a valid email address.";
  }

  if (!currentPassword) {
    fieldErrors.currentPassword = "Current password is required.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors,
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: {
      ...PUBLIC_USER_SELECT,
      emailNormalized: true,
      pendingEmailNormalized: true,
      passwordHash: true,
    },
  });

  if (!user) {
    throw new HttpError(404, "User not found.");
  }

  const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!passwordMatches) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors: {
        currentPassword: "Current password is incorrect.",
      },
    });
  }

  if (newEmail === user.emailNormalized) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors: {
        newEmail: "That is already your current email address.",
      },
    });
  }

  const conflictingUser = await prisma.user.findFirst({
    where: {
      id: { not: currentUser.id },
      OR: [
        { emailNormalized: newEmail },
        { pendingEmailNormalized: newEmail },
      ],
    },
    select: { id: true },
  });

  if (conflictingUser) {
    throw new HttpError(400, "Please correct the highlighted fields.", {
      fieldErrors: {
        newEmail: "Email already exists.",
      },
    });
  }

  const emailChangeToken = createTokenPair({ hours: 24 });

  const updatedUser = await prisma.$transaction(async (tx) => {
    const nextUser = await tx.user.update({
      where: { id: currentUser.id },
      data: {
        pendingEmail: newEmail,
        pendingEmailNormalized: newEmail,
      },
      select: PUBLIC_USER_SELECT,
    });

    await issueUserToken({
      tx,
      model: "emailChangeToken",
      userId: currentUser.id,
      token: emailChangeToken,
      extraData: {
        nextEmail: newEmail,
        nextEmailNormalized: newEmail,
      },
    });

    return nextUser;
  });

  try {
    await sendEmailChangeEmail({
      email: newEmail,
      firstName: updatedUser.firstName,
      nextEmail: newEmail,
      rawToken: emailChangeToken.rawToken,
    });
  } catch (error) {
    logger.error("Failed to send email change confirmation.", {
      userId: updatedUser.id,
      email: newEmail,
      error,
    });
  }

  return mapUserForResponse(updatedUser);
};

const confirmEmailChange = async ({ token }) => {
  const tokenHash = hashToken(token);
  const now = new Date();

  const emailChangeRecord = await prisma.emailChangeToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: {
        gt: now,
      },
    },
    include: {
      user: {
        select: {
          ...PUBLIC_USER_SELECT,
          pendingEmailNormalized: true,
        },
      },
    },
  });

  if (!emailChangeRecord) {
    throw new HttpError(400, "This email change link is invalid or has expired.");
  }

  const emailVerifiedAt = new Date();

  try {
    const user = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: emailChangeRecord.userId },
        data: {
          email: emailChangeRecord.nextEmail,
          emailNormalized: emailChangeRecord.nextEmailNormalized,
          pendingEmail: null,
          pendingEmailNormalized: null,
          emailVerified: true,
          emailVerifiedAt,
        },
        select: PUBLIC_USER_SELECT,
      });

      await consumeUserToken({
        tx,
        model: "emailChangeToken",
        recordId: emailChangeRecord.id,
        userId: emailChangeRecord.userId,
        usedAt: emailVerifiedAt,
      });

      await markOutstandingTokensAsUsed({
        tx,
        model: "verificationToken",
        userId: emailChangeRecord.userId,
        usedAt: emailVerifiedAt,
      });

      await tx.session.deleteMany({
        where: {
          userId: emailChangeRecord.userId,
        },
      });

      return updatedUser;
    });

    await sendSecurityAlert({
      user,
      subject: "Quest Esports email address changed",
      title: "Email address changed",
      message:
        "the email address on your Quest Esports account was updated successfully.",
    });

    return mapUserForResponse(user);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new HttpError(
        400,
        "That email address is no longer available. Please request a new email change."
      );
    }

    throw error;
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

  const user = await prisma.user.findUnique({
    where: { id: resetRecord.userId },
    select: PUBLIC_USER_SELECT,
  });

  if (user) {
    await sendSecurityAlert({
      user,
      subject: "Quest Esports password reset completed",
      title: "Password reset completed",
      message:
        "your Quest Esports password was reset and all active sessions were signed out.",
    });
  }
};

const changePassword = async ({ currentUser, body, currentSessionId }) => {
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  const confirmNewPassword = String(body.confirmNewPassword || "");
  const verificationCode = normalizeText(body.code);
  const backupCode = normalizeBackupCode(body.backupCode);

  if (!currentPassword || !newPassword || !confirmNewPassword) {
    throw new HttpError(400, "Current password, new password, and confirmation are required.");
  }

  if (newPassword.length < 8) {
    throw new HttpError(400, "Password must be at least 8 characters long.");
  }

  if (newPassword !== confirmNewPassword) {
    throw new HttpError(400, "Confirm password must match.");
  }

  const user = await verifyUserSecurityCheck({
    currentUser,
    currentPassword,
    code: verificationCode,
    backupCode,
  });

  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw new HttpError(400, "Choose a new password that is different from your current password.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const updatedUser = await prisma.$transaction(async (tx) => {
    const nextUser = await tx.user.update({
      where: { id: currentUser.id },
      data: { passwordHash },
      select: PUBLIC_USER_SELECT,
    });

    await tx.session.deleteMany({
      where: {
        userId: currentUser.id,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
      },
    });

    return nextUser;
  });

  await sendSecurityAlert({
    user: updatedUser,
    subject: "Quest Esports password changed",
    title: "Password changed",
    message:
      "your Quest Esports password was changed and other active sessions were signed out.",
  });

  return mapUserForResponse(updatedUser);
};

module.exports = {
  PUBLIC_USER_SELECT,
  createSignup,
  authenticateUser,
  markUserLoginSucceeded,
  getUserProfile,
  updateUserProfile,
  completeMfaLogin,
  beginMfaSetup,
  confirmMfaSetup,
  disableMfa,
  regenerateBackupCodes,
  verifyEmailAddress,
  resendVerificationEmail,
  requestEmailChange,
  confirmEmailChange,
  requestPasswordReset,
  resetPassword,
  changePassword,
  mapUserForResponse,
  validateUserBasics,
};
