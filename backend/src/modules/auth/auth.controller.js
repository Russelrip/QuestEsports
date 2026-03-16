const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { db } = require("../../config/database");
const { env } = require("../../config/env");
const { HttpError } = require("../../lib/http-error");
const { asyncHandler } = require("../../lib/async-handler");
const {
  createSession,
  deleteSessionByToken,
  setSessionCookie,
  clearSessionCookie,
} = require("./session.service");
const {
  normalizeEmail,
  normalizeText,
  normalizeUsername,
  isNonEmptyString,
  isValidEmail,
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

const signup = asyncHandler(async (req, res) => {
  const firstName = normalizeText(req.body.firstName);
  const lastName = normalizeText(req.body.lastName);
  const email = normalizeEmail(req.body.email);
  const username = normalizeText(req.body.username);
  const usernameNormalized = normalizeUsername(req.body.username);
  const password = String(req.body.password || "");
  const phone = normalizeText(req.body.phone) || null;
  const discordTag = normalizeText(req.body.discordTag) || null;
  const role = env.ADMIN_EMAILS.includes(email) ? "admin" : "user";

  if (
    !isNonEmptyString(firstName) ||
    !isNonEmptyString(lastName) ||
    !isValidEmail(email) ||
    !isNonEmptyString(username) ||
    password.length < 8
  ) {
    throw new HttpError(
      400,
      "Please provide first name, last name, a valid email, username, and a password with at least 8 characters."
    );
  }

  const existingUser = db
    .prepare(
      `
        SELECT id, email_normalized AS emailNormalized, username_normalized AS usernameNormalized
        FROM users
        WHERE email_normalized = ? OR username_normalized = ?
        LIMIT 1
      `
    )
    .get(email, usernameNormalized);

  if (existingUser) {
    if (existingUser.emailNormalized === email) {
      throw new HttpError(400, "Email already exists.");
    }

    throw new HttpError(400, "Username already exists.");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  db.prepare(
    `
      INSERT INTO users (
        id,
        first_name,
        last_name,
        email,
        email_normalized,
        username,
        username_normalized,
        password_hash,
        role,
        phone,
        discord_tag
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    crypto.randomUUID(),
    firstName,
    lastName,
    email,
    email,
    username,
    usernameNormalized,
    passwordHash,
    role,
    phone,
    discordTag
  );

  res.status(201).json({
    success: true,
    message: "Signup successful.",
  });
});

const login = asyncHandler(async (req, res) => {
  const emailOrUsername = normalizeText(req.body.emailOrUsername);
  const password = String(req.body.password || "");
  const rememberMe = Boolean(req.body.remember);

  if (!emailOrUsername || !password) {
    throw new HttpError(400, "Email/username and password are required.");
  }

  const normalizedLookup = normalizeUsername(emailOrUsername);
  const normalizedEmail = normalizeEmail(emailOrUsername);

  const user = db
    .prepare(
      `
        SELECT
          id,
        first_name AS firstName,
        last_name AS lastName,
        email,
        username,
        phone,
        discord_tag AS discordTag,
        role,
        last_login_at AS lastLoginAt,
        password_hash AS passwordHash
      FROM users
      WHERE email_normalized = ? OR username_normalized = ?
      LIMIT 1
    `
    )
    .get(normalizedEmail, normalizedLookup);

  if (!user) {
    throw new HttpError(401, "Invalid credentials.");
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new HttpError(401, "Invalid credentials.");
  }

  const lastLoginAt = new Date().toISOString();
  db.prepare(
    `
      UPDATE users
      SET last_login_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(lastLoginAt, user.id);

  const { token, expiresAt } = createSession({
    userId: user.id,
    rememberMe,
  });
  setSessionCookie(res, token, expiresAt);

  res.status(200).json({
    success: true,
    message: "Login successful.",
    user: mapUserForResponse({
      ...user,
      lastLoginAt,
    }),
  });
});

const logout = asyncHandler(async (req, res) => {
  if (req.session?.token) {
    deleteSessionByToken(req.session.token);
  }

  clearSessionCookie(res);

  res.status(200).json({
    success: true,
    message: "Logout successful.",
  });
});

const getCurrentSession = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user ? mapUserForResponse(req.user) : null,
  });
});

