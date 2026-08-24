const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.join(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const compose = read("docker-compose.local.yml");
const backendDockerfile = read("ops/docker/backend.local.Dockerfile");
const valorantDockerfile = read("ops/docker/valorant.local.Dockerfile");
const gitignore = read(".gitignore");

const executable = (source, commentPrefix) =>
  source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(commentPrefix))
    .join("\n");

const composeCode = executable(compose, "#");
const backendCode = executable(backendDockerfile, "#");
const valorantCode = executable(valorantDockerfile, "#");

test("the local stack never binds a service to a public interface", () => {
  // An internal service published on 0.0.0.0 is how a development database
  // ends up reachable from the network.
  const publishedPorts = composeCode.match(/^\s*-\s*"([^"]+)"\s*$/gm) || [];
  const portMappings = publishedPorts
    .map((line) => line.replace(/^\s*-\s*"|"\s*$/g, ""))
    .filter((value) => /^[\d.]*:?\d+:\d+$/.test(value));

  assert.ok(portMappings.length > 0, "expected published ports");
  for (const mapping of portMappings) {
    assert.match(mapping, /^127\.0\.0\.1:/, `${mapping} must be bound to loopback`);
  }
});

test("the containerised backend cannot reach the remote database by accident", () => {
  // backend/.env points at a remote Supabase project. Loading it into a
  // container is how a local experiment writes to a shared database.
  assert.doesNotMatch(composeCode, /env_file:[\s\S]*?backend\/\.env\s*$/m);

  // DATABASE_URL is set in `environment:`, which outranks `env_file`, so the
  // local Postgres wins even if the env file is misconfigured.
  assert.match(composeCode, /DATABASE_URL:\s*postgresql:\/\/quest:local_quest@postgres:5432/);
  assert.match(composeCode, /DIRECT_URL:\s*postgresql:\/\/quest:local_quest@postgres:5432/);
});

test("services address each other by compose service name", () => {
  // The whole point of the private network is that neither service assumes
  // localhost, which is also how production is configured.
  assert.match(composeCode, /VALORANT_INTERNAL_BASE_URL:\s*http:\/\/valorant-backend:8000/);
  assert.doesNotMatch(composeCode, /VALORANT_INTERNAL_BASE_URL:\s*http:\/\/localhost/);
});

test("no production credential is baked into an image", () => {
  for (const [name, source] of [
    ["backend", backendCode],
    ["valorant", valorantCode],
  ]) {
    // Values arrive at run time. A secret in a layer survives the container.
    assert.doesNotMatch(source, /\bENV\s+\w*(SECRET|PASSWORD|TOKEN|API_KEY)\w*\s*=?\s*\S/i, name);
    assert.doesNotMatch(source, /COPY\s+.*\.env\b/i, name);
    assert.doesNotMatch(source, /supabase|pooler\.supabase\.com/i, name);
  }
});

test("a filled-in local env file cannot be committed", () => {
  // `.env*` only matches names that START with .env, so this one needs an
  // explicit rule — a completed copy carries real OAuth credentials.
  assert.match(gitignore, /ops\/docker\/quest\.local\.env/);
  assert.ok(
    fs.existsSync(path.join(repoRoot, "ops/docker/quest.local.env.example")),
    "the template must be committed",
  );
  // Checked against the git index, NOT the filesystem: the template tells you
  // to copy it to this path, so a developer who followed the setup has the
  // file on disk and must not fail this suite for it. What matters is that it
  // is never tracked.
  const tracked = spawnSync("git", ["ls-files", "--", "ops/docker/quest.local.env"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (tracked.status === 0) {
    assert.equal(
      tracked.stdout.trim(),
      "",
      "a real local env file must never be committed",
    );
  }
});

test("the image runtimes match what the projects declare", () => {
  // backend/package.json engines says node 24.x; pyproject requires >=3.11.
  assert.match(backendCode, /FROM node:24-/);
  assert.match(valorantCode, /FROM python:3\.1[2-9]-/);
});

test("this stack is labelled local-only and does not touch the deploy path", () => {
  // Production is PM2 + cd.yml + ops/ backup and restore. Nothing here may
  // quietly become part of that.
  assert.match(compose, /LOCAL DEVELOPMENT ONLY/);
  assert.match(backendDockerfile, /LOCAL DEVELOPMENT ONLY/);
  assert.match(valorantDockerfile, /LOCAL DEVELOPMENT ONLY/);

  // The file name itself has to carry the scope.
  assert.ok(fs.existsSync(path.join(repoRoot, "docker-compose.local.yml")));
  assert.ok(
    !fs.existsSync(path.join(repoRoot, "docker-compose.yml")),
    "a bare docker-compose.yml would read as the deployment path",
  );
});

test("the sibling VALORANT service is optional", () => {
  // It builds from ../valorant-platform-backend, which may not be checked out.
  assert.match(composeCode, /profiles:\s*\["valorant"\]/);
  assert.match(composeCode, /context:\s*\.\.\/valorant-platform-backend/);
});
