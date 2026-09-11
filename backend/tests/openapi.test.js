const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { openApiDocument } = require("../src/lib/openapi");

const normalizeExpressPath = (path, prefix = "/api") =>
  `${prefix}${path}`.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

const collectRouteFiles = (directory, files = []) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectRouteFiles(entryPath, files);
    else if (entry.name.endsWith(".routes.js")) files.push(entryPath);
  }
  return files;
};

const collectRouteOperations = () => {
  const modulesDirectory = path.join(__dirname, "../src/modules");
  const routePattern = /router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
  const legacy = collectRouteFiles(modulesDirectory).flatMap((file) => {
    const source = fs.readFileSync(file, "utf8");
    const prefix = file.endsWith(path.join("support", "support.routes.js")) ? "/api/v1" : "/api";
    return [...source.matchAll(routePattern)].map((match) => ({
      method: match[1],
      path: normalizeExpressPath(match[2], prefix),
    }));
  });
  const v1Source = fs.readFileSync(path.join(__dirname, "../src/routes/v1.js"), "utf8");
  const v1 = [...v1Source.matchAll(routePattern)].map((match) => ({
    method: match[1],
    path: normalizeExpressPath(match[2], "/api/v1"),
  }));
  return [...legacy, ...v1];
};

test("OpenAPI documents every mounted API route and method", () => {
  const missing = collectRouteOperations().filter(
    ({ method, path }) => !openApiDocument.paths[path]?.[method]
  );
  assert.deepEqual(missing, []);
});

test("OpenAPI documents the authenticated PUUID-only leaderboard registration contract", () => {
  const paths = openApiDocument.paths;
  assert.equal(paths["/api/v1/valorant/leaderboard/register/discord/login"], undefined);
  assert.equal(paths["/api/v1/valorant/leaderboard/register/discord/callback"], undefined);
  for (const path of [
    "/api/v1/valorant/leaderboard/register/check-puuid",
    "/api/v1/valorant/leaderboard/register/preview",
    "/api/v1/valorant/leaderboard/register/submit",
  ]) {
    const operation = paths[path].post;
    assert.deepEqual(operation.security, [{ sessionCookie: [] }, { mobileBearer: [] }]);
    assert.match(operation.summary, /PUUID/);
    assert.ok(operation.responses[401]);
  }
});

test("OpenAPI declares the session-cookie authentication scheme", () => {
  assert.deepEqual(openApiDocument.components.securitySchemes.sessionCookie, {
    type: "apiKey",
    in: "cookie",
    name: process.env.SESSION_COOKIE_NAME,
    description: "HttpOnly session cookie issued by the login or OAuth flow.",
  });
});

test("OpenAPI documents public/private realtime topics and transient recovery semantics", () => {
  const operation = openApiDocument.paths["/api/v1/events"]?.get;

  assert.ok(operation);
  assert.equal(operation.parameters[0].name, "topics");
  assert.equal(operation.parameters[0].schema.default, "matches,brackets");
  assert.deepEqual(operation.security, [{ sessionCookie: [] }, {}]);
  assert.match(operation.description, /authorized user:\{userId\}/);
  assert.match(operation.description, /no durable replay/);
  assert.ok(operation.responses[403]);
  assert.ok(operation.responses[429]);
  assert.ok(operation.responses[503]);
  assert.equal(operation.responses[200].content["text/event-stream"].schema.type, "string");
});

test("OpenAPI documents scoped authorization and the catalog tournament selector", () => {
  const paths = openApiDocument.paths;
  const catalog = paths["/api/v1/admin/veto/catalog"]?.get;
  const roomOpen = paths["/api/v1/admin/veto-rooms/{roomId}/open"]?.post;
  const matchUpdate = paths["/api/v1/admin/matches/{matchId}"]?.patch;
  const staffList = paths["/api/v1/admin/tournaments/{id}/staff"]?.get;
  const staffRemove = paths["/api/v1/admin/tournaments/{id}/staff/{assignmentId}"]?.delete;

  assert.deepEqual(catalog["x-required-permission-scopes"], ["veto.catalog.config"]);
  assert.ok(catalog.responses[403]);
  assert.deepEqual(catalog.parameters, [{
    name: "tournamentId",
    in: "query",
    schema: { type: "string" },
    description: "Optional; omit it for global catalog reads, or provide it to scope the catalog to a tournament.",
  }]);
  assert.deepEqual(roomOpen["x-required-permission-scopes"], ["veto.operations"]);
  assert.ok(roomOpen.responses[403]);
  assert.deepEqual(matchUpdate["x-required-permission-scopes"], ["match.operations"]);
  assert.ok(matchUpdate.responses[403]);
  for (const operation of [staffList, staffRemove]) {
    assert.deepEqual(operation["x-required-permission-scopes"], ["staff.roster.management"]);
    assert.equal(operation["x-required-global-role"], "admin");
    assert.equal(
      operation.description,
      "Requires the global admin role and the staff.roster.management scope; a tournament_admin assignment alone is insufficient.",
    );
    assert.ok(operation.responses[403]);
  }
});

