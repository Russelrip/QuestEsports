const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const repoRoot = path.join(__dirname, "../..");
const read = (relative) =>
  fs.readFileSync(path.join(repoRoot, relative), "utf8").replace(/\r\n/g, "\n");

const dockerfile = read("ops/docker/backend.production.Dockerfile");
const dockerignore = read("backend/.dockerignore");
const productionCompose = read("ops/docker/compose.production.yml");
const stagingCompose = read("ops/docker/compose.postgres-staging.yml");
const productionEnv = read("ops/docker/quest.production.env.example");
const valorantProductionEnv = read("ops/docker/valorant.production.env.example");
const releaseScript = read("ops/deploy/release.sh");
const validateHost = read("ops/deploy/validate-host.sh");
const rollbackScript = read("ops/deploy/rollback.sh");
const cutoverScript = read("ops/deploy/cutover.sh");
const nginxConfigPath = path.join(repoRoot, "ops/docker/nginx/quest.conf");
const nginxConfig = fs.existsSync(nginxConfigPath) ? fs.readFileSync(nginxConfigPath, "utf8").replace(/\r\n/g, "\n") : "";
const verifyRelease = read("ops/deploy/verify-release.sh");
const releaseEnv = read("ops/deploy/release.env.example");
const frontendApi = read("frontend/lib/api.ts");
const ciWorkflow = read(".github/workflows/ci.yml");
const imageWorkflow = read(".github/workflows/build-container-images.yml");
const deployWorkflow = read(".github/workflows/deploy-compose.yml");
const frontendDeployWorkflow = read(".github/workflows/deploy-frontend.yml");
const valorantE2eWorkflow = read(".github/workflows/valorant-e2e.yml");
const imageWorkflowDocument = yaml.load(imageWorkflow);
const deployWorkflowDocument = yaml.load(deployWorkflow);
const ciWorkflowDocument = yaml.load(ciWorkflow);
const postgresBootstrap = read("ops/docker/postgres/init/001-bootstrap-roles.sql");
const postgresHealthcheck = read("ops/docker/postgres/healthcheck.sh");
const questRuntimeRlsMigration = read(
  "backend/prisma/migrations/20260829120000_add_quest_runtime_rls_policies/migration.sql",
);
const databaseSecurityVerifier = read("backend/scripts/verify-database-security.js");
const approvedPostgres17Ref =
  "postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0";
const approvedPostgres16CiRef =
  "postgres:16.15-bookworm@sha256:bb3e1a57e5407e0a5280b4211980a5e537f4abd234a87014ac979849a78dd825";
const approvedPlaywrightRef =
  "mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48";
const approvedAlpine322Ref =
  "alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce";
const approvedValorantPlatformRef = "e8a8f056a52fcbfb08e453bc6b51723c7b4b949c";
const approvedCosignImage =
  "ghcr.io/sigstore/cosign/cosign:v2.4.1@sha256:b03690aa52bfe94054187142fba24dc54137650682810633901767d8a3e15b31";

const composeImageFixtures = {
  QUEST_FRONTEND_IMAGE:
    "ghcr.io/questesports/quest-frontend@sha256:" + "a".repeat(64),
  QUEST_BACKEND_IMAGE:
    "ghcr.io/questesports/quest-backend@sha256:" + "b".repeat(64),
  QUEST_MIGRATOR_IMAGE:
    "ghcr.io/questesports/quest-migrator@sha256:" + "c".repeat(64),
  POSTGRES_IMAGE:
    "postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0",
  VALORANT_IMAGE:
    "ghcr.io/valorant/valorant-platform@sha256:" + "d".repeat(64),
};

const renderComposeImages = (source) =>
  source.replace(
    /\$\{([A-Z_]+):\?[^}]+\}/g,
    (_, variable) => composeImageFixtures[variable] || "",
  );

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const unquote = (value) => {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const sectionLines = (source, name) => {
  const lines = source.split("\n");
  const header = lines.findIndex((line) => /^ {4}\S/.test(line) && line.trim() === `${name}:`);
  if (header === -1) return [];

  const section = [];
  for (const line of lines.slice(header + 1)) {
    if (line.trim() && line.match(/^\s*/)[0].length <= 4) break;
    section.push(line);
  }
  return section;
};

const listRecords = (lines) => {
  const records = [];
  for (const line of lines) {
    const match = line.match(/^\s*-\s*(.*)$/);
    if (match) records.push([match[1]]);
    else if (records.length > 0 && line.trim()) records.at(-1).push(line.trim());
  }
  return records;
};

const mappingFields = (record) => {
  const fields = {};
  for (const line of record) {
    const match = line.match(/^(?:["']([^"']+)["']|([A-Za-z_][A-Za-z0-9_]*))\s*:\s*(.*?)\s*$/);
    if (match) fields[match[1] || match[2]] = unquote(match[3]);
  }
  return fields;
};

const serviceBlock = (name) => serviceBlockFrom(productionCompose, name);

const serviceBlockFrom = (source, name) => {
  const match = source.match(
    new RegExp(`(?:^|\\n)  ${name}:[\\s\\S]*?(?=\\n  [a-z-]+:|\\nnetworks:)`),
  );
  assert.ok(match, `expected Compose service ${name}`);
  return match[0];
};

const networkNames = (source) => {
  const lines = sectionLines(source, "networks");
  assert.ok(lines.length > 0, "expected Compose network section");
  const names = [];
  for (const line of lines) {
    if (line.match(/^\s*/)[0].length !== 6) continue;
    const mapping = line.trim().match(/^(?:["']([^"']+)["']|([^:\s]+))\s*:/);
    const list = line.trim().match(/^[-]\s*(.+)$/);
    if (mapping) names.push(mapping[1] || mapping[2]);
    else if (list) names.push(unquote(list[1]));
  }
  return names;
};

const serviceNetworks = (name) => networkNames(serviceBlock(name));

const serviceNetworksFrom = (source) => networkNames(`\n  fixture:\n${source}`);

const portMapping = (value) => {
  const candidate = unquote(value);
  const match = candidate.match(
    /^(\[[^\]]+\]|[^:/]+):(\d+):(\d+)(?:\/([A-Za-z0-9]+))?$/,
  );
  if (!match) return `invalid-port:${candidate}`;
  const mapping = `${match[1]}:${match[2]}:${match[3]}`;
  return match[4] && match[4].toLowerCase() !== "tcp"
    ? `${mapping}/${match[4]}`
    : mapping;
};

