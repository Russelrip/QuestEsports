const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const dockerfile = read("ops/docker/backend.production.Dockerfile");
const dockerignore = read("backend/.dockerignore");

const stage = (name) => {
  const match = dockerfile.match(
    new RegExp(
      `(?:^|\\n)FROM\\s+[^\\n]+\\s+AS\\s+${name}\\b[\\s\\S]*?(?=\\nFROM\\s|$)`,
      "i",
    ),
  );
  assert.ok(match, `expected Dockerfile stage ${name}`);
  return match[0];
};

const dependenciesStage = stage("dependencies");
const productionDependenciesStage = stage("production-dependencies");
const runtimeStage = stage("runtime");
const migratorStage = stage("migrator");

test("the production backend image has immutable runtime and migrator targets", () => {
  assert.match(dependenciesStage, /FROM node:24-bookworm-slim AS dependencies/);
  assert.match(dependenciesStage, /RUN npm ci/);
  assert.match(dependenciesStage, /npx prisma generate/);
  assert.match(productionDependenciesStage, /FROM dependencies AS production-dependencies/);
  assert.match(productionDependenciesStage, /RUN npm prune --omit=dev/);
  assert.match(runtimeStage, /FROM node:24-bookworm-slim AS runtime/);
  assert.match(runtimeStage, /COPY --from=production-dependencies \/app\/node_modules/);
  assert.match(runtimeStage, /COPY --from=dependencies .*src\/generated/);
  assert.match(migratorStage, /FROM dependencies AS migrator/);
});

test("the runtime contract is production-only, non-root, and binds all interfaces", () => {
  assert.match(runtimeStage, /ENV NODE_ENV=production/);
  assert.match(runtimeStage, /USER 1001:1001/);
  assert.match(runtimeStage, /EXPOSE 5001/);
  assert.match(runtimeStage, /CMD \["node", "src\/server\.js"\]/);
  assert.doesNotMatch(runtimeStage, /ENV HOST(?:NAME)?=0\.0\.0\.0/);
  assert.doesNotMatch(runtimeStage, /COPY --chown=1001:1001 prisma \.\/prisma/);
  assert.doesNotMatch(runtimeStage, /COPY --chown=1001:1001 scripts \.\/scripts/);
});

test("the migrator retains release assets and Prisma CLI", () => {
  assert.match(migratorStage, /COPY --chown=1001:1001 prisma \.\/prisma/);
  assert.match(migratorStage, /COPY --chown=1001:1001 scripts \.\/scripts/);
  assert.match(migratorStage, /COPY --from=dependencies .*src\/generated/);
  assert.match(migratorStage, /USER 1001:1001/);
  assert.doesNotMatch(migratorStage, /RUN npm prune --omit=dev/);
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

test("the build context keeps required source modules while excluding credential files", () => {
  assert.ok(
    fs.existsSync(path.join(repoRoot, "backend/src/lib/secret-box.js")),
    "the runtime source requires secret-box.js",
  );
  assert.doesNotMatch(dockerignore, /^\*\*\/\*secret\*\*?\/?$/m);
  assert.doesNotMatch(dockerignore, /^\*\*\/\*secrets\*\*?\/?$/m);
  assert.match(dockerignore, /^\*\*\/\*secret\*\.json$/m);
  assert.match(dockerignore, /^\*\*\/credentials\/$/m);
});

test("the application explicitly preserves the all-interface production bind", () => {
  const server = read("backend/src/server.js");
  assert.match(server, /app\.listen\(env\.PORT, "0\.0\.0\.0"\)/);
});