test("OpenAPI documents tournament-read authorization for private staff reads", () => {
  const paths = openApiDocument.paths;
  const tournamentMatches = paths["/api/v1/admin/tournaments/{id}/matches"];
  const vetoRooms = paths["/api/v1/admin/veto-rooms"]?.get;
  const vetoRoom = paths["/api/v1/admin/veto-rooms/{roomId}"]?.get;
  const matchRooms = paths["/api/v1/admin/match-rooms"]?.get;

  assert.deepEqual(tournamentMatches.get["x-required-permission-scopes"], ["tournament.read"]);
  assert.deepEqual(tournamentMatches.post["x-required-permission-scopes"], ["match.operations"]);
  assert.deepEqual(vetoRooms["x-required-permission-scopes"], ["tournament.read"]);
  assert.deepEqual(vetoRooms.parameters, [{
    name: "tournamentId",
    in: "query",
    schema: { type: "string" },
    description: "Optional; without it, the service returns rooms for the authenticated staff assignments.",
  }]);
  assert.deepEqual(vetoRoom["x-required-permission-scopes"], ["tournament.read"]);
  assert.deepEqual(matchRooms["x-required-permission-scopes"], ["tournament.read"]);
  assert.equal(matchRooms.summary, "List match rooms visible to tournament staff or directly assigned match staff");
  for (const operation of [tournamentMatches.get, vetoRooms, vetoRoom, matchRooms]) assert.ok(operation.responses[403]);
});

test("OpenAPI declares the staff support read operation", () => {
  const operation = openApiDocument.paths[
    "/api/v1/admin/support/conversations/{conversationId}/read"
  ]?.patch;

  assert.ok(operation);
  assert.deepEqual(operation.security, [
    { sessionCookie: [] },
    { mobileBearer: [] },
  ]);
  assert.deepEqual(operation.parameters, [
    {
      name: "conversationId",
      in: "path",
      required: true,
      schema: { type: "string" },
    },
  ]);
});

test("OpenAPI documents authenticated support unread and attachment routes plus screenshot multipart bodies", () => {
  const paths = openApiDocument.paths;
  const unread = paths["/api/v1/support/unread"].get;
  const attachment = paths["/api/v1/support/attachments/{attachmentId}/content"].get;
  assert.deepEqual(unread.security, [{ sessionCookie: [] }, { mobileBearer: [] }]);
  assert.ok(unread.responses[200]);
  assert.deepEqual(attachment.parameters, [{
    name: "attachmentId",
    in: "path",
    required: true,
    schema: { type: "string" },
  }]);
  assert.deepEqual(attachment.security, [{ sessionCookie: [] }, { mobileBearer: [] }]);
  assert.ok(attachment.responses[404]);

  for (const operation of [
    paths["/api/v1/support/conversations"].post,
    paths["/api/v1/support/conversations/{conversationId}/messages"].post,
    paths["/api/v1/admin/support/conversations/{conversationId}/messages"].post,
  ]) {
    assert.ok(operation.requestBody.content["application/json"]);
    const multipart = operation.requestBody.content["multipart/form-data"].schema;
    assert.equal(multipart.properties.screenshots.maxItems, 3);
    assert.match(multipart.properties.screenshots.items.description, /JPEG, PNG, or WebP/);
  }
});

test("OpenAPI declares canonical OAuth account-linking operations", () => {
  const paths = openApiDocument.paths;

  const providers = paths["/api/v1/auth/oauth/providers"]?.get;
  const start = paths["/api/v1/auth/oauth/{provider}/link"]?.get;
  const callback = paths["/api/v1/auth/oauth/{provider}/link/callback"]?.get;
  const unlink = paths["/api/v1/auth/oauth/{provider}"]?.delete;

  assert.ok(providers);
  assert.ok(start);
  assert.ok(callback);
  assert.ok(unlink);
  assert.deepEqual(start.parameters[0], {
    name: "provider",
    in: "path",
    required: true,
    schema: { type: "string", enum: ["google", "discord"] },
  });
  assert.deepEqual(callback.parameters.slice(1).map((parameter) => parameter.required), [true, true]);
  assert.deepEqual(callback.security, [{ sessionCookie: [] }, { mobileBearer: [] }]);
  assert.ok(callback.responses[302].headers.Location);
  assert.ok(callback.responses[302].headers["Set-Cookie"]);
  assert.ok(callback.responses[400]);
  assert.ok(start.responses[302].headers.Location);
  assert.ok(start.responses[302].headers["Set-Cookie"]);
  assert.equal(start.responses[200], undefined);
  assert.equal(unlink.responses[200].content["application/json"].schema.properties.providers.type, "array");
  assert.ok(unlink.responses[409]);
});
