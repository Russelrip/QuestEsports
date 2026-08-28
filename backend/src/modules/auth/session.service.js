const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { env } = require("../../config/env");
const { logger } = require("../../lib/logger");
const { PUBLIC_USER_SELECT } = require("./auth.service");

const SESSION_COOKIE_NAME = env.SESSION_COOKIE_NAME;
const LAST_SEEN_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const EXPIRED_SESSION_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
let lastExpiredSessionCleanupStartedAt = 0;
let expiredSessionCleanupPromise = null;

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
  avatarUrl: record.avatarImageName
    ? `/api/uploads/avatars/${record.avatarImageName}`
    : null,
  role: record.role,
  pendingEmail: record.pendingEmail || null,
  emailVerified: Boolean(record.emailVerified),
  emailVerifiedAt: record.emailVerifiedAt || null,
  lastLoginAt: record.lastLoginAt,
  createdAt: record.createdAt,
});

const parseCookies = (cookieHeader = "") =>
  cookieHeader.split(";").reduce((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) {
      return cookies;
    }

    try {
      cookies[rawName] = decodeURIComponent(rawValue.join("=") || "");
    } catch {
      // A malformed cookie is untrusted client input. Ignore only that cookie
      // instead of turning an anonymous request into a server error.
    }
    return cookies;
  }, {});

const getBearerToken = (authorizationHeader = "") => {
  const match = /^Bearer\s+([a-f0-9]{96})$/i.exec(String(authorizationHeader).trim());
  return match ? match[1] : null;
};

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

const isWriteFreezeValidation = () => env.WRITE_FREEZE_MODE === "validation";

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

const scheduleExpiredSessionCleanup = () => {
  if (isWriteFreezeValidation()) {
    return;
  }

  const now = Date.now();

  if (
    expiredSessionCleanupPromise ||
    now - lastExpiredSessionCleanupStartedAt < EXPIRED_SESSION_CLEANUP_INTERVAL_MS
  ) {
    return;
  }

  lastExpiredSessionCleanupStartedAt = now;
  expiredSessionCleanupPromise = deleteExpiredSessions()
    .catch((error) => {
      logger.warn("Expired session cleanup failed", { error });
    })
    .finally(() => {
      expiredSessionCleanupPromise = null;
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
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  const bearerToken = getBearerToken(req.headers.authorization);
  // Never let an Authorization header silently override an authenticated
  // browser cookie. Native clients deliberately send no session cookie.
  const token = cookieToken || bearerToken;
  const source = cookieToken ? "cookie" : bearerToken ? "bearer" : null;

  if (!token) {
    return null;
  }

  scheduleExpiredSessionCleanup();

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
    if (!isWriteFreezeValidation()) {
      await deleteSessionByToken(token);
    }
    return null;
  }

  if (
    !isWriteFreezeValidation() &&
    (!session.lastSeenAt ||
    Date.now() - session.lastSeenAt.getTime() >= LAST_SEEN_UPDATE_INTERVAL_MS
    )
  ) {
    const refreshed = await prisma.session.updateMany({
      where: {
        id: session.id,
        tokenHash: hashToken(token),
        expiresAt: { gt: new Date() },
      },
      data: {
        lastSeenAt: new Date(),
      },
    });
    if (!refreshed.count) {
      return null;
    }
  }

  return {
    token,
    source,
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
  scheduleExpiredSessionCleanup();

  const sessions = await prisma.session.findMany({
    where: {
      userId,
      expiresAt: {
        gt: new Date(),
      },
    },
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

const setSessionCookie = (res, token, expiresAt) => {
  res.setHeader("Set-Cookie", buildCookieValue(token, expiresAt));
};

const clearSessionCookie = (res) => {
  res.setHeader("Set-Cookie", buildExpiredCookieValue());
};

module.exports = {
  createSession,
  deleteSessionByToken,
  getBearerToken,
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  listUserSessions,
  deleteSessionById,
  deleteOtherSessions,
};
