const crypto = require("crypto");
const { db } = require("../../config/database");
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

const createSession = ({ userId, rememberMe }) => {
  const token = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + getSessionDurationMs(rememberMe)
  ).toISOString();

  db.prepare(
    `
      INSERT INTO sessions (id, user_id, token_hash, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `
  ).run(crypto.randomUUID(), userId, tokenHash, expiresAt);

  return { token, expiresAt };
};

const deleteSessionByToken = (token) => {
  if (!token) {
    return;
  }

  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
};

const deleteExpiredSessions = () => {
  db.prepare("DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP").run();
};

const getSessionFromRequest = (req) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE_NAME];

  if (!token) {
    return null;
  }

  deleteExpiredSessions();

  const session = db
    .prepare(
      `
        SELECT
          sessions.id AS sessionId,
          sessions.user_id AS userId,
          sessions.expires_at AS expiresAt,
          users.first_name AS firstName,
          users.last_name AS lastName,
          users.email AS email,
          users.username AS username,
          users.phone AS phone,
          users.discord_tag AS discordTag,
          users.role AS role,
          users.last_login_at AS lastLoginAt,
          users.created_at AS createdAt
        FROM sessions
        INNER JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
        LIMIT 1
      `
    )
    .get(hashToken(token));

  if (!session) {
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    deleteSessionByToken(token);
    return null;
  }

  db.prepare(
    `
      UPDATE sessions
      SET last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(session.sessionId);

  return {
    token,
    sessionId: session.sessionId,
    user: mapUserForSession(session),
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
