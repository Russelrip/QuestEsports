const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const scriptPath = path.join(__dirname, "../scripts/set-super-admin.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const databasePath = path.join(__dirname, "../src/lib/database.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");

const makeDatabase = (users) => {
  const audits = [];
  const database = {
    audits,
    users,
    user: {
      findUnique: async ({ where }) => users.find((user) => user.emailNormalized === where.emailNormalized) ?? null,
      count: async ({ where }) => users.filter((user) => user.isSuperAdmin === where.isSuperAdmin && user.id !== where.id.not).length,
      update: async ({ where, data }) => Object.assign(users.find((user) => user.id === where.id), data),
    },
  };
  database.$transaction = async (callback) => callback(database);
  return database;
};

const loadScript = (audits) => loadModuleWithMocks(scriptPath, {
  [prismaPath]: { prisma: {} },
  [databasePath]: { closeDatabase: async () => {} },
  [auditPath]: { recordAuditInTransaction: async (_tx, entry) => { audits.push(entry); } },
}).module;

const account = (overrides) => ({ id: "u-1", username: "Russel", emailNormalized: "owner@example.com", role: "admin", isSuperAdmin: false, ...overrides });

test("parseArguments reads the email in either form and the revoke flag", () => {
  const { parseArguments } = loadScript([]);
  assert.deepEqual(parseArguments(["--email", " Owner@Example.com "]), { email: "owner@example.com", revoke: false });
  assert.deepEqual(parseArguments(["--email=owner@example.com", "--revoke"]), { email: "owner@example.com", revoke: true });
  assert.throws(() => parseArguments([]), /Usage/);
  assert.throws(() => parseArguments(["--email", "a@b.c", "--force"]), /Unknown argument/);
});

test("granting super admin sets the flag on an admin and audits it as a system change", async () => {
  const audits = [];
  const { setSuperAdmin } = loadScript(audits);
  const database = makeDatabase([account()]);

  const result = await setSuperAdmin({ email: "owner@example.com", revoke: false }, database);
  assert.equal(result.changed, true);
  assert.equal(database.users[0].isSuperAdmin, true);
  assert.deepEqual(audits.map((entry) => [entry.action, entry.targetId, entry.source]), [["admin.user.super_admin.granted", "u-1", "system"]]);

  const again = await setSuperAdmin({ email: "owner@example.com", revoke: false }, database);
  assert.equal(again.changed, false);
  assert.equal(audits.length, 1);
});

test("super admin is refused for unknown accounts and accounts that are not admins", async () => {
  const { setSuperAdmin } = loadScript([]);
  const database = makeDatabase([account({ role: "user" })]);
  await assert.rejects(setSuperAdmin({ email: "nobody@example.com", revoke: false }, database), /No account uses/);
  await assert.rejects(setSuperAdmin({ email: "owner@example.com", revoke: false }, database), /not an admin/);
  assert.equal(database.users[0].isSuperAdmin, false);
});

test("revoking the last super admin is refused, and revoking one of two works", async () => {
  const audits = [];
  const { setSuperAdmin } = loadScript(audits);
  const database = makeDatabase([account({ isSuperAdmin: true })]);
  await assert.rejects(setSuperAdmin({ email: "owner@example.com", revoke: true }, database), /last super admin/);
  assert.equal(database.users[0].isSuperAdmin, true);

  database.users.push(account({ id: "u-2", username: "Other", emailNormalized: "other@example.com", isSuperAdmin: true }));
  const result = await setSuperAdmin({ email: "owner@example.com", revoke: true }, database);
  assert.equal(result.changed, true);
  assert.equal(database.users[0].isSuperAdmin, false);
  assert.deepEqual(audits.map((entry) => entry.action), ["admin.user.super_admin.revoked"]);
});
