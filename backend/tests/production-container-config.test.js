const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
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
  const image = spawnSync("docker", ["image", "inspect", "postgres:17-bookworm"], {
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
  if [ "$2" = san ]; then
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
    sh /fixture/healthcheck.sh; then
    printf '%s\\n' "$label:pass"
  else
    printf '%s\\n' "$label:fail"
  fi
}

san_result=$(run_case san)
cn_result=$(run_case cn)
[ "$san_result" = 'san:pass' ]
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
        "postgres:17-bookworm",
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
    assert.match(productionEnv, new RegExp(`^${variable}=`, "m"), `${variable} must be a release variable`);
  }
  assert.match(productionEnv, /^QUEST_MIGRATOR_IMAGE=$/m);
  assert.match(productionEnv, /^POSTGRES_IMAGE=$/m);
  assert.match(productionCompose, /postgres:17-bookworm@sha256:<digest>/);
  assert.match(productionEnv, /postgres:17-bookworm@sha256:<64-hex-digest>/);
  const fallbackManifest = {
    QUEST_FRONTEND_IMAGE: `ghcr.io/questesports/quest-frontend@sha256:${"a".repeat(64)}`,
    QUEST_BACKEND_IMAGE: `ghcr.io/questesports/quest-backend@sha256:${"b".repeat(64)}`,
    POSTGRES_IMAGE: `postgres:17-bookworm@sha256:${"c".repeat(64)}`,
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
  const renderedImageLines = [...productionCompose.replace(
    /\$\{([A-Z_]+):\?[^}]+\}/g,
    (_, variable) => releaseManifest[variable] || "",
  ).matchAll(/^\s+image:\s*(.+)$/gm)].map((entry) => entry[1]);
  assert.deepEqual(renderedImageLines, Object.values(releaseManifest));
  assert.doesNotMatch(productionCompose, /image:\s*(?:postgres|node|ghcr\.io)[^$\n]*:[\w.-]+\s*$/m);
});

test("PostgreSQL bootstrap and TLS contract keep four roles and schemas separate", () => {
  for (const role of ["quest_runtime", "quest_migrator", "val_runtime", "val_migrator"]) {
    assert.match(postgresBootstrap, new RegExp(`CREATE ROLE ${role} LOGIN`));
  }
  assert.match(postgresBootstrap, /CREATE SCHEMA IF NOT EXISTS valorant AUTHORIZATION val_migrator/);
  assert.match(postgresBootstrap, /REVOKE ALL ON DATABASE quest FROM PUBLIC/);
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
  assert.match(postgresBootstrap, /ALTER DEFAULT PRIVILEGES[\s\S]*REVOKE ALL ON TABLES FROM PUBLIC/);
  assert.match(postgresBootstrap, /ALTER DEFAULT PRIVILEGES[\s\S]*REVOKE ALL ON SEQUENCES FROM PUBLIC/);
  assert.match(postgresBootstrap, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC/);
  assert.match(postgresBootstrap, /REVOKE ALL ON ALL PROCEDURES IN SCHEMA valorant FROM PUBLIC/);
  assert.match(postgresBootstrap, /REVOKE ALL ON TYPE %I\.%I FROM PUBLIC/);
  assert.match(postgresBootstrap, /type_object\.typelem = 0/);
  assert.match(postgresBootstrap, /type_object\.typtype <> 'm'/);
  assert.doesNotMatch(postgresBootstrap, /PASSWORD\s+'[^']+'/i);
  assert.match(productionCompose, /ssl=on/);
  assert.match(productionCompose, /sslrootcert|ssl_ca_file/);
  assert.match(productionCompose, /ssl_cert_file[\s\S]*server\.crt/);
  assert.match(productionCompose, /ssl_key_file[\s\S]*server\.key/);
  assert.match(postgresHealthcheck, /-checkhost quest-postgres/);
  assert.match(postgresHealthcheck, /-ext subjectAltName/);
  assert.match(postgresHealthcheck, /grep -Eq ['"]DNS:quest-postgres/);
  assert.match(postgresHealthcheck, /pg_isready/);
  assert.match(postgresHealthcheck, /sslmode=verify-full/);
  assert.match(postgresHealthcheck, /sslrootcert=\$ca_certificate/);
  assert.match(postgresHealthcheck, /host=\$host port=\$port/);
  assert.match(productionEnv, /sslmode=verify-full/);
  assert.match(productionEnv, /sslrootcert=/);
});

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
