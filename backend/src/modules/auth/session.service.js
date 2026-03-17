const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { env } = require("../../config/env");

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

const createSession = async ({ userId, rememberMe }) => {
  const token = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + getSessionDurationMs(rememberMe)
  ).toISOString();

  await prisma.session.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      tokenHash,
      expiresAt: new Date(expiresAt),
      lastSeenAt: new Date(),
    },
  });

  return { token, expiresAt };
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
      user: {
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
    user: mapUserForSession({
      userId: session.user.id,
      ...session.user,
    }),
  };
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
};
