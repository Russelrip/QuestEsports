const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const dockerfile = read("ops/docker/backend.production.Dockerfile");
const dockerignore = read("backend/.dockerignore");
const productionCompose = read("ops/docker/compose.production.yml");
const productionEnv = read("ops/docker/quest.production.env.example");
const postgresBootstrap = read("ops/docker/postgres/init/001-bootstrap-roles.sql");
const postgresHealthcheck = read("ops/docker/postgres/healthcheck.sh");

const serviceBlock = (name) => {
  const match = productionCompose.match(
    new RegExp(`(?:^|\\n)  ${name}:[\\s\\S]*?(?=\\n  [a-z-]+:|\\nnetworks:)`),
  );
  assert.ok(match, `expected production Compose service ${name}`);
  return match[0];
};

const dockerIgnoreRegex = (pattern) => {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[\\^$+?.()|{}[\]]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
};

const dockerIgnorePatterns = dockerignore
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => ({
    negated: line.startsWith("!"),
    pattern: line.replace(/^!/, "").replace(/\/$/, ""),
    directory: line.endsWith("/"),
  }));

const isIgnoredByDockerignore = (candidate) => {
  const normalized = candidate.replace(/\\/g, "/");
  let ignored = false;
  for (const { negated, pattern, directory } of dockerIgnorePatterns) {
    const matches = dockerIgnoreRegex(pattern).test(normalized);
    const matchesDescendant = directory && normalized.startsWith(`${pattern}/`);
    if (matches || matchesDescendant) {
      ignored = !negated;
    }
  }
  return ignored;
};

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
  assert.equal(
    isIgnoredByDockerignore("src/lib/secret-box.js"),
    false,
    "required secret-box.js source must be included",
  );
  assert.equal(
    isIgnoredByDockerignore("client-secret.yaml"),
    true,
    "credential-like YAML files must be excluded",
  );
  assert.equal(
    isIgnoredByDockerignore("credentials.txt"),
    true,
    "credential text files must be excluded",
  );
  assert.equal(
    isIgnoredByDockerignore(".env.production"),
    true,
    "filled production env files must be excluded",
  );
  assert.equal(
    isIgnoredByDockerignore(".env.example"),
    false,
    "the committed env template may remain available",
  );
});

test("the application explicitly preserves the all-interface production bind", () => {
  const server = read("backend/src/server.js");
  assert.match(server, /app\.listen\(env\.PORT, "0\.0\.0\.0"\)/);
});