const publishedPorts = (source) => {
  return listRecords(sectionLines(source, "ports")).map((record) => {
    const first = record[0];
    if (/^(?:["'](?:target|published|host_ip|protocol)["']|(?:target|published|host_ip|protocol))\s*:/.test(first)) {
      const fields = mappingFields(record);
      const allowed = new Set(["target", "published", "host_ip", "protocol"]);
      if (Object.keys(fields).some((field) => !allowed.has(field))) {
        return `invalid-port-record:${record.join(" ")}`;
      }
      if (!fields.target || !fields.published || !fields.host_ip) {
        return `invalid-port-record:${record.join(" ")}`;
      }
      return portMapping(
        `${fields.host_ip}:${fields.published}:${fields.target}${
          fields.protocol ? `/${fields.protocol}` : ""
        }`,
      );
    }
    return portMapping(first);
  });
};

const invalidMount = (value) => ({ invalid: value });

const parseShortMount = (value) => {
  const parts = unquote(value).split(":");
  if (parts.length < 2 || parts.length > 3) return invalidMount(value);
  const [source, target, mode = ""] = parts;
  if (mode && mode !== "ro" && mode !== "rw") return invalidMount(value);
  return { source, target, type: "bind", read_only: mode === "ro" };
};

const mountRecords = (source) =>
  listRecords(sectionLines(source, "volumes")).map((record) => {
    if (record.length === 1 && !/^(?:["']?(?:type|source|target|read_only)["']?)\s*:/.test(record[0])) {
      return parseShortMount(record[0]);
    }

    const fields = mappingFields(record);
    const allowed = new Set(["type", "source", "target", "read_only"]);
    if (Object.keys(fields).some((field) => !allowed.has(field))) {
      return invalidMount(record.join(" "));
    }
    if (!fields.type || !fields.source || !fields.target) {
      return invalidMount(record.join(" "));
    }
    if (fields.read_only && !["true", "false"].includes(fields.read_only)) {
      return invalidMount(record.join(" "));
    }
    return {
      source: fields.source,
      target: fields.target,
      type: fields.type,
      read_only: fields.read_only === "true",
    };
  });

const sortedRecords = (records) =>
  records.map((record) => JSON.stringify(record)).sort().map((record) => JSON.parse(record));

const expectedMountsByService = {
  frontend: [],
  backend: [
    {
      source: "/etc/quest-esports/tls/quest-private-ca.crt",
      target: "/run/secrets/quest-private-ca.crt",
      type: "bind",
      read_only: true,
    },
    {
      source: "/srv/quest-esports/private",
      target: "/srv/quest-esports/private",
      type: "bind",
      read_only: false,
    },
    {
      source: "/srv/quest-esports/uploads",
      target: "/srv/quest-esports/uploads",
      type: "bind",
      read_only: false,
    },
  ],
  postgres: [
    {
      source: "/etc/quest-esports/postgres-healthcheck.sh",
      target: "/usr/local/bin/quest-postgres-healthcheck",
      type: "bind",
      read_only: true,
    },
    {
      source: "/etc/quest-esports/secrets/postgres-admin-password",
      target: "/run/secrets/postgres-admin-password",
      type: "bind",
      read_only: true,
    },
    {
      source: "/etc/quest-esports/tls/quest-postgres.crt",
      target: "/run/postgresql/tls/server.crt",
      type: "bind",
      read_only: true,
    },
    {
      source: "/etc/quest-esports/tls/quest-postgres.key",
      target: "/run/postgresql/tls/server.key",
      type: "bind",
      read_only: true,
    },
    {
      source: "/etc/quest-esports/tls/quest-private-ca.crt",
      target: "/run/postgresql/tls/ca.crt",
      type: "bind",
      read_only: true,
    },
    {
      source: "/srv/quest-esports/postgres/17/data",
      target: "/var/lib/postgresql/data",
      type: "bind",
      read_only: false,
    },
    {
      source: "/srv/quest-esports/postgres/init",
      target: "/docker-entrypoint-initdb.d",
      type: "bind",
      read_only: true,
    },
  ],
};

const normalizedMountsByService = (source) =>
  Object.fromEntries(
    Object.keys(expectedMountsByService).map((service) => [
      service,
      sortedRecords(mountRecords(serviceBlockFrom(source, service))),
    ]),
  );

const normalizedExpectedMountsByService = Object.fromEntries(
  Object.entries(expectedMountsByService).map(([service, mounts]) => [service, sortedRecords(mounts)]),
);

const dockerFixture = (() => {
  const version = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
  });
  if (version.error || version.status !== 0) {
    return { skip: "Docker daemon/CLI unavailable for the certificate healthcheck fixture" };
  }
  const image = spawnSync("docker", ["image", "inspect", approvedPostgres17Ref], {
    encoding: "utf8",
  });
  if (image.error || image.status !== 0) {
    return { skip: "local postgres:17-bookworm image unavailable for the certificate healthcheck fixture" };
  }
  return { skip: false };
})();

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
  const allPublishedPorts = ["frontend", "backend", "postgres"].flatMap((service) =>
    publishedPorts(serviceBlock(service)),
  );
  assert.deepEqual(allPublishedPorts, [
    "127.0.0.1:3000:3000",
    "127.0.0.1:5001:5001",
  ]);
  assert.deepEqual(publishedPorts(serviceBlock("frontend")), ["127.0.0.1:3000:3000"]);
  assert.deepEqual(publishedPorts(serviceBlock("backend")), ["127.0.0.1:5001:5001"]);
  assert.deepEqual(publishedPorts(serviceBlock("postgres")), []);
  assert.doesNotMatch(serviceBlock("postgres"), /\bports:/);
  assert.doesNotMatch(productionCompose, /^\s+build:/m);
  assert.doesNotMatch(productionCompose, /-\s+\.{1,2}\//);
  assert.match(productionCompose, /quest-shared:[\s\S]*?name:\s*quest-shared/);
  assert.match(productionCompose, /quest-shared:[\s\S]*?external:\s*true/);
});

test("production and staging Compose render the private PostgreSQL topology", () => {
  const renderedProductionCompose = renderComposeImages(productionCompose);
  assert.match(renderedProductionCompose, /name:\s+quest-prod/);
  assert.match(
    productionCompose,
    /postgres:\s*\n(?:.|\n)*image:\s*\$\{POSTGRES_IMAGE/,
  );
  assert.doesNotMatch(serviceBlock("postgres"), /\bports:/);
  assert.match(
    stagingCompose,
    /127\.0\.0\.1:\$\{POSTGRES_STAGING_HOST_PORT:-55432\}:5432/,
  );
  assert.match(stagingCompose, /services:\s*\n\s+postgres:/);

  // Rendered image assertions prove the required variables are replaced in
  // the Compose fixture rather than merely repeating expected constants.
  for (const image of [
    composeImageFixtures.QUEST_FRONTEND_IMAGE,
    composeImageFixtures.QUEST_BACKEND_IMAGE,
    composeImageFixtures.POSTGRES_IMAGE,
  ]) {
    assert.match(renderedProductionCompose, new RegExp(`image:\\s*${escapeRegExp(image)}`));
  }

  const stagingPortMappings = [...stagingCompose.matchAll(/^\s+-\s+"([^"]+)"\s*$/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(stagingPortMappings, [
    "127.0.0.1:${POSTGRES_STAGING_HOST_PORT:-55432}:5432",
  ]);
});

test("production backend receives mandatory runtime configuration", () => {
  const backend = serviceBlock("backend");
  assert.match(backend, /env_file:[\s\S]*required:\s*true/);
  assert.doesNotMatch(backend, /required:\s*false/);
});

