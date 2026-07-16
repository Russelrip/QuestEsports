const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { openApiDocument } = require("../src/lib/openapi");

const normalizeExpressPath = (path) =>
  `/api${path}`.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

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
  return collectRouteFiles(modulesDirectory).flatMap((file) => {
    const source = fs.readFileSync(file, "utf8");
    return [...source.matchAll(routePattern)].map((match) => ({
      method: match[1],
      path: normalizeExpressPath(match[2]),
    }));
  });
};

test("OpenAPI documents every mounted API route and method", () => {
  const missing = collectRouteOperations().filter(
    ({ method, path }) => !openApiDocument.paths[path]?.[method]
  );
  assert.deepEqual(missing, []);
});

test("OpenAPI declares the session-cookie authentication scheme", () => {
  assert.deepEqual(openApiDocument.components.securitySchemes.sessionCookie, {
    type: "apiKey",
    in: "cookie",
    name: process.env.SESSION_COOKIE_NAME,
    description: "HttpOnly session cookie issued by the login or OAuth flow.",
  });
});
