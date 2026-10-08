const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { prisma } = require("../../lib/prisma");
const { env } = require("../../config/env");
const { HttpError } = require("../../lib/http-error");
const { normalizeText } = require("../../lib/validation");
const { recordAuditInTransaction } = require("../../lib/audit");
const { SERVICE_TOKEN_PREFIX, isServiceTokenFormat } = require("../../lib/service-token-format");

// A service account is how a bot or an agent works in the admin API without
// borrowing a person's login. It is an ordinary user row flagged as automation,
// so the staff roles it is granted decide exactly what it may open, and every
// audit record it causes names it rather than whoever set it up.
//
// It has no usable password and an address on a reserved domain, so it cannot
// sign in, reset a password, or be matched by an OAuth email. The only way in is
// a service token: shown once at issue, stored as a hash, always expiring, and
// revocable on its own without touching the account.

const SERVICE_ACCOUNT_EMAIL_DOMAIN = "service.questesports.invalid";
const DEFAULT_TOKEN_DAYS = 90;
const MAX_TOKEN_DAYS = 365;
const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

const hashServiceToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const generateServiceToken = () => {
  const token = `${SERVICE_TOKEN_PREFIX}${crypto.randomBytes(48).toString("base64url")}`;
  return {
    token,
    tokenHash: hashServiceToken(token),
    // Enough to tell two tokens apart in a list, far too little to use.
    tokenPrefix: token.slice(0, SERVICE_TOKEN_PREFIX.length + 6),
  };
};

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "bot";

const mapToken = (token, now = Date.now()) => ({
  id: token.id,
  name: token.name,
  tokenPrefix: token.tokenPrefix,
  createdAt: token.createdAt,
  expiresAt: token.expiresAt,
  lastUsedAt: token.lastUsedAt,
  lastUsedIp: token.lastUsedIp,
  revokedAt: token.revokedAt,
  status: token.revokedAt ? "revoked" : token.expiresAt.getTime() <= now ? "expired" : "active",
  createdBy: token.createdBy ? { id: token.createdBy.id, username: token.createdBy.username } : null,
});

const SERVICE_ACCOUNT_SELECT = {
  id: true,
  firstName: true,
  username: true,
  createdAt: true,
  staffRoles: {
    select: { role: { select: { id: true, name: true, color: true, permissions: true } } },
    orderBy: { createdAt: "asc" },
  },
  serviceTokens: {
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      createdAt: true,
      expiresAt: true,
      lastUsedAt: true,
      lastUsedIp: true,
      revokedAt: true,
      createdBy: { select: { id: true, username: true } },
    },
  },
};

const mapServiceAccount = (account) => ({
  id: account.id,
  name: account.firstName,
  username: account.username,
  createdAt: account.createdAt,
  staffRoles: account.staffRoles.map(({ role }) => role),
  tokens: account.serviceTokens.map((token) => mapToken(token)),
});

const listServiceAccounts = async () => {
  const accounts = await prisma.user.findMany({
    where: { isServiceAccount: true },
    orderBy: { createdAt: "asc" },
    select: SERVICE_ACCOUNT_SELECT,
  });
  return accounts.map(mapServiceAccount);
};

const getServiceAccount = async (client, serviceAccountId) => {
  const account = await client.user.findFirst({
    where: { id: String(serviceAccountId || ""), isServiceAccount: true },
    select: SERVICE_ACCOUNT_SELECT,
  });
  if (!account) throw new HttpError(404, "Service account not found.");
  return account;
};

const auditFields = (auditContext) => ({
  actorUserId: auditContext.actorUserId || null,
  requestId: auditContext.requestId || null,
  ipAddress: auditContext.ipAddress || null,
  source: auditContext.source || null,
});

const createServiceAccount = async (body = {}, auditContext = {}) => {
  const name = normalizeText(body.name);
  if (!name) throw new HttpError(400, "A service account needs a name.");
  if (name.length > 60) throw new HttpError(400, "A service account name must be 60 characters or fewer.");

  // The random suffix keeps two bots with the same name from colliding without
  // a lookup loop; nobody types this username, it only has to be unique.
  const username = `bot-${slugify(name)}-${crypto.randomBytes(3).toString("hex")}`;
  const email = `${username}@${SERVICE_ACCOUNT_EMAIL_DOMAIN}`;
  // A hash of random bytes nobody ever sees: there is no password to guess.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

  const account = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        id: crypto.randomUUID(),
        firstName: name,
        lastName: "Service account",
        email,
        emailNormalized: email,
        username,
        usernameNormalized: username,
        passwordHash,
        role: "user",
        isServiceAccount: true,
        // Several admin routes require a verified address. Nothing is ever sent
        // to this one; it is verified by being ours.
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    });
    await recordAuditInTransaction(tx, {
      ...auditFields(auditContext),
      action: "service_account.created",
      targetType: "User",
      targetId: created.id,
      afterData: { name, username },
    });
    return getServiceAccount(tx, created.id);
  });

  return mapServiceAccount(account);
};

