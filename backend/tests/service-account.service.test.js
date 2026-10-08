const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/service-accounts/service-account.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const envPath = path.join(__dirname, "../src/config/env.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

// Just enough of Prisma to hold users and tokens in memory and answer the
// queries the service makes.
const buildDatabase = () => {
  const users = [];
  const tokens = [];
  const audits = [];

  const withAccountShape = (user) => ({
    ...user,
    staffRoles: [],
    serviceTokens: tokens
      .filter((token) => token.userId === user.id)
      .map((token) => ({ ...token, createdBy: null })),
  });

  const client = {
    user: {
      create: async ({ data }) => {
        users.push({ createdAt: new Date(), ...data });
        return { id: data.id };
      },
      findMany: async ({ where }) =>
        users.filter((user) => user.isServiceAccount === where.isServiceAccount).map(withAccountShape),
      findFirst: async ({ where }) => {
        const user = users.find((candidate) => candidate.id === where.id && candidate.isServiceAccount === where.isServiceAccount);
        return user ? withAccountShape(user) : null;
      },
    },
    serviceToken: {
      create: async ({ data }) => {
        tokens.push({ createdAt: new Date(), lastUsedAt: null, lastUsedIp: null, revokedAt: null, ...data });
        return { id: data.id };
      },
      findFirst: async ({ where }) =>
        tokens.find((token) => token.id === where.id && token.userId === where.userId) || null,
      findUnique: async ({ where }) => {
        const token = tokens.find((candidate) => candidate.tokenHash === where.tokenHash);
        if (!token) return null;
        return { ...token, user: users.find((user) => user.id === token.userId) };
      },
      update: async ({ where, data }) => {
        const token = tokens.find((candidate) => candidate.id === where.id);
        Object.assign(token, data);
        return token;
      },
    },
  };
  client.$transaction = async (work) => work(client);

  return { client, users, tokens, audits };
};

const loadService = ({ writeFreezeMode = "off" } = {}) => {
  const database = buildDatabase();
  const { module, restore } = loadModuleWithMocks(servicePath, {
    [prismaPath]: { prisma: database.client },
    [envPath]: { env: { WRITE_FREEZE_MODE: writeFreezeMode } },
    [auditPath]: {
      recordAuditInTransaction: async (tx, data) => {
        database.audits.push(data);
        return data;
      },
    },
  });
  return { service: module, restore, ...database };
};

const actor = { actorUserId: "super-1", requestId: "request-1", ipAddress: "127.0.0.1", source: "admin" };

test("a service account is a non-admin user that cannot sign in or receive mail", async () => {
  const { service, restore, users, audits } = loadService();
  try {
    const account = await service.createServiceAccount({ name: "Roster Bot" }, actor);

    assert.equal(users.length, 1);
    const [user] = users;
    assert.equal(user.isServiceAccount, true);
    assert.equal(user.role, "user");
    assert.match(user.username, /^bot-roster-bot-[0-9a-f]{6}$/);
    assert.ok(user.emailNormalized.endsWith(`@${service.SERVICE_ACCOUNT_EMAIL_DOMAIN}`));
    // .invalid is reserved and never resolves, so nothing can be delivered and
    // no OAuth provider can vouch for this address.
    assert.ok(service.SERVICE_ACCOUNT_EMAIL_DOMAIN.endsWith(".invalid"));
    assert.ok(user.passwordHash.startsWith("$2"), "a real bcrypt hash of a password nobody holds");

    assert.equal(account.name, "Roster Bot");
    assert.deepEqual(account.staffRoles, [], "it can reach nothing until roles are granted");
    assert.deepEqual(audits.map((audit) => audit.action), ["service_account.created"]);
    assert.equal(audits[0].actorUserId, "super-1");
  } finally {
    restore();
  }
});

test("a service account needs a short name", async () => {
  const { service, restore } = loadService();
  try {
    await assert.rejects(service.createServiceAccount({ name: "  " }, actor), (error) => error.statusCode === 400);
    await assert.rejects(service.createServiceAccount({ name: "x".repeat(61) }, actor), (error) => error.statusCode === 400);
  } finally {
    restore();
  }
});

test("a token is returned once and only its hash is stored", async () => {
  const { service, restore, users, tokens, audits } = loadService();
  try {
    await service.createServiceAccount({ name: "Agent" }, actor);
    const before = Date.now();
    const { token, account } = await service.issueServiceToken(users[0].id, { name: "claude-code" }, actor);

    assert.match(token, /^qsa_[A-Za-z0-9_-]{64}$/);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].tokenHash, sha256(token));
    assert.ok(!JSON.stringify(tokens[0]).includes(token), "the token itself is never stored");
    assert.equal(tokens[0].tokenPrefix, token.slice(0, 10));
    assert.equal(tokens[0].createdByUserId, "super-1");

    const days = (tokens[0].expiresAt.getTime() - before) / (24 * 60 * 60 * 1000);
    assert.ok(days > 89.99 && days < 90.01, "defaults to 90 days");

    assert.ok(!JSON.stringify(account).includes(token), "the listing never carries the token");
    assert.equal(account.tokens[0].status, "active");
    assert.ok(!JSON.stringify(audits).includes(token), "nor does the audit log");
  } finally {
    restore();
  }
});

