const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const dockerfile = read("ops/docker/backend.production.Dockerfile");
const dockerignore = read("backend/.dockerignore");

test("the production backend image has immutable runtime and migrator targets", () => {
  assert.match(dockerfile, /FROM node:24-bookworm-slim AS dependencies/);
  assert.match(dockerfile, /FROM node:24-bookworm-slim AS runtime/);
  assert.match(dockerfile, /FROM dependencies AS migrator/);
  assert.match(dockerfile, /RUN npm ci/);
  assert.match(dockerfile, /npx prisma generate/);
  assert.match(dockerfile, /RUN npm prune --omit=dev/);
  assert.match(dockerfile, /COPY --from=production-dependencies \/app\/node_modules/);
  assert.match(dockerfile, /COPY --from=dependencies .*src\/generated/);
});

test("the runtime contract is production-only, non-root, and binds all interfaces", () => {
  assert.match(dockerfile, /ENV NODE_ENV=production/);
  assert.match(dockerfile, /USER 1001:1001/);
  assert.match(dockerfile, /EXPOSE 5001/);
  assert.match(dockerfile, /ENV HOST(?:NAME)?=0\.0\.0\.0/);
  assert.match(dockerfile, /CMD \["node", "src\/server\.js"\]/);
});

test("the migrator retains release assets and Prisma CLI", () => {
  assert.match(dockerfile, /COPY --chown=1001:1001 prisma \.\/prisma/);
  assert.match(dockerfile, /COPY --chown=1001:1001 scripts \.\/scripts/);
  assert.match(dockerfile, /FROM dependencies AS migrator[\s\S]*?USER 1001:1001/);
});

test("the production image cannot receive env files or build-time secrets", () => {
  assert.doesNotMatch(dockerfile, /(?:COPY|ADD)\s+.*(?:^|\/)\.env(?:\b|$)/im);
  assert.doesNotMatch(
    dockerfile,
    /\bENV\s+\w*(?:SECRET|PASSWORD|TOKEN|API_KEY)\w*\s*=?\s*\S/i,
  );
});

test("the backend build context excludes generated output, dependencies, and env files", () => {
  assert.match(dockerignore, /^node_modules\/?$/m);
  assert.match(dockerignore, /^src\/generated\/?$/m);
  assert.match(dockerignore, /^\.env\*$/m);
  assert.match(dockerignore, /^!\.env\.example$/m);
});
