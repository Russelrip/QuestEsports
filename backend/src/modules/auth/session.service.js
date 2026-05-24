const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { env } = require("../../config/env");
const { PUBLIC_USER_SELECT } = require("./auth.service");

const SESSION_COOKIE_NAME = env.SESSION_COOKIE_NAME;

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const mapUserForSession = (record) => ({
  id: record.userId,
  firstName: record.firstName,
  lastName: record.lastName,
  email: record.email,
  username: record.username,
  phone: record.phone,
  discordTag: record.discordTag,
  role: record.role,
  pendingEmail: record.pendingEmail || null,
  emailVerified: Boolean(record.emailVerified),
  emailVerifiedAt: record.emailVerifiedAt || null,
  mfaEnabled: Boolean(record.mfaEnabled),
  lastLoginAt: record.lastLoginAt,
  createdAt: record.createdAt,
});

const parseCookies = (cookieHeader = "") =>
  cookieHeader.split(";").reduce((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) {
      return cookies;
    }

    cookies[rawName] = decodeURIComponent(rawValue.join("=") || "");
    return cookies;
  }, {});

const getSessionDurationMs = (rememberMe) =>
  (rememberMe
    ? env.REMEMBER_ME_SESSION_TTL_DAYS
    : env.SESSION_TTL_DAYS) *
  24 *
  60 *
  60 *
  1000;

const buildCookieValue = (token, expiresAt) => {
  const segments = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];

  if (env.NODE_ENV === "production") {
    segments.push("Secure");
  }

  return segments.join("; ");
};

const buildExpiredCookieValue = () => {
  const segments = [
    `${SESSION_COOKIE_NAME}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];

  if (env.NODE_ENV === "production") {
    segments.push("Secure");
  }

  return segments.join("; ");
};

const createSession = async ({
  userId,
  rememberMe,
  userAgent = null,
  ipAddress = null,
}) => {
  const token = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + getSessionDurationMs(rememberMe)
  ).toISOString();

  const session = await prisma.session.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      tokenHash,
      expiresAt: new Date(expiresAt),
      lastSeenAt: new Date(),
      userAgent,
      ipAddress,
      rememberMe: Boolean(rememberMe),
    },
  });

  return { token, expiresAt, sessionId: session.id };
};

const deleteSessionByToken = async (token) => {
  if (!token) {
    return;
  }

  await prisma.session.deleteMany({
    where: {
      tokenHash: hashToken(token),
    },
  });
};

const deleteExpiredSessions = async () => {
  await prisma.session.deleteMany({
    where: {
      expiresAt: {
        lte: new Date(),
      },
    },
  });
};

const mapSessionSummary = (session, currentSessionId = null) => ({
  id: session.id,
  createdAt: session.createdAt,
  lastSeenAt: session.lastSeenAt,
  expiresAt: session.expiresAt,
  userAgent: session.userAgent,
  ipAddress: session.ipAddress,
  rememberMe: Boolean(session.rememberMe),
  isCurrent: session.id === currentSessionId,
});

const getSessionFromRequest = async (req) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE_NAME];

  if (!token) {
    return null;
  }

  await deleteExpiredSessions();

  const session = await prisma.session.findUnique({
    where: {
      tokenHash: hashToken(token),
    },
    select: {
      id: true,
      expiresAt: true,
      createdAt: true,
      lastSeenAt: true,
      userAgent: true,
      ipAddress: true,
      rememberMe: true,
      user: {
        select: PUBLIC_USER_SELECT,
      },
    },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await deleteSessionByToken(token);
    return null;
  }

  await prisma.session.update({
    where: {
      id: session.id,
    },
    data: {
      lastSeenAt: new Date(),
    },
  });

  return {
    token,
    sessionId: session.id,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
    rememberMe: Boolean(session.rememberMe),
    user: mapUserForSession({
      userId: session.user.id,
      ...session.user,
    }),
  };
};

const listUserSessions = async ({ userId, currentSessionId = null }) => {
  await deleteExpiredSessions();

  const sessions = await prisma.session.findMany({
    where: { userId },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      userAgent: true,
      ipAddress: true,
      rememberMe: true,
    },
  });

  return sessions.map((session) => mapSessionSummary(session, currentSessionId));
};

const deleteSessionById = async ({ userId, sessionId }) => {
  await prisma.session.deleteMany({
    where: {
      id: sessionId,
      userId,
    },
  });
};

const deleteOtherSessions = async ({ userId, excludeSessionId }) => {
  await prisma.session.deleteMany({
    where: {
      userId,
      ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
    },
  });
};

const hasSessionFingerprint = async ({
  userId,
  userAgent = null,
  ipAddress = null,
}) => {
  return prisma.session.findFirst({
    where: {
      userId,
      userAgent,
      ipAddress,
    },
    select: { id: true },
  });
};

const setSessionCookie = (res, token, expiresAt) => {
  res.setHeader("Set-Cookie", buildCookieValue(token, expiresAt));
};

const clearSessionCookie = (res) => {
  res.setHeader("Set-Cookie", buildExpiredCookieValue());
};

module.exports = {
  createSession,
  deleteSessionByToken,
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  listUserSessions,
  deleteSessionById,
  deleteOtherSessions,
  hasSessionFingerprint,
};