const getProfile = asyncHandler(async (req, res) => {
  const requestedUserId = normalizeText(req.params.userId);

  if (req.user.id !== requestedUserId && req.user.role !== "admin") {
    throw new HttpError(403, "You do not have permission to view this profile.");
  }

  const user = db
    .prepare(
      `
        SELECT
          id,
          first_name AS firstName,
          last_name AS lastName,
          email,
          username,
          phone,
          discord_tag AS discordTag,
          role,
          last_login_at AS lastLoginAt,
          created_at AS createdAt
        FROM users
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(requestedUserId);

  if (!user) {
    throw new HttpError(404, "User not found.");
  }

  res.status(200).json({
    success: true,
    user: mapUserForResponse(user),
  });
});

const updateProfile = asyncHandler(async (req, res) => {
  const requestedUserId = normalizeText(req.params.userId);

  if (req.user.id !== requestedUserId && req.user.role !== "admin") {
    throw new HttpError(403, "You do not have permission to update this profile.");
  }

  const existingUser = db
    .prepare(
      `
        SELECT id, role
        FROM users
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(requestedUserId);

  if (!existingUser) {
    throw new HttpError(404, "User not found.");
  }

  const firstName = normalizeText(req.body.firstName);
  const lastName = normalizeText(req.body.lastName);
  const username = normalizeText(req.body.username);
  const usernameNormalized = normalizeUsername(username);
  const phone = normalizeText(req.body.phone) || null;
  const discordTag = normalizeText(req.body.discordTag) || null;

  if (
    !isNonEmptyString(firstName) ||
    !isNonEmptyString(lastName) ||
    !isNonEmptyString(username)
  ) {
    throw new HttpError(400, "First name, last name, and username are required.");
  }

  const conflictingUser = db
    .prepare(
      `
        SELECT id
        FROM users
        WHERE username_normalized = ? AND id != ?
        LIMIT 1
      `
    )
    .get(usernameNormalized, requestedUserId);

  if (conflictingUser) {
    throw new HttpError(400, "Username already exists.");
  }

  db.prepare(
    `
      UPDATE users
      SET
        first_name = ?,
        last_name = ?,
        username = ?,
        username_normalized = ?,
        phone = ?,
        discord_tag = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(
    firstName,
    lastName,
    username,
    usernameNormalized,
    phone,
    discordTag,
    requestedUserId
  );

  const updatedUser = db
    .prepare(
      `
        SELECT
          id,
          first_name AS firstName,
          last_name AS lastName,
          email,
          username,
          phone,
          discord_tag AS discordTag,
          role,
          last_login_at AS lastLoginAt,
          created_at AS createdAt
        FROM users
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(requestedUserId);

  res.status(200).json({
    success: true,
    message: "Profile updated successfully.",
    user: mapUserForResponse(updatedUser),
  });
});

const getAdminDashboard = asyncHandler(async (req, res) => {
  const stats = {
    totalUsers:
      db.prepare("SELECT COUNT(*) AS count FROM users").get().count || 0,
    totalAdmins:
      db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get()
        .count || 0,
    totalContacts:
      db.prepare("SELECT COUNT(*) AS count FROM contact_submissions").get().count ||
      0,
    totalTeamRegistrations:
      db.prepare("SELECT COUNT(*) AS count FROM team_registrations").get().count ||
      0,
  };

  const users = db
    .prepare(
      `
        SELECT
          id,
          first_name AS firstName,
          last_name AS lastName,
          email,
          username,
          role,
          last_login_at AS lastLoginAt,
          created_at AS createdAt
        FROM users
        ORDER BY created_at DESC
      `
    )
    .all()
    .map(mapUserForResponse);

  res.status(200).json({
    success: true,
    stats,
    users,
  });
});

module.exports = {
  signup,
  login,
  logout,
  getCurrentSession,
  getProfile,
  updateProfile,
  getAdminDashboard,
};
