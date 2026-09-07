const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { requireDiscordLinked } = require("../src/modules/auth/auth.middleware");

// The frontend routes a session with no linked Discord into a Connect step at
// login. That step is a suggestion until the server refuses the writes, so
// these cover the half that cannot be skipped by talking to the API directly.
const run = (user, method = "POST") => {
  let captured = "not-called";
  requireDiscordLinked({ user, method }, {}, (error) => {
    captured = error || null;
  });
  return captured;
};

test("a write from a user with no linked Discord is refused", () => {
  const error = run({ id: "user-1", role: "user", discordId: null });

  assert.ok(error, "the request must not continue");
  assert.equal(error.statusCode, 403);
  // The code is what lets the client send the user to the connect flow rather
  // than showing a dead end.
  assert.equal(error.code, "DISCORD_LINK_REQUIRED");
});

test("a write from a linked user continues", () => {
  assert.equal(
    run({ id: "user-1", role: "user", discordId: "900000000000000001" }),
    null,
  );
});

test("reads stay open so the connect screen can load", () => {
  // A user who cannot see the site cannot be talked through fixing their
  // account, and the connect screen itself has to fetch its own data.
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(run({ id: "user-1", role: "user", discordId: null }, method), null);
  }
});

test("anonymous requests are left to the auth middleware", () => {
  // Returning 403 here would mask a missing session as a Discord problem and
  // send a logged-out visitor to a connect screen they cannot use.
  assert.equal(run(null), null);
});

test("admins are exempt", () => {
  // Staff reach each other through the server's own role structure. Gating the
  // admin dashboard on a Discord link is how an operator locks themselves out
  // of the tool they would use to investigate the lockout.
  assert.equal(run({ id: "admin-1", role: "admin", discordId: null }), null);
});

test("the gate is mounted after the routes needed to satisfy it", () => {
  const routerSource = fs.readFileSync(
    path.join(__dirname, "../src/routes/index.js"),
    "utf8",
  );
  const gateIndex = routerSource.indexOf("router.use(requireDiscordLinked);");
  assert.ok(gateIndex > 0, "the gate must be mounted");

  // Signing in, reading the session, completing the OAuth link and signing out
  // all live in these two routers. Mounting the gate ahead of them would make
  // the requirement unsatisfiable: the only way to connect Discord runs
  // through the routes that would be blocked.
  assert.ok(routerSource.indexOf("router.use(authRoutes);") < gateIndex);
  assert.ok(routerSource.indexOf("router.use(accountRoutes);") < gateIndex);
  assert.ok(routerSource.indexOf("router.use(tournamentRoutes);") > gateIndex);
  assert.ok(routerSource.indexOf("router.use(recruitmentRoutes);") > gateIndex);
});