test("a token must expire within a year", async () => {
  const { service, restore, users } = loadService();
  try {
    await service.createServiceAccount({ name: "Agent" }, actor);
    for (const expiresInDays of [0, -1, 366, 1.5, "soon"]) {
      await assert.rejects(
        service.issueServiceToken(users[0].id, { name: "t", expiresInDays }, actor),
        (error) => error.statusCode === 400,
        String(expiresInDays)
      );
    }
    await service.issueServiceToken(users[0].id, { name: "t", expiresInDays: 365 }, actor);
  } finally {
    restore();
  }
});

test("tokens are only issued for service accounts", async () => {
  const { service, restore, users } = loadService();
  try {
    users.push({ id: "person-1", isServiceAccount: false, role: "admin" });
    await assert.rejects(
      service.issueServiceToken("person-1", { name: "t" }, actor),
      (error) => error.statusCode === 404
    );
  } finally {
    restore();
  }
});

test("a live token authenticates as its service account and records its use", async () => {
  const { service, restore, users, tokens } = loadService();
  try {
    await service.createServiceAccount({ name: "Agent" }, actor);
    const { token } = await service.issueServiceToken(users[0].id, { name: "t" }, actor);

    const result = await service.authenticateServiceToken(token, { ipAddress: "10.0.0.5" });

    assert.equal(result.user.id, users[0].id);
    assert.equal(result.user.isServiceAccount, true);
    assert.equal(result.user.isSuperAdmin, false);
    assert.equal(result.serviceTokenId, tokens[0].id);
    assert.ok(tokens[0].lastUsedAt instanceof Date);
    assert.equal(tokens[0].lastUsedIp, "10.0.0.5");
  } finally {
    restore();
  }
});

test("revoked, expired, unknown, and malformed tokens do not authenticate", async () => {
  const { service, restore, users, tokens } = loadService();
  try {
    await service.createServiceAccount({ name: "Agent" }, actor);
    const { token: revoked } = await service.issueServiceToken(users[0].id, { name: "revoked" }, actor);
    const { token: expired } = await service.issueServiceToken(users[0].id, { name: "expired" }, actor);
    await service.revokeServiceToken(users[0].id, tokens[0].id, actor);
    tokens[1].expiresAt = new Date(Date.now() - 1000);

    assert.equal(await service.authenticateServiceToken(revoked), null);
    assert.equal(await service.authenticateServiceToken(expired), null);
    assert.equal(await service.authenticateServiceToken(`qsa_${"A".repeat(64)}`), null);
    assert.equal(await service.authenticateServiceToken("a".repeat(96)), null);
    assert.equal(await service.authenticateServiceToken(""), null);
  } finally {
    restore();
  }
});

test("a token on an account that is no longer a non-admin service account does not authenticate", async () => {
  const { service, restore, users } = loadService();
  try {
    await service.createServiceAccount({ name: "Agent" }, actor);
    const { token } = await service.issueServiceToken(users[0].id, { name: "t" }, actor);

    users[0].role = "admin";
    assert.equal(await service.authenticateServiceToken(token), null);

    users[0].role = "user";
    users[0].isServiceAccount = false;
    assert.equal(await service.authenticateServiceToken(token), null);
  } finally {
    restore();
  }
});

test("a write freeze authenticates without recording use", async () => {
  const { service, restore, users, tokens } = loadService({ writeFreezeMode: "validation" });
  try {
    await service.createServiceAccount({ name: "Agent" }, actor);
    const { token } = await service.issueServiceToken(users[0].id, { name: "t" }, actor);

    assert.ok(await service.authenticateServiceToken(token));
    assert.equal(tokens[0].lastUsedAt, null);
  } finally {
    restore();
  }
});

test("revoking is audited, recorded against the revoker, and happens once", async () => {
  const { service, restore, users, tokens, audits } = loadService();
  try {
    await service.createServiceAccount({ name: "Agent" }, actor);
    await service.issueServiceToken(users[0].id, { name: "t" }, actor);

    const account = await service.revokeServiceToken(users[0].id, tokens[0].id, actor);

    assert.ok(tokens[0].revokedAt instanceof Date);
    assert.equal(tokens[0].revokedByUserId, "super-1");
    assert.equal(account.tokens[0].status, "revoked");
    assert.equal(audits.at(-1).action, "service_account.token_revoked");
    await assert.rejects(
      service.revokeServiceToken(users[0].id, tokens[0].id, actor),
      (error) => error.statusCode === 409
    );
    await assert.rejects(
      service.revokeServiceToken(users[0].id, "missing", actor),
      (error) => error.statusCode === 404
    );
  } finally {
    restore();
  }
});