const issueServiceToken = async (serviceAccountId, body = {}, auditContext = {}) => {
  const name = normalizeText(body.name);
  if (!name) throw new HttpError(400, "A token needs a name, such as where it will be used.");
  if (name.length > 60) throw new HttpError(400, "A token name must be 60 characters or fewer.");

  const requestedDays = body.expiresInDays === undefined || body.expiresInDays === null || body.expiresInDays === ""
    ? DEFAULT_TOKEN_DAYS
    : Number(body.expiresInDays);
  if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > MAX_TOKEN_DAYS) {
    throw new HttpError(400, `A token must expire within 1 to ${MAX_TOKEN_DAYS} days.`);
  }

  const { token, tokenHash, tokenPrefix } = generateServiceToken();
  const expiresAt = new Date(Date.now() + requestedDays * 24 * 60 * 60 * 1000);

  const account = await prisma.$transaction(async (tx) => {
    await getServiceAccount(tx, serviceAccountId);
    const created = await tx.serviceToken.create({
      data: {
        id: crypto.randomUUID(),
        userId: serviceAccountId,
        name,
        tokenHash,
        tokenPrefix,
        expiresAt,
        createdByUserId: auditContext.actorUserId || null,
      },
      select: { id: true },
    });
    await recordAuditInTransaction(tx, {
      ...auditFields(auditContext),
      action: "service_account.token_issued",
      targetType: "User",
      targetId: serviceAccountId,
      afterData: { tokenId: created.id, name, tokenPrefix, expiresAt: expiresAt.toISOString() },
    });
    return getServiceAccount(tx, serviceAccountId);
  });

  // The only time the token leaves the server.
  return { token, account: mapServiceAccount(account) };
};

const revokeServiceToken = async (serviceAccountId, tokenId, auditContext = {}) => {
  const account = await prisma.$transaction(async (tx) => {
    await getServiceAccount(tx, serviceAccountId);
    const existing = await tx.serviceToken.findFirst({
      where: { id: String(tokenId || ""), userId: serviceAccountId },
      select: { id: true, name: true, tokenPrefix: true, revokedAt: true },
    });
    if (!existing) throw new HttpError(404, "Token not found.");
    if (existing.revokedAt) throw new HttpError(409, "That token is already revoked.");

    await tx.serviceToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), revokedByUserId: auditContext.actorUserId || null },
    });
    await recordAuditInTransaction(tx, {
      ...auditFields(auditContext),
      action: "service_account.token_revoked",
      targetType: "User",
      targetId: serviceAccountId,
      beforeData: { tokenId: existing.id, name: existing.name, tokenPrefix: existing.tokenPrefix },
    });
    return getServiceAccount(tx, serviceAccountId);
  });

  return mapServiceAccount(account);
};

// Resolves a bearer token to the account it belongs to, or null. Anything short
// of a live token on a live service account is null, never an error: an
// unauthenticated request is answered by the route guards, as for a session.
const authenticateServiceToken = async (token, { ipAddress = null } = {}) => {
  if (!isServiceTokenFormat(token)) return null;

  const record = await prisma.serviceToken.findUnique({
    where: { tokenHash: hashServiceToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          username: true,
          role: true,
          isSuperAdmin: true,
          isServiceAccount: true,
          emailVerified: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
          createdAt: true,
        },
      },
    },
  });
  if (!record || record.revokedAt || record.expiresAt.getTime() <= Date.now()) return null;
  // The database keeps a service account off the admin role; this keeps a token
  // from ever standing in for a person if a row were somehow flipped.
  if (!record.user.isServiceAccount || record.user.role === "admin") return null;

  if (
    env.WRITE_FREEZE_MODE !== "validation" &&
    (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() >= LAST_USED_UPDATE_INTERVAL_MS)
  ) {
    await prisma.serviceToken.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date(), lastUsedIp: ipAddress },
    });
  }

  return {
    serviceTokenId: record.id,
    expiresAt: record.expiresAt,
    user: {
      id: record.user.id,
      firstName: record.user.firstName,
      lastName: record.user.lastName,
      email: record.user.email,
      username: record.user.username,
      phone: null,
      discordTag: null,
      discordId: null,
      avatarUrl: null,
      role: record.user.role,
      isSuperAdmin: false,
      isServiceAccount: true,
      pendingEmail: null,
      emailVerified: Boolean(record.user.emailVerified),
      emailVerifiedAt: record.user.emailVerifiedAt || null,
      lastLoginAt: record.user.lastLoginAt,
      createdAt: record.user.createdAt,
    },
  };
};

module.exports = {
  DEFAULT_TOKEN_DAYS,
  MAX_TOKEN_DAYS,
  SERVICE_ACCOUNT_EMAIL_DOMAIN,
  authenticateServiceToken,
  createServiceAccount,
  hashServiceToken,
  issueServiceToken,
  listServiceAccounts,
  revokeServiceToken,
};