test("production Compose has a fixed project and exact loopback publications", () => {
  assert.match(productionCompose, /^name:\s*quest-prod\s*$/m);
  assert.match(serviceBlock("frontend"), /127\.0\.0\.1:3000:3000/);
  assert.match(serviceBlock("backend"), /127\.0\.0\.1:5001:5001/);
  assert.doesNotMatch(serviceBlock("postgres"), /\bports:/);
  assert.doesNotMatch(productionCompose, /^\s+build:/m);
  assert.doesNotMatch(productionCompose, /-\s+\.{1,2}\//);
  assert.match(productionCompose, /quest-shared:[\s\S]*?name:\s*quest-shared/);
  assert.match(productionCompose, /quest-shared:[\s\S]*?external:\s*true/);
});

test("production Compose uses stable aliases and durable, non-source mounts", () => {
  const backend = serviceBlock("backend");
  const postgres = serviceBlock("postgres");
  assert.match(backend, /aliases:\s*\n\s+- quest-backend/);
  assert.match(postgres, /aliases:\s*\n\s+- quest-postgres/);
  assert.match(backend, /\/srv\/quest-esports\/uploads:\/srv\/quest-esports\/uploads/);
  assert.match(backend, /\/srv\/quest-esports\/private:\/srv\/quest-esports\/private/);
  assert.match(postgres, /\/srv\/quest-esports\/postgres\/17\/data:\/var\/lib\/postgresql\/data/);
  assert.match(postgres, /postgres-healthcheck\.sh:\/usr\/local\/bin\/quest-postgres-healthcheck:ro/);
  assert.match(postgres, /quest-postgres\.crt:\/run\/postgresql\/tls\/server\.crt:ro/);
  assert.match(postgres, /quest-postgres\.key:\/run\/postgresql\/tls\/server\.key:ro/);
  assert.match(productionCompose, /stop_grace_period:\s*40s/);
  assert.match(productionCompose, /read_only:\s*true/);
});

test("every production service has an explicit liveness/readiness healthcheck", () => {
  for (const service of ["frontend", "backend", "postgres"]) {
    assert.match(serviceBlock(service), /healthcheck:/, `${service} healthcheck missing`);
    assert.match(serviceBlock(service), /interval:/, `${service} health interval missing`);
    assert.match(serviceBlock(service), /timeout:/, `${service} health timeout missing`);
  }
  assert.match(serviceBlock("frontend"), /\/health/);
  assert.match(serviceBlock("backend"), /\/api\/health\/ready/);
  assert.match(serviceBlock("postgres"), /quest-postgres-healthcheck/);
});

test("production images are manifest-supplied and digest-oriented", () => {
  for (const variable of ["QUEST_FRONTEND_IMAGE", "QUEST_BACKEND_IMAGE", "POSTGRES_IMAGE"]) {
    assert.match(
      productionCompose,
      new RegExp(`image:\\s*\\$\\{${variable}:\\?`),
      `${variable} must be required from the release manifest`,
    );
  }
  assert.match(productionEnv, /^QUEST_MIGRATOR_IMAGE=$/m);
  assert.match(productionEnv, /^POSTGRES_IMAGE=$/m);
  assert.match(productionCompose, /postgres:17-bookworm@sha256:<digest>/);
  assert.match(productionEnv, /postgres:17-bookworm@sha256:<64-hex-digest>/);
  assert.doesNotMatch(productionCompose, /image:\s*(?:postgres|node|ghcr\.io)[^$\n]*:[\w.-]+\s*$/m);
});

test("PostgreSQL bootstrap and TLS contract keep four roles and schemas separate", () => {
  for (const role of ["quest_runtime", "quest_migrator", "val_runtime", "val_migrator"]) {
    assert.match(postgresBootstrap, new RegExp(`CREATE ROLE ${role} LOGIN`));
  }
  assert.match(postgresBootstrap, /CREATE SCHEMA IF NOT EXISTS valorant AUTHORIZATION val_migrator/);
  assert.match(postgresBootstrap, /ALTER SCHEMA public OWNER TO quest_migrator/);
  assert.match(postgresBootstrap, /ALTER SCHEMA valorant OWNER TO val_migrator/);
  assert.match(postgresBootstrap, /ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator/);
  assert.match(postgresBootstrap, /ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator/);
  assert.doesNotMatch(postgresBootstrap, /PASSWORD\s+'[^']+'/i);
  assert.match(productionCompose, /ssl=on/);
  assert.match(productionCompose, /sslrootcert|ssl_ca_file/);
  assert.match(productionCompose, /ssl_cert_file[\s\S]*server\.crt/);
  assert.match(productionCompose, /ssl_key_file[\s\S]*server\.key/);
  assert.match(postgresHealthcheck, /-checkhost quest-postgres/);
  assert.match(productionEnv, /sslmode=verify-full/);
  assert.match(productionEnv, /sslrootcert=/);
});

test("production environment template contains no credential values", () => {
  for (const line of productionEnv.split("\n")) {
    if (/^(?:AUTH_ENCRYPTION_KEY|SESSION_SECRET|VALORANT_SERVICE_SECRET|POSTGRES_SUPERUSER_PASSWORD)=/.test(line)) {
      assert.equal(line.split("=", 2)[1], "", `${line} must remain blank`);
    }
  }
  assert.match(productionEnv, /^NODE_EXTRA_CA_CERTS=/m);
  assert.match(productionEnv, /^UPLOAD_ROOT=\/srv\/quest-esports\/uploads$/m);
  assert.match(productionEnv, /^PRIVATE_UPLOAD_ROOT=\/srv\/quest-esports\/private$/m);
  assert.match(productionEnv, /^VALORANT_INTERNAL_BASE_URL=https:\/\/valorant-platform:8000$/m);
  assert.match(productionEnv, /^COMPOSE_PROJECT_NAME=quest-prod$/m);
  assert.match(productionEnv, /^QUEST_SHARED_NETWORK=quest-shared$/m);
});