test("frontend has deliberate outbound and cache behavior", () => {
  const frontend = serviceBlock("frontend");
  assert.match(frontend, /NEXT_TELEMETRY_DISABLED:\s*["']?1["']?/);
  assert.match(frontend, /tmpfs:[\s\S]*\/app\/\.next\/cache/);
  assert.doesNotMatch(frontend, /network_mode:\s*none/);
  assert.deepEqual(serviceNetworks("frontend"), ["app"]);
});

test("host verification requires exact image identity and Cosign verification", () => {
  assert.match(verifyRelease, /COSIGN_BIN/);
  assert.match(verifyRelease, /COSIGN_CERTIFICATE_IDENTITY_REGEXP/);
  assert.match(verifyRelease, /COSIGN_OIDC_ISSUER/);
  assert.match(verifyRelease, /cosign verify|COSIGN_BIN[\s\S]*?verify/);
  assert.match(verifyRelease, /APPROVED_REF/);
  assert.match(verifyRelease, /POSTGRES_IMAGE.*postgres:17-bookworm@sha256/);
});

test("artifact trust scopes Cosign to Quest images and uses exact external references", () => {
  const approvedPostgresRef =
    "postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0";
  const rejectedPostgresRef =
    "postgres:17@sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675";
  for (const source of [imageWorkflow, deployWorkflow, releaseScript, validateHost, rollbackScript, cutoverScript, verifyRelease]) {
    assert.match(source, new RegExp(escapeRegExp(approvedPostgresRef)));
    assert.doesNotMatch(source, new RegExp(escapeRegExp(rejectedPostgresRef)));
  }
  assert.match(imageWorkflow, /POSTGRES_17_BOOKWORM_DIGEST.*approved_postgres_ref/);
  assert.match(deployWorkflow, /test \"\$postgres_image\" = \"\$approved_postgres_ref\"/);
  assert.match(validateHost, /manifest\[postgres_image\].*approved_postgres_ref/);
  assert.doesNotMatch(validateHost, /POSTGRES_COSIGN|VALORANT_COSIGN/);
  assert.doesNotMatch(verifyRelease, /POSTGRES_COSIGN|VALORANT_COSIGN/);
  assert.doesNotMatch(releaseEnv, /^(?:POSTGRES|VALORANT)_COSIGN_/m);
  assert.doesNotMatch(validateHost, /for key in frontend_image backend_image migrator_image postgres_image valorant_image/);
  assert.match(validateHost, /for key in frontend_image backend_image migrator_image; do/);
  assert.match(verifyRelease, /POSTGRES_IMAGE\).*unapproved PostgreSQL image/);

  const assignment = (name) => {
    const match = releaseEnv.match(new RegExp(`^${name}=(.*)$`, "m"));
    assert.ok(match, `${name} must be documented`);
    return match[1];
  };
  assert.equal(assignment("QUEST_COSIGN_OIDC_ISSUER"), "https://token.actions.githubusercontent.com");
  assert.equal(assignment("POSTGRES_IMAGE_APPROVED_REF"), approvedPostgresRef);
  const questSigningStep = imageWorkflow.match(
    /Sign each Quest image digest with keyless OIDC[\s\S]*?(?=\n\s*- name:|$)/,
  )?.[0] || "";
  assert.doesNotMatch(
    questSigningStep,
    /valorant_image|VALORANT_IMAGE/,
    "the Quest workflow signing loop must not sign VALORANT with Quest policy",
  );
  assert.match(imageWorkflow, /VALORANT_IMAGE_APPROVED_REF/);
});

test("workflow image trust contracts respect step boundaries and Quest-only deploy verification", () => {
  const buildSteps = imageWorkflowDocument.jobs.build.steps;
  const validateInputs = buildSteps.find((step) => step.name === "Validate release inputs");
  const writeManifest = buildSteps.find((step) => step.name === "Write the exact release manifest");
  assert.ok(validateInputs?.run && writeManifest?.run, "expected release input and manifest steps");

  const postgresAssignment = /(^|\n)\s*approved_postgres_ref='postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0'\s*($|\n)/;
  for (const step of [validateInputs, writeManifest]) {
    const assignment = step.run.search(postgresAssignment);
    const firstUse = step.run.indexOf("$approved_postgres_ref");
    assert.ok(assignment >= 0, `${step.name} must define the PostgreSQL reference in its own shell`);
    assert.ok(firstUse > assignment, `${step.name} must define the reference before using it`);
  }

  const deploySteps = deployWorkflowDocument.jobs.deploy.steps;
  const trustStep = deploySteps.find((step) => step.name === "Verify Quest signatures and BuildKit attestations");
  assert.ok(trustStep?.run, "expected deploy-time image trust step");
  const imageList = trustStep.run.match(/done <<'IMAGES'\n([\s\S]*?)\n\s*IMAGES/);
  assert.ok(imageList, "deploy-time Cosign verification must use a structured image list");
  assert.deepEqual(
    imageList[1].split("\n").map((line) => line.trim()).filter(Boolean),
    ["frontend_image", "backend_image", "migrator_image"],
  );
  assert.match(trustStep.run, /while IFS= read -r image_key; do/);
  assert.equal((trustStep.run.match(/"\$COSIGN_IMAGE" verify/g) || []).length, 1);
  assert.doesNotMatch(trustStep.run, /postgres|valorant/i, "external images must not enter Quest Cosign verification");
});

test("immutable image CI binds successful repository CI and publishes all signed Quest digests", () => {
  assert.match(
    imageWorkflow,
    /workflow_run\.conclusion == 'success'[\s\S]*workflow_run\.event == 'push'[\s\S]*workflow_run\.head_branch == 'main'/,
  );
  assert.match(imageWorkflow, /workflow_run\.head_repository\.full_name == github\.repository/);
  assert.match(imageWorkflow, /RELEASE_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(imageWorkflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(imageWorkflow, /checked_out_sha="\$\(git rev-parse --verify HEAD\)"/);
  assert.match(imageWorkflow, /\[\[ "\$checked_out_sha" == "\$RELEASE_SHA" \]\]/);
  assert.match(
    imageWorkflow,
    /name: container-release-manifest-\$\{\{ github\.event\.workflow_run\.id \}\}-\$\{\{ github\.event\.workflow_run\.head_sha \}\}/,
  );
  assert.match(
    imageWorkflow,
    /^permissions:\n  contents: read\n  packages: write\n  id-token: write$/m,
  );
  assert.doesNotMatch(imageWorkflow, /^\s+attestations:\s+write$/m);

  for (const image of ["quest-frontend", "quest-backend", "quest-migrator"]) {
    assert.match(imageWorkflow, new RegExp(`ghcr\.io/\\$\\{\\{ github\.repository_owner \\}\\}/${image}`));
  }
  assert.equal((imageWorkflow.match(/--provenance=mode=max/g) || []).length, 3);
  assert.equal((imageWorkflow.match(/builder-id=https:\/\/github\.com\/Russelrip\/QuestEsports\/\.github\/workflows\/build-container-images\.yml@refs\/heads\/main/g) || []).length, 3);
  assert.equal(
    (imageWorkflow.match(/--provenance=mode=max,builder-id=https:\/\/github\.com\/Russelrip\/QuestEsports\/\.github\/workflows\/build-container-images\.yml@refs\/heads\/main/g) || []).length,
    3,
  );
  assert.equal((imageWorkflow.match(/--sbom=true/g) || []).length, 3);
  assert.match(imageWorkflow, /containerimage\.digest.*sha256:\[0-9a-f\]\{64\}/);
  assert.match(imageWorkflow, /Sign each Quest image digest with keyless OIDC/);
  assert.match(
    imageWorkflow,
    /docker run --rm --pull=never --network host[\s\S]*"\$COSIGN_IMAGE" sign --yes "\$image_reference"/,
  );
  assert.ok(
    imageWorkflow.includes('name: Prepare Cosign GHCR credentials') &&
      imageWorkflow.includes('cosign_docker_config="$RUNNER_TEMP/cosign-docker"') &&
      imageWorkflow.includes('docker --config "$cosign_docker_config" login ghcr.io'),
    "Cosign must prepare a dedicated GHCR Docker config",
  );
  assert.ok(
    imageWorkflow.includes("-e DOCKER_CONFIG=/tmp/cosign-home/.docker") &&
      imageWorkflow.includes('-v "$RUNNER_TEMP/cosign-docker:/tmp/cosign-home/.docker:ro"'),
    "Cosign must use the dedicated Docker config inside the container",
  );
  assert.match(imageWorkflow, /printf 'frontend_image=%s@%s\\n' "\$IMAGE" "\$digest"/);
  assert.match(imageWorkflow, /printf 'backend_image=%s@%s\\n' "\$IMAGE" "\$digest"/);
  assert.match(imageWorkflow, /printf 'migrator_image=%s@%s\\n' "\$IMAGE" "\$digest"/);

  const buildArgs = [...imageWorkflow.matchAll(/--build-arg ([^\n]+)/g)].map((match) => match[1]);
  const buildArgNames = buildArgs.map((argument) => argument.match(/^"?([A-Z][A-Z0-9_]*)=/)?.[1]);
  const allowedBuildArgNames = new Set([
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_SITE_URL",
    "QUEST_BUILD_REVISION",
    "QUEST_BUILD_REPOSITORY",
    "QUEST_BUILD_BRANCH",
    "QUEST_BUILD_WORKFLOW",
  ]);
  assert.ok(buildArgNames.every(Boolean), buildArgNames);
  assert.ok(buildArgNames.every((name) => allowedBuildArgNames.has(name)), buildArgNames);
  assert.equal(new Set(buildArgNames).size, allowedBuildArgNames.size);
  assert.deepEqual([...new Set(buildArgNames)].sort(), [...allowedBuildArgNames].sort());
  assert.doesNotMatch(
    imageWorkflow,
    /--build-arg\s+"?[A-Z][A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY)[A-Z0-9_]*=/i,
  );
});

test("Compose deployment consumes only a protected, successful, signed digest release", () => {
  assert.match(deployWorkflow, /^permissions:\n  actions: read\n  contents: read\n  packages: read$/m);
  assert.match(deployWorkflow, /environment: production-compose/);
  assert.match(deployWorkflow, /gh api "repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$build_run_id"/);
  assert.match(deployWorkflow, /actions\/workflows\/build-container-images\.yml/);
  assert.match(deployWorkflow, /\.workflow_id \| tostring/);
  assert.match(deployWorkflow, /actions\/runs\/\$build_run_id\/artifacts\?per_page=100/);
  assert.match(deployWorkflow, /container-release-manifest-\[0-9\]\+\-\[0-9a-f\]\{40\}/);
  assert.match(deployWorkflow, /ci_run_id="\$\{BASH_REMATCH\[1\]\}"/);
  assert.match(deployWorkflow, /release_sha="\$\{BASH_REMATCH\[2\]\}"/);
  assert.match(deployWorkflow, /\.name.*Build container images/);
  assert.match(deployWorkflow, /conclusion.*success/);
  assert.match(deployWorkflow, /event.*workflow_run/);
  assert.match(deployWorkflow, /head_branch.*main/);
  assert.match(deployWorkflow, /head_repository\.full_name/);
  assert.match(deployWorkflow, /head_sha.*ci_run_json/);
  assert.match(deployWorkflow, /name: \$\{\{ needs\.resolve-build\.outputs\.artifact_name \}\}/);
  assert.match(deployWorkflow, /run-id: \$\{\{ needs\.resolve-build\.outputs\.build_run_id \}\}/);
  assert.match(deployWorkflow, /actions\/workflows\/ci\.yml/);
  assert.match(deployWorkflow, /\.name.*CI/);
  assert.match(
    deployWorkflow,
    /COSIGN_CERTIFICATE_IDENTITY: https:\/\/github\.com\/Russelrip\/QuestEsports\/.github\/workflows\/build-container-images\.yml@refs\/heads\/main/,
  );
  assert.match(deployWorkflow, /COSIGN_OIDC_ISSUER: https:\/\/token\.actions\.githubusercontent\.com/);
  assert.match(deployWorkflow, /"\$COSIGN_IMAGE" verify/);
  assert.match(deployWorkflow, /verify_buildkit_attestations/);
  assert.match(deployWorkflow, /get\(predicate, \('builder', 'id'\)\)/);
  assert.match(deployWorkflow, /get\(predicate, \('runDetails', 'builder', 'id'\)\)/);
  assert.match(deployWorkflow, /https:\/\/spdx\.dev\/Document/);
  assert.match(deployWorkflow, /https:\/\/slsa\.dev\/provenance\/v1/);
  assert.match(deployWorkflow, /quest-frontend@sha256/);
  assert.match(deployWorkflow, /quest-backend@sha256/);
  assert.match(deployWorkflow, /quest-migrator@sha256/);
  assert.match(deployWorkflow, /POSTGRES_IMAGE_APPROVED_REF/);
  assert.match(deployWorkflow, /VALORANT_IMAGE_APPROVED_REF/);
  const composeTransferStep = deployWorkflow.match(
    /- name: Transfer the verified manifest and invoke the fixed root release script[\s\S]*?(?=\n      - name:)/,
  )?.[0] || "";
  assert.match(
    composeTransferStep,
    /timeout --foreground 120s ssh "\$\{ssh_options\[@\]\}" -p "\$SSH_PORT" -- "deploy@\$SSH_HOST" sudo -n -- \/usr\/local\/sbin\/quest-esports-release "\$RELEASE_SHA" "\$remote_manifest"/,
  );
  assert.match(composeTransferStep, /ssh_options=\(/);
  assert.match(composeTransferStep, /-- "deploy@\$SSH_HOST" sudo -n -- \/usr\/local\/sbin\/quest-esports-release/);
  assert.doesNotMatch(composeTransferStep, /bash\s+-c|sh\s+-c|eval\b|remote_command/);
  assert.doesNotMatch(composeTransferStep, /sudo -n -- \/usr\/local\/sbin\/quest-esports-release '\$/);
  assert.doesNotMatch(deployWorkflow, /:latest/);
  assert.doesNotMatch(deployWorkflow, /npm ci|\bpm2\b|docker group/);
  const shellSecretOutputLines = deployWorkflow
    .split("\n")
    .filter((line) => /(?:printf|echo)[^\n]*SSH_(?:PRIVATE_KEY|HOST_KEY)/.test(line))
    .filter((line) => !line.includes(">"));
  assert.deepEqual(shellSecretOutputLines, [], "SSH secrets must only be written to files, never printed");
});

test("deployment rejects a downstream build SHA that differs from its upstream CI artifact SHA", () => {
  const downstreamBuildSha = "a".repeat(40);
  const upstreamCiSha = "b".repeat(40);
  const artifactName = `container-release-manifest-123456-${upstreamCiSha}`;
  const artifactBinding = artifactName.match(/^container-release-manifest-([0-9]+)-([0-9a-f]{40})$/);
  assert.ok(artifactBinding, "the fixture artifact must carry an upstream run ID and full SHA");
  assert.notEqual(downstreamBuildSha, artifactBinding[2]);
  assert.match(deployWorkflow, /\.head_sha.*ci_run_json/);
  assert.match(deployWorkflow, /\.head_sha.*release_sha/);
  assert.match(deployWorkflow, /artifact_name/);
});

test("frontend SSR selects an explicit internal API origin while browsers keep the public origin", () => {
  const frontend = serviceBlock("frontend");
  const frontendCiJob = ciWorkflow.match(/(?:^|\n)  frontend:[\s\S]*?(?=\n  [a-z-]+:|$)/)?.[0] || "";
  assert.match(
    frontend,
    /(?:INTERNAL_API_URL|SERVER_API_URL|API_INTERNAL_ORIGIN):\s*["']?https?:\/\/(?:backend|quest-backend):\d+/,
    "frontend Compose must provide the server-only backend origin consumed by the SSR helper",
  );
  assert.match(
    frontendApi,
    /(?:INTERNAL_API_URL|SERVER_API_URL|API_INTERNAL_ORIGIN)/,
    "frontend/lib/api.ts must consume an explicit server-only backend origin",
  );
  assert.match(
    frontendApi,
    /typeof window\s*===\s*["']undefined["'][\s\S]{0,500}(?:INTERNAL_API_URL|SERVER_API_URL|API_INTERNAL_ORIGIN)/,
    "server-side URL selection must use the internal backend origin",
  );
  assert.match(
    frontendApi,
    /typeof window[\s\S]{0,500}NEXT_PUBLIC_API_URL|NEXT_PUBLIC_API_URL[\s\S]{0,500}typeof window/,
    "browser URL selection must remain based on the public API origin",
  );
  assert.match(
    frontendCiJob,
    /^\s+INTERNAL_API_URL:\s*http:\/\/127\.0\.0\.1:5011\s*$/m,
    "frontend CI must provide the server-only backend origin for SSR requests",
  );
});

test("deployment contracts bind production environment, both schemas, and both writer groups", () => {
  assert.match(releaseEnv, /^RELEASE_ENVIRONMENT=production$/m);
  assert.match(releaseEnv, /^RELEASE_ENVIRONMENT_PROTECTED=1$/m);
  assert.match(verifyRelease, /database_schemas/);
  assert.match(verifyRelease, /public,valorant/);
  assert.match(verifyRelease, /writer_groups/);
  assert.match(verifyRelease, /quest,valorant/);
  assert.match(read("ops/deploy/release.sh"), /OLD_VALORANT_REBOOT_PERSISTENCE_CHECK/);
  assert.match(read("ops/deploy/cutover.sh"), /OLD_QUEST_REBOOT_PERSISTENCE_CHECK/);
  assert.match(read("ops/deploy/rollback.sh"), /recovery-evidence\.txt/);
});

test("Nginx keeps public ingress on loopback and preserves SSE", () => {
  assert.ok(nginxConfig, "production Nginx configuration is required");
  assert.match(nginxConfig, /proxy_pass\s+http:\/\/127\.0\.0\.1:3000/);
  assert.match(nginxConfig, /proxy_pass\s+http:\/\/127\.0\.0\.1:5001/);
  assert.match(nginxConfig, /proxy_buffering\s+off/);
  assert.match(nginxConfig, /proxy_read_timeout\s+(?:[3-9][0-9]|[1-9][0-9]{2,})s/);
  assert.match(nginxConfig, /proxy_send_timeout\s+(?:[3-9][0-9]|[1-9][0-9]{2,})s/);
  assert.doesNotMatch(nginxConfig, /private|\/srv\/quest-esports/);
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
  assert.deepEqual(
    normalizedMountsByService(productionCompose),
    normalizedExpectedMountsByService,
    "mount source, target, type, and read-only contracts must match per service",
  );
  const actualMounts = ["frontend", "backend", "postgres"].flatMap((service) =>
    mountRecords(serviceBlock(service)),
  );
  assert.deepEqual(
    sortedRecords(actualMounts),
    [
      {
        source: "/etc/quest-esports/postgres-healthcheck.sh",
        target: "/usr/local/bin/quest-postgres-healthcheck",
        type: "bind",
        read_only: true,
      },
      {
        source: "/etc/quest-esports/secrets/postgres-admin-password",
        target: "/run/secrets/postgres-admin-password",
        type: "bind",
        read_only: true,
      },
      {
        source: "/etc/quest-esports/tls/quest-postgres.crt",
        target: "/run/postgresql/tls/server.crt",
        type: "bind",
        read_only: true,
      },
      {
        source: "/etc/quest-esports/tls/quest-postgres.key",
        target: "/run/postgresql/tls/server.key",
        type: "bind",
        read_only: true,
      },
      {
        source: "/etc/quest-esports/tls/quest-private-ca.crt",
        target: "/run/secrets/quest-private-ca.crt",
        type: "bind",
        read_only: true,
      },
      {
        source: "/etc/quest-esports/tls/quest-private-ca.crt",
        target: "/run/postgresql/tls/ca.crt",
        type: "bind",
        read_only: true,
      },
      {
        source: "/srv/quest-esports/postgres/17/data",
        target: "/var/lib/postgresql/data",
        type: "bind",
        read_only: false,
      },
      {
        source: "/srv/quest-esports/postgres/init",
        target: "/docker-entrypoint-initdb.d",
        type: "bind",
        read_only: true,
      },
      {
        source: "/srv/quest-esports/private",
        target: "/srv/quest-esports/private",
        type: "bind",
        read_only: false,
      },
      {
        source: "/srv/quest-esports/uploads",
        target: "/srv/quest-esports/uploads",
        type: "bind",
        read_only: false,
      },
    ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    "mount source, target, type, and read-only contracts must be exact",
  );
  assert.match(productionCompose, /stop_grace_period:\s*40s/);
  assert.match(productionCompose, /read_only:\s*true/);
});

test("production services have exactly the required network memberships", () => {
  assert.deepEqual(serviceNetworks("frontend"), ["app"]);
  assert.deepEqual(serviceNetworks("backend"), ["app", "database", "quest-shared"]);
  assert.deepEqual(serviceNetworks("postgres"), ["database", "quest-shared"]);
  assert.match(productionCompose, /app:\s*\n\s+internal:\s*true/);
  assert.match(productionCompose, /database:\s*\n\s+internal:\s*true/);
});

test("contract parsers accept valid Compose short/long port and mount forms", () => {
  assert.deepEqual(
    publishedPorts(`
    ports:
      - 127.0.0.1:3000:3000/tcp
      - "127.0.0.1:5001:5001"
`),
    ["127.0.0.1:3000:3000", "127.0.0.1:5001:5001"],
  );
  assert.deepEqual(
    publishedPorts(`
    ports:
      - target: 3000
        published: "3000"
        host_ip: 127.0.0.1
        protocol: tcp
`),
    ["127.0.0.1:3000:3000"],
  );
  assert.deepEqual(
    mountRecords(`
    volumes:
      - "/srv/quest-esports/uploads:/srv/quest-esports/uploads"
      - type: bind
        source: /srv/quest-esports/private
        target: /srv/quest-esports/private
        read_only: false
`),
    [
      {
        source: "/srv/quest-esports/uploads",
        target: "/srv/quest-esports/uploads",
        type: "bind",
        read_only: false,
      },
      {
        source: "/srv/quest-esports/private",
        target: "/srv/quest-esports/private",
        type: "bind",
        read_only: false,
      },
    ],
  );
});

test("contract parsers do not ignore alternate published-port representations", () => {
  const ports = publishedPorts(`
    ports:
      - 127.0.0.1:3000:3000
      - "0.0.0.0:5001:5001"
      - 192.0.2.10:6000:6000
      - 127.0.0.1:7000:7000/udp
      - "[::1]:8000:8000"
      - target: 9000
        published: 9000
      - target: 9100
        published: 9100
        host_ip: 127.0.0.1
        protocol: udp
`);
  assert.equal(ports.length, 7);
  assert.deepEqual(ports.slice(0, 2), ["127.0.0.1:3000:3000", "0.0.0.0:5001:5001"]);
  assert.notDeepEqual(ports, ["127.0.0.1:3000:3000", "127.0.0.1:5001:5001"]);
  assert.ok(ports.some((port) => port.startsWith("invalid-port-record:")));
  assert.ok(ports.some((port) => port.includes("/udp")));
  assert.ok(ports.some((port) => port.includes("[::1]")));
});

test("contract parser rejects unapproved long-form port auxiliary fields", () => {
  const ports = publishedPorts(`
    ports:
      - target: 3000
        published: 3000
        host_ip: 127.0.0.1
        protocol: tcp
        mode: host
      - target: 3001
        published: 3001
        host_ip: 127.0.0.1
        protocol: tcp
        name: unexpected-port
      - target: 3002
        published: 3002
        host_ip: 127.0.0.1
        protocol: tcp
        app_protocol: http
  `);
  assert.equal(ports.length, 3);
  assert.ok(ports.every((port) => port.startsWith("invalid-port-record:")));
});

test("mount contract rejects unapproved quoted, long-form, relative, named, and variable sources", () => {
  const mounts = mountRecords(`
    volumes:
      - "/srv/quest-esports/uploads:/srv/quest-esports/uploads:ro"
      - type: volume
        source: named-volume
        target: /srv/quest-esports/private
        read_only: false
      - type: bind
        source: ./private
        target: /srv/quest-esports/private
        read_only: false
      - type: bind
        source: \${PRIVATE_ROOT}
        target: /srv/quest-esports/private
        read_only: false
      - type: bind
        source: /srv/quest-esports/private
        target: /srv/quest-esports/private
        read_only: true
`);
  assert.equal(mounts.length, 5);
  assert.notDeepEqual(mounts, [
    {
      source: "/srv/quest-esports/uploads",
      target: "/srv/quest-esports/uploads",
      type: "bind",
      read_only: false,
    },
  ]);
  assert.ok(mounts.some((mount) => mount.type === "volume"));
  assert.ok(mounts.some((mount) => mount.source === "./private"));
  assert.ok(mounts.some((mount) => mount.source === "${PRIVATE_ROOT}"));
  assert.ok(mounts.some((mount) => mount.read_only === true));
});

test("mount contract rejects mounts swapped between services", () => {
  const swapped = `
  backend:
    volumes:
      - /srv/quest-esports/postgres/17/data:/var/lib/postgresql/data
  postgres:
    volumes:
      - /srv/quest-esports/uploads:/srv/quest-esports/uploads
  networks:
`;
  assert.throws(
    () => assert.deepEqual(normalizedMountsByService(swapped), normalizedExpectedMountsByService),
    assert.AssertionError,
  );
});

test("network parser retains quoted and otherwise valid network keys", () => {
  assert.deepEqual(
    serviceNetworksFrom(`
    networks:
      "app": {}
      quest-shared: {}
      "unexpected-network": {}
`),
    ["app", "quest-shared", "unexpected-network"],
  );
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
  assert.match(postgresHealthcheck, /^#!\/bin\/sh/);
});

test(
  "the PostgreSQL healthcheck passes SAN certificates and rejects CN-only certificates",
  { skip: dockerFixture.skip || false },
  () => {
    const scriptPath = path.join(repoRoot, "ops/docker/postgres/healthcheck.sh");
    const scriptMount = `${scriptPath.replace(/\\/g, "/")}:/fixture/healthcheck.sh:ro`;
    const fixture = `
set -eu
tmp=$(mktemp -d)
mkdir -p "$tmp/bin"
printf '%s\\n' '#!/bin/sh' 'exit 0' > "$tmp/bin/pg_isready"
chmod +x "$tmp/bin/pg_isready"

make_certificate() {
  certificate="$1"
  if [ "$2" = both ]; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 1 \\
      -subj '/CN=quest-postgres' \\
      -addext 'subjectAltName=DNS:quest-postgres,IP:127.0.0.1' \\
      -keyout "$certificate.key" -out "$certificate.crt" >/dev/null 2>&1
  elif [ "$2" = dns ]; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 1 \\
      -subj '/CN=quest-postgres' \\
      -addext 'subjectAltName=DNS:quest-postgres' \\
      -keyout "$certificate.key" -out "$certificate.crt" >/dev/null 2>&1
  else
    openssl req -x509 -newkey rsa:2048 -nodes -days 1 \\
      -subj '/CN=quest-postgres' \\
      -keyout "$certificate.key" -out "$certificate.crt" >/dev/null 2>&1
  fi
}

run_case() {
  label="$1"
  make_certificate "$tmp/$label" "$label"
  if PATH="$tmp/bin:$PATH" \\
    POSTGRES_CERT_RUNTIME_FILE="$tmp/$label.crt" \\
    POSTGRES_CA_RUNTIME_FILE="$tmp/$label.crt" \\
    POSTGRES_KEY_RUNTIME_FILE="$tmp/$label.key" \\
    sh /fixture/healthcheck.sh; then
    printf '%s\\n' "$label:pass"
  else
    printf '%s\\n' "$label:fail"
  fi
}

both_result=$(run_case both both)
dns_result=$(run_case dns dns)
cn_result=$(run_case cn)
[ "$both_result" = 'both:pass' ]
[ "$dns_result" = 'dns:fail' ]
[ "$cn_result" = 'cn:fail' ]
`;
    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--entrypoint",
        "sh",
        "--volume",
        scriptMount,
        approvedPostgres17Ref,
        "-c",
        fixture,
      ],
      { encoding: "utf8" },
    );
    assert.equal(
      result.status,
      0,
      `SAN/CN healthcheck fixture failed:\n${result.stdout}\n${result.stderr}`,
    );
  },
);

test("production images are manifest-supplied and digest-oriented", () => {
  const imageVariables = [...productionCompose.matchAll(
    /^\s+image:\s*\$\{([A-Z_]+):\?[^}]+\}\s*$/gm,
  )].map((entry) => entry[1]);
  assert.deepEqual(imageVariables, ["QUEST_FRONTEND_IMAGE", "QUEST_BACKEND_IMAGE", "POSTGRES_IMAGE"]);
  for (const variable of imageVariables) {
    assert.match(
      productionCompose,
      new RegExp(`image:\\s*\\$\\{${variable}:\\?`),
      `${variable} must be required from the release manifest`,
    );
    assert.match(
      releaseScript,
      new RegExp(`${variable}=%s`),
      `${variable} must be emitted into the signed release bundle`,
    );
  }
  assert.doesNotMatch(
    productionEnv,
    /^(QUEST_FRONTEND_IMAGE|QUEST_BACKEND_IMAGE|QUEST_MIGRATOR_IMAGE|POSTGRES_IMAGE|VALORANT_IMAGE)=/m,
    "runtime environment must not carry release image variables",
  );
  assert.match(
    productionCompose,
    /postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0/,
  );
  assert.match(
    productionEnv,
    /postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0/,
  );
  const fallbackManifest = {
    QUEST_FRONTEND_IMAGE: `ghcr.io/questesports/quest-frontend@sha256:${"a".repeat(64)}`,
    QUEST_BACKEND_IMAGE: `ghcr.io/questesports/quest-backend@sha256:${"b".repeat(64)}`,
    POSTGRES_IMAGE:
      "postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0",
  };
  const releaseManifest = Object.fromEntries(
    imageVariables.map((variable) => [variable, process.env[variable] || fallbackManifest[variable]]),
  );
  for (const variable of imageVariables) {
    assert.match(
      releaseManifest[variable],
      /^[a-z0-9][a-z0-9./-]*(?::[a-z0-9._-]+)?@sha256:[a-f0-9]{64}$/,
      `${variable} release value must be an immutable digest reference`,
    );
  }
  assert.equal(
    releaseManifest.POSTGRES_IMAGE,
    "postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0",
  );
  const renderedImageLines = [...productionCompose.replace(
    /\$\{([A-Z_]+):\?[^}]+\}/g,
    (_, variable) => releaseManifest[variable] || "",
  ).matchAll(/^\s+image:\s*(.+)$/gm)].map((entry) => entry[1]);
  assert.deepEqual(renderedImageLines, Object.values(releaseManifest));
  assert.doesNotMatch(productionCompose, /image:\s*(?:postgres|node|ghcr\.io)[^$\n]*:[\w.-]+\s*$/m);
});

test("CI and deployment tooling use immutable infrastructure and locked CLIs", () => {
  const backendService = ciWorkflowDocument.jobs.backend.services.postgres;
  assert.equal(backendService.image, approvedPostgres16CiRef);
  assert.equal(ciWorkflowDocument.jobs.frontend.container, approvedPlaywrightRef);

  const frontendPackage = JSON.parse(read("frontend/package.json"));
  const frontendLock = JSON.parse(read("frontend/package-lock.json"));
  assert.equal(frontendPackage.devDependencies["@playwright/test"], "1.61.1");
  assert.equal("vercel" in frontendPackage.devDependencies, false);
  assert.equal(frontendLock.packages[""].devDependencies["@playwright/test"], "1.61.1");
  assert.equal("vercel" in frontendLock.packages[""].devDependencies, false);
  assert.equal(frontendLock.packages["node_modules/playwright"].version, "1.61.1");
  assert.equal("node_modules/vercel" in frontendLock.packages, false);

  assert.match(frontendDeployWorkflow, /npx --yes vercel@54\.17\.3 pull --yes/);
  assert.match(frontendDeployWorkflow, /npx --yes vercel@54\.17\.3 build --prod/);
  assert.match(frontendDeployWorkflow, /run: npx --yes vercel@54\.17\.3 deploy --prebuilt --prod/);
  assert.doesNotMatch(frontendDeployWorkflow, /frontend\/node_modules\/\.bin\/vercel/);
  assert.match(frontendDeployWorkflow, /npm ci/);

  assert.match(
    valorantE2eWorkflow,
    /astral-sh\/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d\s+#\s+v10\.0\.1/,
  );
  const parsedValorantE2e = yaml.load(valorantE2eWorkflow);
  const valorantSteps = parsedValorantE2e.jobs["valorant-e2e"].steps;
  const uvStep = valorantSteps.find((step) => step.name === "Set up uv");
  assert.equal(uvStep.with.version, "0.12.7");
  const siblingCheckout = valorantSteps.find((step) => step.name === "Check out valorant-platform-backend");
  assert.match(siblingCheckout.with.ref, /^[0-9a-f]{40}$/);
  assert.equal(siblingCheckout.with.ref, approvedValorantPlatformRef);
  assert.equal(siblingCheckout.with.token, "${{ secrets.VALORANT_PLATFORM_ACCESS_TOKEN }}");
  assert.match(
    ciWorkflow,
    /docker pull "\$approved_postgres_ref"[\s\S]*bash ops\/tests\/postgres-container-readability\.test\.sh/,
  );
  assert.match(ciWorkflow, /grep -Eq '\^SKIP:' <<< "\$readability_output"/);

  const windowsRestoreDrill = read("ops/test-paris-database-backup-windows.ps1");
  assert.match(windowsRestoreDrill, new RegExp(escapeRegExp(approvedPostgres17Ref)));
  assert.doesNotMatch(windowsRestoreDrill, /postgres:17-alpine/);
  const alpineReference = /alpine:3\.22@sha256:[0-9a-f]{64}/g;
  assert.equal(windowsRestoreDrill.match(alpineReference)?.length, 1);
  assert.match(windowsRestoreDrill, new RegExp(escapeRegExp(approvedAlpine322Ref)));
  assert.match(windowsRestoreDrill, /apk add --no-cache age=1\.2\.1-r0/);
  assert.doesNotMatch(windowsRestoreDrill, /apk add --no-cache age(?![=])/);
  const windowsBackup = read("ops/backup-paris-database-windows.ps1");
  assert.equal(windowsBackup.match(alpineReference)?.length, 2);
  assert.match(windowsBackup, new RegExp(escapeRegExp(approvedAlpine322Ref)));
  assert.equal(windowsBackup.match(/apk add --no-cache age=1\.2\.1-r0/g)?.length, 2);
  assert.doesNotMatch(windowsBackup, /apk add --no-cache age(?![=])/);
});

test("Cosign signing and verification use the same immutable official container", () => {
  for (const [name, document, source, jobName] of [
    ["build-container-images.yml", imageWorkflowDocument, imageWorkflow, "build"],
    ["deploy-compose.yml", deployWorkflowDocument, deployWorkflow, "deploy"],
  ]) {
    const steps = document.jobs[jobName].steps;
    const cosignStep = steps.find((step) => step.name === "Pull the immutable Cosign container");
    assert.ok(cosignStep?.run, `${name} must pull Cosign before use`);
    assert.deepEqual(cosignStep.env, { COSIGN_IMAGE: approvedCosignImage });
    assert.match(cosignStep.run, /docker pull "\$COSIGN_IMAGE"/);
    assert.match(cosignStep.run, /docker image inspect "\$COSIGN_IMAGE"/);
    assert.match(source, new RegExp(escapeRegExp(approvedCosignImage)));
    assert.doesNotMatch(source, /go\s+install\s+github\.com\/sigstore\/cosign\/v2\/cmd\/cosign@v2\.4\.1/);
    assert.doesNotMatch(source, /COSIGN_VERSION/);
    assert.match(source, /docker run --rm --pull=never --network host/);
    assert.match(source, /-v "\$HOME\/\.docker:\/root\/.docker:ro"/);
  }
  assert.match(imageWorkflow, /"\$COSIGN_IMAGE" sign --yes "\$image_reference"/);
  assert.match(deployWorkflow, /"\$COSIGN_IMAGE" verify/);
});

test("PostgreSQL bootstrap and TLS contract keep four roles and schemas separate", () => {
  for (const role of ["quest_runtime", "quest_migrator", "val_runtime", "val_migrator"]) {
    assert.match(postgresBootstrap, new RegExp(`CREATE ROLE ${role} LOGIN`));
  }
  assert.match(postgresBootstrap, /CREATE SCHEMA IF NOT EXISTS valorant AUTHORIZATION val_migrator/);
  assert.match(postgresBootstrap, /REVOKE ALL ON DATABASE %I FROM PUBLIC/);
  assert.match(postgresBootstrap, /ALTER SCHEMA public OWNER TO quest_migrator/);
  assert.match(postgresBootstrap, /ALTER SCHEMA valorant OWNER TO val_migrator/);
  for (const role of ["quest_migrator", "quest_runtime", "val_migrator", "val_runtime"]) {
    assert.match(postgresBootstrap, new RegExp(`ALTER ROLE ${role} LOGIN`));
    assert.match(postgresBootstrap, new RegExp(`ALTER ROLE ${role}[\\s\\S]*NOBYPASSRLS`));
  }
  assert.match(postgresBootstrap, /FROM pg_auth_members/);
  assert.match(postgresBootstrap, /REVOKE %I FROM %I/);
  assert.match(postgresBootstrap, /ALTER DEFAULT PRIVILEGES FOR ROLE quest_migrator/);
  assert.match(postgresBootstrap, /ALTER DEFAULT PRIVILEGES FOR ROLE val_migrator/);
  assert.match(postgresBootstrap, /CREATE ROLE quest_recovery_admin LOGIN/);
  assert.match(postgresBootstrap, /ALTER ROLE quest_recovery_admin LOGIN NOINHERIT SUPERUSER NOCREATEDB CREATEROLE NOREPLICATION BYPASSRLS CONNECTION LIMIT 1/);
  assert.match(postgresBootstrap, /RESTORE_MODE must run directly as quest_recovery_admin without SET ROLE/);
  assert.doesNotMatch(postgresBootstrap, /GRANT quest_migrator TO quest_recovery_admin/);
  assert.doesNotMatch(postgresBootstrap, /GRANT val_migrator TO quest_recovery_admin/);
  assert.doesNotMatch(productionCompose, /quest_recovery_admin/);
  assert.doesNotMatch(productionEnv, /quest_recovery_admin/);
  assert.match(postgresBootstrap, /ALTER DEFAULT PRIVILEGES[\s\S]*REVOKE ALL ON TABLES FROM PUBLIC/);
  assert.match(postgresBootstrap, /ALTER DEFAULT PRIVILEGES[\s\S]*REVOKE ALL ON SEQUENCES FROM PUBLIC/);
  assert.match(postgresBootstrap, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC/);
  assert.match(postgresBootstrap, /REVOKE ALL ON ALL PROCEDURES IN SCHEMA valorant FROM PUBLIC/);
  assert.match(postgresBootstrap, /REVOKE ALL ON TYPE %I\.%I FROM PUBLIC/);
  assert.match(postgresBootstrap, /type_object\.typelem = 0/);
  assert.match(postgresBootstrap, /type_object\.typtype <> 'm'/);
  assert.match(postgresBootstrap, /GRANT TEMPORARY ON DATABASE .* TO quest_migrator, val_migrator/);
  assert.doesNotMatch(postgresBootstrap, /PASSWORD\s+'[^']+'/i);
  assert.match(productionCompose, /ssl=on/);
  assert.match(productionCompose, /sslrootcert|ssl_ca_file/);
  assert.match(productionCompose, /ssl_cert_file[\s\S]*server\.crt/);
  assert.match(productionCompose, /ssl_key_file[\s\S]*server\.key/);
  assert.match(postgresHealthcheck, /-checkhost quest-postgres/);
  assert.match(postgresHealthcheck, /-checkip 127\.0\.0\.1/);
  assert.match(postgresHealthcheck, /-ext subjectAltName/);
  assert.match(postgresHealthcheck, /grep -Eq ['"]DNS:quest-postgres/);
  assert.match(postgresHealthcheck, /grep -Eq ['"]IP Address:127\\\.0\\\.0\\\.1/);
  assert.match(postgresHealthcheck, /pg_isready/);
  assert.match(postgresHealthcheck, /sslmode=verify-full/);
  assert.match(postgresHealthcheck, /sslrootcert=\$ca_certificate/);
  assert.match(postgresHealthcheck, /host=\$host port=\$port/);
  assert.match(productionEnv, /sslmode=verify-full/);
  assert.match(productionEnv, /sslrootcert=/);
  assert.match(productionCompose, /user:\s*["']?999:999/);
  assert.match(postgresBootstrap, /pg_operator/);
  assert.match(postgresBootstrap, /pg_collation/);
  assert.match(postgresBootstrap, /pg_statistic_ext/);
  assert.match(postgresBootstrap, /procedure\.prokind IN \('f', 'p', 'a', 'w'\)/);
  assert.match(postgresBootstrap, /relation\.relkind IN \('r', 'p', 'v', 'm', 'S', 'f', 'c'\)/);
  assert.match(postgresBootstrap, /current_database\(\)/);
  assert.doesNotMatch(postgresBootstrap, /ON DATABASE quest/);
  assert.doesNotMatch(read("ops/deploy/release.sh"), /POSTGRES_CERT_FILE|POSTGRES_KEY_FILE/);
  assert.doesNotMatch(read("ops/deploy/cutover.sh"), /POSTGRES_CERT_FILE|POSTGRES_KEY_FILE/);
  assert.doesNotMatch(read("ops/deploy/validate-host.sh"), /POSTGRES_CERT_FILE|POSTGRES_KEY_FILE/);
});

test("VALORANT runtime uses asyncpg SSL context semantics, not libpq URL options", () => {
  assert.match(valorantProductionEnv, /^DATABASE_URL=$/m);
  assert.match(valorantProductionEnv, /postgresql\+asyncpg:\/\/.*\?ssl=require/);
  assert.doesNotMatch(valorantProductionEnv, /[?&]sslmode=|[?&]sslrootcert=/);
  assert.match(valorantProductionEnv, /^VALORANT_DATABASE_SSL_CA_FILE=\/run\/secrets\/quest-private-ca\.crt$/m);
  assert.match(valorantProductionEnv, /^VALORANT_DATABASE_SSL_SERVER_HOSTNAME=quest-postgres$/m);
  assert.match(valorantProductionEnv, /^VALORANT_DATABASE_SSL_VERIFY=full$/m);
  assert.match(valorantProductionEnv, /check_hostname=True/);
  assert.match(valorantProductionEnv, /verify_mode=ssl\.CERT_REQUIRED/);
  assert.match(valorantProductionEnv, /asyncpg's `ssl` connect argument/);
  assert.match(read("ops/docker/valorant.production.compose.yml"), /env_file:/);
  assert.match(read("ops/docker/valorant.production.compose.yml"), /quest-private-ca\.crt:.*quest-private-ca\.crt:ro/);
  assert.match(releaseEnv, /^VALORANT_RUNTIME_COMPOSE_CONTRACT=/m);
  assert.match(releaseScript, /VALORANT Compose source does not satisfy the asyncpg TLS runtime contract/);
  assert.match(releaseScript, /parsed\.scheme != "postgresql\+asyncpg"/);
  assert.match(releaseScript, /query != \{"ssl": \["require"\]\}/);
  for (const deploymentScript of [releaseScript, verifyRelease, read("ops/deploy/cutover.sh"), read("ops/deploy/validate-host.sh")]) {
    assert.match(deploymentScript, /config --no-env-resolution --format json/);
    assert.match(deploymentScript, /with open\(raw, encoding="utf-8"\)/);
    assert.doesNotMatch(deploymentScript, /python3 - \"\$source_json\"/);
  }
  assert.match(databaseSecurityVerifier, /127\.0\.0\.1.*55432/);
  assert.match(databaseSecurityVerifier, /127\.0\.0\.1.*5432/);
});

test("PostgreSQL runtime roles use explicit non-bypass policies and keep the Prisma ledger private", () => {
  const roleAttributes = "LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS";
  for (const role of ["quest_runtime", "val_runtime", "quest_migrator", "val_migrator"]) {
    assert.match(postgresBootstrap, new RegExp(`ALTER ROLE ${role} ${roleAttributes}`));
  }
  assert.match(questRuntimeRlsMigration, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quest_runtime/);
  assert.match(questRuntimeRlsMigration, /GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO quest_runtime/);
  assert.match(questRuntimeRlsMigration, /DROP POLICY IF EXISTS %I ON %I\.%I/);
  assert.match(questRuntimeRlsMigration, /CREATE POLICY %I ON %I\.%I FOR ALL TO %I USING \(true\) WITH CHECK \(true\)/);
  assert.match(questRuntimeRlsMigration, /c\.relname <> '_prisma_migrations'/);
  assert.match(questRuntimeRlsMigration, /REVOKE ALL PRIVILEGES ON TABLE public\."_prisma_migrations" FROM quest_runtime/);
  assert.match(postgresBootstrap, /to_regclass\('public\._prisma_migrations'\)/);
  assert.match(databaseSecurityVerifier, /FROM pg_policies/);
  assert.match(databaseSecurityVerifier, /tablesWithoutRuntimePolicy/);
  assert.match(databaseSecurityVerifier, /rolbypassrls/);
  assert.match(databaseSecurityVerifier, /crossSchemaGrants/);
  assert.match(databaseSecurityVerifier, /p\.roles && ARRAY\['quest_runtime', 'val_runtime'\]::name\[\]/);
  assert.match(databaseSecurityVerifier, /'public' = ANY \(p\.roles\)/);
  assert.match(databaseSecurityVerifier, /n\.nspname IN \('public', 'valorant'\)/);
  assert.match(databaseSecurityVerifier, /_prisma_migrations/);
  assert.match(databaseSecurityVerifier, /p\.prokind IN \('f', 'p', 'a', 'w'\)/);
});

test(
  "the runtime policy migration gives Quest access without exposing the Prisma ledger or sibling schema",
  { skip: dockerFixture.skip || false },
  () => {
    const container = `quest-security-contract-${process.pid}`;
    const docker = (args) => spawnSync("docker", ["exec", container, ...args], { encoding: "utf8" });
    const runPsql = (role, sql) => docker(["psql", "-v", "ON_ERROR_STOP=1", "-U", role, "-d", "quest", "-At", "-c", sql]);
    const started = spawnSync(
      "docker",
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        container,
        "-e",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "-e",
        "POSTGRES_DB=quest",
        "-p",
        "127.0.0.1::5432",
        approvedPostgres17Ref,
      ],
      { encoding: "utf8" },
    );
    assert.equal(started.status, 0, `could not start PostgreSQL fixture:\n${started.stdout}\n${started.stderr}`);

    try {
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const result = docker(["pg_isready", "-U", "postgres", "-d", "quest"]);
        if (result.status === 0) {
          ready = true;
          break;
        }
      }
      assert.equal(ready, true, "PostgreSQL fixture did not become ready");

      const publishedPort = spawnSync("docker", ["port", container, "5432/tcp"], { encoding: "utf8" });
      assert.equal(publishedPort.status, 0, `could not determine fixture port:\n${publishedPort.stdout}\n${publishedPort.stderr}`);
      const portMatch = publishedPort.stdout.match(/:(\d+)\s*$/m);
      assert.ok(portMatch, `fixture port was not published:\n${publishedPort.stdout}`);
      const databaseUrl = `postgresql://quest_migrator@127.0.0.1:${portMatch[1]}/quest?schema=public`;
      const runVerifier = () =>
        spawnSync(process.execPath, [path.join(repoRoot, "backend/scripts/verify-database-security.js")], {
          cwd: path.join(repoRoot, "backend"),
          encoding: "utf8",
          env: {
            ...process.env,
            DATABASE_URL: `postgresql://postgres@127.0.0.1:${portMatch[1]}/quest?schema=public`,
            DIRECT_URL: `postgresql://postgres@127.0.0.1:${portMatch[1]}/quest?schema=public`,
            SESSION_COOKIE_NAME: "quest_session",
            NODE_ENV: "test",
          },
        });

      const bootstrapPath = path.join(repoRoot, "ops/docker/postgres/init/001-bootstrap-roles.sql");
      const migrationPath = path.join(
        repoRoot,
        "backend/prisma/migrations/20260829120000_add_quest_runtime_rls_policies/migration.sql",
      );
      for (const [source, target] of [
        [bootstrapPath, "/tmp/bootstrap.sql"],
        [migrationPath, "/tmp/runtime-policies.sql"],
      ]) {
        const copied = spawnSync("docker", ["cp", source, `${container}:${target}`], { encoding: "utf8" });
        assert.equal(copied.status, 0, `could not copy fixture SQL:\n${copied.stdout}\n${copied.stderr}`);
      }

      let result = docker(["psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "quest", "-f", "/tmp/bootstrap.sql"]);
      assert.equal(result.status, 0, `bootstrap fixture failed:\n${result.stdout}\n${result.stderr}`);
      result = runPsql(
        "postgres",
        "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;",
      );
      assert.equal(result.status, 0, `Data API fixture roles failed:\n${result.stdout}\n${result.stderr}`);
      result = runPsql("quest_migrator", 'CREATE TABLE public.fixture_application (id integer PRIMARY KEY); CREATE TABLE public."_prisma_migrations" (id text PRIMARY KEY);');
      assert.equal(result.status, 0, `fixture tables failed:\n${result.stdout}\n${result.stderr}`);
      result = runPsql(
        "val_migrator",
        "CREATE TABLE valorant.fixture_application (id integer PRIMARY KEY); CREATE TABLE valorant.\"_migration_ledger\" (id text PRIMARY KEY); REVOKE ALL PRIVILEGES ON TABLE valorant.\"_migration_ledger\" FROM val_runtime;",
      );
      assert.equal(result.status, 0, `sibling fixture table failed:\n${result.stdout}\n${result.stderr}`);
      result = runPsql(
        "val_migrator",
        "ALTER TABLE valorant.fixture_application ENABLE ROW LEVEL SECURITY; CREATE POLICY fixture_application_runtime_all ON valorant.fixture_application FOR ALL TO val_runtime USING (true) WITH CHECK (true);",
      );
      assert.equal(result.status, 0, `sibling runtime policy failed:\n${result.stdout}\n${result.stderr}`);
      result = runPsql("postgres", "CREATE TYPE public.fixture_composite AS (value integer); ALTER TYPE public.fixture_composite OWNER TO postgres; CREATE FUNCTION public.fixture_window(value integer) RETURNS integer LANGUAGE SQL IMMUTABLE WINDOW AS 'SELECT $1'; ALTER FUNCTION public.fixture_window(integer) OWNER TO postgres;");
      assert.equal(result.status, 0, `composite type fixture failed:\n${result.stdout}\n${result.stderr}`);
      result = docker(["psql", "-v", "ON_ERROR_STOP=1", "-v", "RESTORE_MODE=1", "-U", "quest_recovery_admin", "-d", "quest", "-f", "/tmp/bootstrap.sql"]);
      assert.equal(result.status, 0, `recovery ownership fixture failed:\n${result.stdout}\n${result.stderr}`);
      result = runPsql("postgres", "SELECT pg_get_userbyid(t.typowner), pg_get_userbyid(c.relowner) FROM pg_type t JOIN pg_class c ON c.oid = t.typrelid WHERE t.typnamespace = 'public'::regnamespace AND t.typname = 'fixture_composite';");
      assert.equal(result.stdout.trim(), "quest_migrator|quest_migrator", `composite type ownership was not normalized:\n${result.stdout}\n${result.stderr}`);
      result = runPsql("postgres", "SELECT p.prokind, pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fixture_window' AND p.prokind = 'w';");
      assert.equal(result.stdout.trim(), "w|quest_migrator", `window function ownership was not normalized:\n${result.stdout}\n${result.stderr}`);
      result = docker(["psql", "-v", "ON_ERROR_STOP=1", "-U", "quest_migrator", "-d", "quest", "-f", "/tmp/runtime-policies.sql"]);
      assert.equal(result.status, 0, `runtime policy migration failed:\n${result.stdout}\n${result.stderr}`);

      result = runPsql("postgres", "SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fixture_application' AND policyname = 'fixture_application_runtime_all' AND cmd = 'ALL' AND 'quest_runtime' = ANY (roles) AND qual = 'true' AND with_check = 'true');");
      assert.equal(result.stdout.trim(), "t", `fixture policy was not created:\n${result.stdout}\n${result.stderr}`);
      result = runPsql("postgres", "SELECT has_table_privilege('quest_runtime', 'public.fixture_application', 'SELECT'), has_table_privilege('quest_runtime', 'public.\"_prisma_migrations\"', 'SELECT'), NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = '_prisma_migrations');");
      assert.equal(result.stdout.trim(), "t|f|t", `ledger privilege contract failed:\n${result.stdout}\n${result.stderr}`);
      result = runPsql("quest_runtime", "INSERT INTO public.fixture_application VALUES (1); SELECT count(*) FROM public.fixture_application;");
      assert.equal(result.status, 0, `Quest runtime positive probe failed:\n${result.stdout}\n${result.stderr}`);
      result = runPsql("quest_runtime", 'SELECT count(*) FROM public."_prisma_migrations";');
      assert.notEqual(result.status, 0, "Quest runtime unexpectedly accessed _prisma_migrations");
      result = runPsql("quest_runtime", "SELECT count(*) FROM valorant.fixture_application;");
      assert.notEqual(result.status, 0, "Quest runtime unexpectedly accessed valorant");
      result = runPsql("val_runtime", "SELECT count(*) FROM public.fixture_application;");
      assert.notEqual(result.status, 0, "VAL runtime unexpectedly accessed public");

      result = runVerifier();
      assert.equal(result.status, 0, `security verifier rejected the secure fixture:\n${result.stdout}\n${result.stderr}`);

      result = runPsql("quest_migrator", "DROP POLICY fixture_application_runtime_all ON public.fixture_application;");
      assert.equal(result.status, 0, `could not remove fixture policy:\n${result.stdout}\n${result.stderr}`);
      result = runVerifier();
      assert.notEqual(result.status, 0, "security verifier accepted a table with a missing runtime policy");
      assert.match(`${result.stdout}\n${result.stderr}`, /Application tables without their runtime policy/);
      result = runPsql(
        "quest_migrator",
        "CREATE POLICY fixture_application_runtime_all ON public.fixture_application FOR ALL TO quest_runtime USING (true) WITH CHECK (true);",
      );
      assert.equal(result.status, 0, `could not restore fixture policy:\n${result.stdout}\n${result.stderr}`);

      result = runPsql(
        "quest_migrator",
        'CREATE POLICY ledger_val_runtime ON public."_prisma_migrations" FOR SELECT TO val_runtime USING (true);',
      );
      assert.equal(result.status, 0, `could not create runtime ledger policy:\n${result.stdout}\n${result.stderr}`);
      result = runVerifier();
      assert.notEqual(result.status, 0, "security verifier accepted a val_runtime ledger policy");
      assert.match(`${result.stdout}\n${result.stderr}`, /Unexpected runtime\/PUBLIC access to a migration ledger/);
      result = runPsql("quest_migrator", "DROP POLICY ledger_val_runtime ON public.\"_prisma_migrations\";");
      assert.equal(result.status, 0, `could not remove runtime ledger policy:\n${result.stdout}\n${result.stderr}`);

      result = runPsql(
        "quest_migrator",
        'CREATE POLICY ledger_public_mixed ON public."_prisma_migrations" FOR SELECT TO PUBLIC, quest_migrator USING (true);',
      );
      assert.equal(result.status, 0, `could not create mixed PUBLIC ledger policy:\n${result.stdout}\n${result.stderr}`);
      result = runVerifier();
      assert.notEqual(result.status, 0, "security verifier accepted a mixed PUBLIC ledger policy");
      assert.match(`${result.stdout}\n${result.stderr}`, /Unexpected runtime\/PUBLIC access to a migration ledger/);
      result = runPsql("quest_migrator", "DROP POLICY ledger_public_mixed ON public.\"_prisma_migrations\";");
      assert.equal(result.status, 0, `could not remove mixed PUBLIC ledger policy:\n${result.stdout}\n${result.stderr}`);

      result = runPsql(
        "postgres",
        "GRANT SELECT ON valorant.fixture_application TO anon, authenticated, service_role, PUBLIC;",
      );
      assert.equal(result.status, 0, `could not create cross-schema Data API grants:\n${result.stdout}\n${result.stderr}`);
      result = runVerifier();
      assert.notEqual(result.status, 0, "security verifier accepted cross-schema Data API table grants");
      assert.match(`${result.stdout}\n${result.stderr}`, /Unexpected Data API table grants/);
      result = runPsql(
        "postgres",
        "REVOKE ALL PRIVILEGES ON valorant.fixture_application FROM anon, authenticated, service_role, PUBLIC;",
      );
      assert.equal(result.status, 0, `could not remove cross-schema Data API grants:\n${result.stdout}\n${result.stderr}`);
      result = runVerifier();
      assert.equal(result.status, 0, `security verifier rejected the restored secure fixture:\n${result.stdout}\n${result.stderr}`);

      result = runPsql("postgres", "ALTER TYPE public.fixture_composite OWNER TO postgres;");
      assert.equal(result.status, 0, `could not create a wrong composite owner:\n${result.stdout}\n${result.stderr}`);
      result = runVerifier();
      assert.notEqual(result.status, 0, "security verifier accepted a wrong composite type owner");
      assert.match(`${result.stdout}\n${result.stderr}`, /Objects with unexpected schema owners/);
      result = runPsql("postgres", "ALTER TYPE public.fixture_composite OWNER TO quest_migrator;");
      assert.equal(result.status, 0, `could not restore composite owner:\n${result.stdout}\n${result.stderr}`);
      result = runPsql("postgres", "ALTER FUNCTION public.fixture_window(integer) OWNER TO postgres;");
      assert.equal(result.status, 0, `could not create a wrong window-function owner:\n${result.stdout}\n${result.stderr}`);
      result = runVerifier();
      assert.notEqual(result.status, 0, "security verifier accepted a wrong window function owner");
      assert.match(`${result.stdout}\n${result.stderr}`, /Objects with unexpected schema owners/);
      result = runPsql("postgres", "ALTER FUNCTION public.fixture_window(integer) OWNER TO quest_migrator;");
      assert.equal(result.status, 0, `could not restore window function owner:\n${result.stdout}\n${result.stderr}`);
    } finally {
      spawnSync("docker", ["rm", "--force", container], { encoding: "utf8" });
    }
  },
);

test("production environment template contains no credential values", () => {
  const sensitiveAssignment = /^(?:AUTH_ENCRYPTION_KEY|VALORANT_SERVICE_KEY_ID|VALORANT_SERVICE_SECRET|DATABASE_URL|DIRECT_URL|SMTP_HOST|SMTP_USER|SMTP_PASS)=/;
  for (const line of productionEnv.split("\n")) {
    if (sensitiveAssignment.test(line)) {
      assert.equal(line.slice(line.indexOf("=") + 1), "", `${line} must remain secret-free`);
    }
  }
  assert.doesNotMatch(productionEnv, /^POSTGRES_PASSWORD(?:=|:)/m);
  assert.doesNotMatch(serviceBlock("backend"), /POSTGRES_PASSWORD_FILE/);
  assert.doesNotMatch(serviceBlock("backend"), /POSTGRES_PASSWORD/);
  assert.doesNotMatch(serviceBlock("postgres"), /env_file:/);
  assert.match(serviceBlock("postgres"), /POSTGRES_PASSWORD_FILE: \/run\/secrets\/postgres-admin-password/);
  assert.match(serviceBlock("postgres"), /postgres-admin-password:\/run\/secrets\/postgres-admin-password:ro/);
  assert.doesNotMatch(productionCompose, /POSTGRES_PASSWORD:\s*\$\{[^}]+\}/);
  assert.doesNotMatch(productionCompose, /SMTP_PASS:/);
  assert.doesNotMatch(productionCompose, /(?:DATABASE_URL|DIRECT_URL|SMTP_PASS|SMTP_USER|SMTP_HOST):\s*[^\s]/);
  assert.match(productionEnv, /^NODE_EXTRA_CA_CERTS=/m);
  assert.match(productionEnv, /^UPLOAD_ROOT=\/srv\/quest-esports\/uploads$/m);
  assert.match(productionEnv, /^PRIVATE_UPLOAD_ROOT=\/srv\/quest-esports\/private$/m);
  assert.match(productionEnv, /^VALORANT_INTERNAL_BASE_URL=https:\/\/valorant-platform:8000$/m);
  assert.match(productionEnv, /^MOBILE_ADMIN_ANDROID_CERT_SHA256=<[^>]+>$/m);
  assert.match(productionEnv, /^TRUST_PROXY=1$/m);
  assert.match(productionEnv, /^MAIL_PROVIDER=smtp$/m);
  for (const variable of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "MAIL_DELIVERY_REQUIRED"]) {
    assert.match(productionEnv, new RegExp(`^${variable}=`, "m"), `${variable} must be documented`);
  }
  assert.match(productionEnv, /^COMPOSE_PROJECT_NAME=quest-prod$/m);
  assert.match(productionEnv, /^QUEST_SHARED_NETWORK=quest-shared$/m);
});
