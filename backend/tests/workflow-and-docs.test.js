const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const repoRoot = path.join(__dirname, "../..");
const workflowDirectory = path.join(repoRoot, ".github", "workflows");
const staleBackupVariablePattern = /\bBACKUP_CLIENT_TLS_(?:CA|CERT|KEY)_FILE\b/;

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");

test("production hardening documentation pins registration, runtime, and release boundaries", () => {
  const root = read("README.md");
  const setup = read("docs/setup-and-deployment.md");
  const api = read("docs/api-documentation.md");
  const runbook = read("docs/production-runbook.md");
  const environment = read("docs/environment-reference.md");
  assert.match(root, /http:\/\/localhost:8000/);
  assert.doesNotMatch(root, /https:\/\/localhost:8000/);
  assert.match(root, /Python 3\.11\+/);
  assert.match(setup, /Production uses immutable Docker Compose/);
  assert.match(setup, /Generic non-production deployment steps/);
  for (const endpoint of ["check-puuid", "preview", "submit"]) {
    assert.ok(api.includes(`/api/v1/valorant/leaderboard/register/${endpoint}`));
  }
  assert.match(api, /\{ "puuid": "<VALORANT PUUID>" \}/);
  assert.match(api, /401[\s\S]*403[\s\S]*DISCORD_LINK_REQUIRED/);
  assert.match(api, /OAuthAccount[\s\S]*providerUserId/);
  assert.match(api, /private[\s\S]*read-only/);
  assert.doesNotMatch(api, /Quest does not host it/);
  for (const key of ["service_token", "henrik", "discord_oauth", "oauth_redirect", "discord_workers", "tls"]) {
    assert.ok(runbook.includes(`\`${key}\``), `runbook must document readiness check ${key}`);
  }
  assert.match(runbook, /three consecutive[\s\S]*two seconds/);
  assert.match(runbook, /Quest JavaScript service-token signer/);
  assert.match(environment, /APP_ENV=production[\s\S]*fail.closed/i);
  assert.match(read("docs/ci-cd.md"), /uv sync --extra dev --locked/);
  assert.match(read("mobile-admin/README.md"), /npm run prebuild:android -- --no-install/);
});

test("active hardening guides have valid repository-relative Markdown file links", () => {
  const documents = [
    "README.md", "codemap.md", "docs/setup-and-deployment.md", "docs/ci-cd.md",
    "docs/production-runbook.md", "docs/environment-reference.md", "docs/api-documentation.md",
    "backend/README.md", "frontend/README.md", "mobile-admin/README.md",
    "valorant-platform-backend/README.md", "valorant-platform-backend/codemap.md",
    "backend/tests/valorant-e2e/README.md",
  ];
  const failures = [];
  for (const document of documents) {
    // Ignore examples inside code fences and inline code; inspect links in prose.
    const source = read(document).replace(/^```[^\n]*\n[\s\S]*?^```/gm, "").replace(/`[^`]*`/g, "");
    for (const match of source.matchAll(/\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1].replace(/^<|>$/g, "");
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(target)) continue;
      const file = decodeURIComponent(target.split(/[?#]/)[0]);
      const resolved = path.resolve(repoRoot, path.dirname(document), file);
      const relative = path.relative(repoRoot, resolved);
      if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.existsSync(resolved)) {
        failures.push(`${document}: ${target}`);
      }
    }
  }
  assert.deepEqual(failures, [], "broken repository-relative Markdown links");
});

const workflowPaths = fs
  .readdirSync(workflowDirectory)
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort()
  .map((name) => path.join(workflowDirectory, name));

const workflowName = (filePath) => path.basename(filePath);

const loadWorkflow = (filePath) => {
  const source = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  const document = yaml.load(source);
  assert.ok(document && typeof document === "object" && !Array.isArray(document), workflowName(filePath));
  return { source, document };
};

const events = (document) => document.on ?? document[true] ?? {};

const eventNames = (document) => {
  const trigger = events(document);
  if (Array.isArray(trigger)) return new Set(trigger.map(String));
  if (typeof trigger === "string") return new Set([trigger]);
  return new Set(Object.keys(trigger || {}).map(String));
};

const walk = (value, currentPath = [], callback) => {
  callback(value, currentPath);
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, [...currentPath, String(index)], callback));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => walk(child, [...currentPath, key], callback));
  }
};

const actionUses = (document) => {
  const uses = [];
  walk(document, [], (value, currentPath) => {
    if (currentPath.at(-1) === "uses" && typeof value === "string") {
      uses.push({ value, path: currentPath });
    }
  });
  return uses;
};

const section = (source, heading, nextHeading = "") => {
  const start = source.indexOf(`${heading}\n`);
  assert.notEqual(start, -1, `missing documentation section: ${heading}`);
  const bodyStart = start + heading.length + 1;
  const end = nextHeading ? source.indexOf(`\n${nextHeading}\n`, bodyStart) : source.length;
  assert.notEqual(end, -1, `missing documentation boundary after: ${heading}`);
  return source.slice(bodyStart, end);
};

const assertNoStaleBackupVariableNames = (
  source,
  message = "backup documentation must not use removed TLS variable names",
) => {
  assert.doesNotMatch(source, staleBackupVariablePattern, message);
};

const secretReferences = (document) => {
  const references = [];
  walk(document, [], (value, currentPath) => {
    if (typeof value !== "string") return;
    for (const match of value.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)) {
      references.push({ name: match[1], path: currentPath, value });
    }
  });
  return references;
};

test("every workflow is parsed and has immutable action and execution controls", () => {
  assert.ok(workflowPaths.length >= 1);
  const immutableAction = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/;
  const actionComment = /\s+#\s+v[0-9]+(?:\.[0-9]+){0,2}\s*$/;

  for (const filePath of workflowPaths) {
    const { source, document } = loadWorkflow(filePath);
    const name = workflowName(filePath);
    assert.equal(typeof document.name, "string", `${name} must have a name`);
    assert.ok(document.permissions && typeof document.permissions === "object", `${name} permissions`);
    assert.ok(document.concurrency && typeof document.concurrency === "object", `${name} concurrency`);
    assert.equal(typeof document.concurrency.group, "string", `${name} concurrency group`);
    assert.equal(typeof document.concurrency["cancel-in-progress"], "boolean", `${name} cancellation policy`);
    assert.ok(document.jobs && Object.keys(document.jobs).length > 0, `${name} jobs`);

    const uses = actionUses(document);
    assert.ok(uses.length > 0 || name === "deploy-compose.yml", `${name} must use an action or artifact-only execution`);
    for (const { value, path: usePath } of uses) {
      assert.match(value, immutableAction, `${name} has mutable action ref at ${usePath.join(".")}`);
      const line = source.split("\n").find((candidate) => candidate.includes(`uses: ${value}`));
      assert.ok(line && actionComment.test(line), `${name} action ${value} needs a version comment`);
    }

    const checkouts = uses.filter(({ value }) => value.startsWith("actions/checkout@"));
    if (name !== "deploy-compose.yml") {
      assert.ok(checkouts.length > 0, `${name} must explicitly control source checkout`);
      for (const { path: checkoutPath } of checkouts) {
        let checkout = document;
        for (const segment of checkoutPath.slice(0, -1)) checkout = checkout[segment];
        assert.equal(
          checkout.with?.["persist-credentials"],
          false,
          `${name} must disable persisted checkout credentials`,
        );
      }
    }
    if (name === "deploy-compose.yml") {
      assert.match(source, /Download the manifest from that exact successful build/);
      assert.doesNotMatch(source, /Check out repository|npm ci|\bpm2\b/);
    }
  }
});

test("pull-request workflows cannot route untrusted code to protected secrets", () => {
  for (const filePath of workflowPaths) {
    const { document } = loadWorkflow(filePath);
    const name = workflowName(filePath);
    const names = eventNames(document);
    if (!names.has("pull_request") && !names.has("pull_request_target")) continue;

    assert.ok(!names.has("pull_request_target"), `${name} must not use pull_request_target`);
    for (const [jobName, job] of Object.entries(document.jobs || {})) {
      assert.equal(job.environment, undefined, `${name}:${jobName} cannot enter an environment from PR CI`);
    }
    for (const reference of secretReferences(document)) {
      const [scope, referencedJob, kind, stepIndex, location, variable] = reference.path;
      const safeGithubToken =
        scope === "jobs" &&
        referencedJob &&
        kind === "steps" &&
        /^\d+$/.test(stepIndex) &&
        location === "env" &&
        variable === "GITHUB_TOKEN" &&
        reference.name === "GITHUB_TOKEN";
      assert.ok(safeGithubToken, `${name} exposes ${reference.name} at ${reference.path.join(".")}`);
    }
  }
});

test("CI owns pinned workflow lint tooling and discovers every tracked workflow safely", () => {
  const { source, document } = loadWorkflow(path.join(workflowDirectory, "ci.yml"));
  const lintJob = document.jobs["workflow-lint"];
  assert.ok(lintJob, "CI must define workflow-lint");
  assert.equal(lintJob.timeout, undefined, "workflow lint must use job timeout-minutes, not timeout");
  assert.equal(lintJob["timeout-minutes"], 15);

  const toolStep = lintJob.steps.find((step) => step.name === "Install pinned workflow lint tooling");
  assert.ok(toolStep?.run, "pinned lint-tool installation step is required");
  assert.ok(
    lintJob.steps.some((step) => step.run === "npm ci --ignore-scripts --no-audit --no-fund"),
    "workflow contract dependencies must be installed before the Node contract runs",
  );
  const actionlintImage =
    "rhysd/actionlint:1.7.7@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9";
  const shellcheckImage =
    "koalaman/shellcheck:v0.9.0@sha256:f35e8987b02760d4e76fc99a68ad5c42cc10bb32f3dd2143a3cf92f1e5446a45";
  assert.deepEqual(toolStep.env, { ACTIONLINT_IMAGE: actionlintImage, SHELLCHECK_IMAGE: shellcheckImage });
  assert.match(toolStep.run, /docker pull "\$ACTIONLINT_IMAGE"/);
  assert.match(toolStep.run, /docker pull "\$SHELLCHECK_IMAGE"/);
  assert.doesNotMatch(toolStep.run, /apt-get|go\s+install|actionlint@v|shellcheck=/);

  const lintStep = lintJob.steps.find((step) => step.name === "Run workflow and shell lint");
  assert.ok(lintStep?.run, "workflow and shell lint step is required");
  const workflowDiscovery = lintStep.run.match(
    /mapfile -d '' -t workflow_files < <\(\s*git ls-files -z --([\s\S]*?)\n\s*\)\s*/,
  );
  assert.ok(workflowDiscovery, "workflow discovery must be a null-delimited tracked-file query");
  assert.deepEqual(
    [...workflowDiscovery[1].matchAll(/':\(glob\)(\.github\/workflows\/\*\.(?:yml|yaml))'/g)].map(
      (match) => match[1],
    ),
    [".github/workflows/*.yml", ".github/workflows/*.yaml"],
    "workflow discovery must cover both workflow extensions",
  );
  assert.match(
    lintStep.run,
    /if \(\(\$\{#workflow_files\[@\]\} == 0\)\); then[\s\S]*?exit 1/,
    "workflow lint must fail closed when discovery finds no files",
  );
  assert.match(
    lintStep.run,
    /for workflow_file in "\$\{workflow_files\[@\]\}"; do[\s\S]*workflow_args\+=\("\/repo\/\$workflow_file"\)/,
    "actionlint must receive every discovered workflow path",
  );
  assert.match(
    lintStep.run,
    /docker run --rm --network none -v "\$GITHUB_WORKSPACE:\/repo:ro" -w \/repo "\$ACTIONLINT_IMAGE" "\$\{workflow_args\[@\]\}"/,
  );
  assert.match(lintStep.run, /mapfile -d '' -t shell_files/);
  assert.match(
    lintStep.run,
    /for shell_file in "\$\{shell_files\[@\]\}"; do[\s\S]*shellcheck_args\+=\("\/repo\/\$shell_file"\)/,
    "ShellCheck must receive every tracked shell path",
  );
  assert.match(
    lintStep.run,
    /docker run --rm --network none -v "\$GITHUB_WORKSPACE:\/repo:ro" -w \/repo "\$SHELLCHECK_IMAGE" --severity=error --format=gcc "\$\{shellcheck_args\[@\]\}"/,
  );
  assert.doesNotMatch(lintStep.run, /actionlint\s+-shellcheck=|\bcommand -v shellcheck\b|git diff --name-only/);

  const contractStep = lintJob.steps.find((step) => step.name === "Run workflow and documentation contracts");
  assert.equal(contractStep?.run, "node --test backend/tests/workflow-and-docs.test.js");
  assert.match(source, /workflow-lint:/);
  const task6Step = lintJob.steps.find((step) => step.name === "Run direct Task 6 attestation and SSH contracts");
  assert.deepEqual(
    task6Step?.run.trim().split("\n"),
    [
      "set -euo pipefail",
      "test -f ops/tests/task-6-attestation-ssh.test.sh",
      "timeout --foreground 300s bash ops/tests/task-6-attestation-ssh.test.sh",
    ],
    "Task 6 must run directly with a bounded, fail-closed invocation",
  );
});

test("normal Compose releases revalidate main after protected approval and before transfer", () => {
  const { source, document } = loadWorkflow(path.join(workflowDirectory, "deploy-compose.yml"));
  const steps = document.jobs.deploy.steps;
  const revalidationIndex = steps.findIndex(
    (step) => step.name === "Revalidate normal release against current main after approval",
  );
  const transferIndex = steps.findIndex(
    (step) => step.name === "Transfer the verified manifest and invoke the fixed root deployment script",
  );
  assert.ok(revalidationIndex >= 0);
  assert.equal(revalidationIndex + 1, transferIndex);
  const revalidation = steps[revalidationIndex];
  assert.equal(revalidation.env.RELEASE_MODE, "${{ needs.resolve-build.outputs.release_mode }}");
  assert.equal(revalidation.env.RELEASE_SHA, "${{ needs.resolve-build.outputs.release_sha }}");
  assert.match(revalidation.run, /case "\$RELEASE_MODE" in/);
  assert.match(revalidation.run, /normal\)[\s\S]*gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads\/main"/);
  assert.match(revalidation.run, /test "\$main_head_sha" = "\$RELEASE_SHA"/);
  assert.doesNotMatch(revalidation.run, /adoption|FIRST_COMPOSE_ADOPTION_OWNER_APPROVAL_SHA/);
  assert.match(revalidation.run, /rollback\)\s*;\;/);
  assert.doesNotMatch(revalidation.run, /scp|ssh\b|sudo\b/);
  assert.match(source, /environment: production-compose/);
});

test("PostgreSQL 17 CI recovery contract follows current and historical headings", () => {
  const ci = read(".github/workflows/ci.yml");
  const recovery = read("docs/backup-and-disaster-recovery.md");

  assert.match(recovery, /^### Historical pre-first-write rollback boundary \(superseded 2026-08-31\)$/m);
  assert.match(recovery, /^### Post-first-write Compose recovery \(after first PostgreSQL 17 writer\)$/m);
  assert.match(ci, /Historical pre-first-write rollback boundary \(superseded 2026-08-31\)/);
  assert.match(ci, /Post-first-write Compose recovery \(after first PostgreSQL 17 writer\)/);
  assert.match(ci, /supabase_url_rollback=prohibited/);
  assert.match(ci, /Do not set either runtime URL to Supabase/);
  assert.doesNotMatch(ci, /grep -F 'Post-first-write rollback boundary'/);
});

test("stale backup TLS variable guard covers the entire recovery document", () => {
  const recoveryDocument = read("docs/backup-and-disaster-recovery.md");
  const recoveryStatus = section(
    recoveryDocument,
    "## Repository-recorded production recovery status",
    "## Recovery objectives and limitations",
  );

  assert.throws(
    () => assertNoStaleBackupVariableNames(`${recoveryStatus}\n\n## Historical notes\nBACKUP_CLIENT_TLS_KEY_FILE`),
    /removed TLS variable names/,
    "a stale name outside the recovery-status subsection must still be rejected",
  );
  assertNoStaleBackupVariableNames(
    recoveryDocument,
    "backup documentation must not use any removed TLS variable names anywhere",
  );
});

test("private APK release authenticates its post-checkout fetch without restoring credentials", () => {
  const { source, document } = loadWorkflow(path.join(workflowDirectory, "release-admin-apk.yml"));
  const steps = document.jobs["build-and-release"].steps;
  const checkout = steps.find((step) => step.name === "Check out release source");
  assert.equal(checkout.with["persist-credentials"], false);

  const verify = steps.find((step) => step.name === "Verify tag is the tested main commit");
  assert.ok(verify?.run);
  assert.equal(verify.env.GH_TOKEN, "${{ github.token }}");
  assert.match(
    verify.run,
    /(?:^|\n)\s*export GIT_CONFIG_COUNT=1\s*\n\s*export GIT_CONFIG_KEY_0=http\.extraheader\s*\n\s*export GIT_CONFIG_VALUE_0="Authorization: Bearer \$GH_TOKEN"\s*\n/,
    "the private-repository fetch must configure an ephemeral token extraheader through the environment",
  );
  assert.match(
    verify.run,
    /(?:^|\n)\s*git fetch --no-tags origin main\s*($|\n)/,
    "the private-repository fetch must use the configured extraheader",
  );
  assert.match(
    verify.run,
    /trap ['"]unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 GH_TOKEN['"] EXIT/,
    "the transient token configuration must be cleaned up",
  );
  const gitCommandLines = verify.run.split("\n").filter((line) => /\bgit\b/.test(line));
  assert.ok(gitCommandLines.length > 0);
  assert.ok(
    gitCommandLines.every((line) => !/\bGH_TOKEN\b/.test(line)),
    "the Git token must not appear in a Git process argument",
  );
  assert.doesNotMatch(verify.run, /\bgit\b[^\n]*\s-c\s/);
  assert.doesNotMatch(verify.run, /(?:echo|printf)[^\n]*GH_TOKEN/);
  assert.doesNotMatch(verify.run, /set -x/);
  assert.equal(document.permissions.contents, "write", "release publication authority must remain intact");
  assert.match(source, /persist-credentials: false/);
});

test("operator documentation agrees on cutover, TLS, backup, and remaining host gates", () => {
  const ciDocument = read("docs/ci-cd.md");
  const ci = section(ciDocument, "## Production flow", "## Active workflows");
  const setup = section(read("docs/setup-and-deployment.md"), "## Current production status", "## Requirements");
  const runbook = section(read("docs/production-runbook.md"), "## Current production status", "## Current Topology");
  const recoveryDocument = read("docs/backup-and-disaster-recovery.md");
  const recovery = section(recoveryDocument, "## Repository-recorded production recovery status", "## Recovery objectives and limitations");
  const environment = section(read("docs/environment-reference.md"), "## Production database status", "## Backend — process, database, cache, and sessions");
  const handoff = read("docs/superpowers/plans/2026-08-31-backend-containerisation-handoff.md");
  const collaboration = read("docs/collaboration-and-staging.md");
  const backupImplementation = read("ops/backup-production-multi-remote.sh");
  const backupExample = read("ops/quest-esports-backup.env.example");

  for (const [name, document] of Object.entries({ setup, recovery, environment })) {
    const normalized = document.replace(/\s+/g, " ");
    assert.match(normalized, /2026-08-31/);
    assert.match(normalized, /PostgreSQL \*{0,2}17\.11\*{0,2}/);
    assert.match(normalized, /quest-postgres/);
    assert.match(normalized, /127\.0\.0\.1:5433/);
    assert.match(normalized, /Supabase[^.]*stale[^.]*(?:not a rollback target|not.*rollback)/i, name);
    assert.match(normalized, /No rehearsal was performed|rehearsal[^.]*skipped|rehearsal[^.]*not performed/i, name);
  }

  assert.match(ci.replace(/\s+/g, " "), /push to main.*CI.*Compose release/i);
  assert.match(ci.replace(/\s+/g, " "), /build, sign, and attest four application images/i);
  assert.match(ci.replace(/\s+/g, " "), /compose-release-success/i);
  assert.doesNotMatch(ci, /legacy-pm2|FRONTEND_DEPLOY_ENABLED|BACKEND_DEPLOY_ENABLED/);
  assert.match(setup.replace(/\s+/g, " "), /Compose adoption[^.]*blocked|TLS[^.]*blocks Compose adoption/i);
  assert.match(setup.replace(/\s+/g, " "), /interim[^.]*backup/i);
  assert.match(runbook.replace(/\s+/g, " "), /PostgreSQL \*{0,2}17\.11\*{0,2}[^.]*quest-postgres/);
  assert.match(runbook.replace(/\s+/g, " "), /run in the production Compose topology/i);
  assert.match(runbook.replace(/\s+/g, " "), /verify-full private-CA TLS/i);
  assert.match(runbook.replace(/\s+/g, " "), /Supabase remains stale recovery material.*not a rollback target/i);
  assert.match(recovery, /Restore-drill status.*Skipped/i);
  assert.match(
    recovery,
    /The backup pipeline requires `POSTGRES_CA_FILE`,\s*`BACKUP_CLIENT_CERT_FILE`, and\s*`BACKUP_CLIENT_KEY_FILE`/,
    "backup documentation must use the canonical TLS variable names",
  );
  assertNoStaleBackupVariableNames(
    recoveryDocument,
    "backup documentation must not use removed TLS variable names anywhere",
  );
  for (const variable of ["POSTGRES_CA_FILE", "BACKUP_CLIENT_CERT_FILE", "BACKUP_CLIENT_KEY_FILE"]) {
    assert.match(backupImplementation, new RegExp(`\\b${variable}\\b`), `${variable} must remain in the backup implementation`);
    assert.match(backupExample, new RegExp(`^${variable}=`, "m"), `${variable} must remain in the backup example`);
  }
  assert.match(environment, /DATABASE_URL.*sslmode=verify-full/);
  assert.match(environment.replace(/\s+/g, " "), /BACKUP_CLIENT_CERT_FILE.*BACKUP_CLIENT_KEY_FILE/);
  assert.match(handoff, /POSTGRES_CA_FILE, BACKUP_CLIENT_CERT_FILE, BACKUP_CLIENT_KEY_FILE/);
  assert.match(handoff, /`BACKUP_CLIENT_CA_FILE` is not part of the contract/);
  assert.match(handoff, /asyncpg-form and uses `ssl=require`/);
  assert.match(
    handoff,
    /VALORANT_DATABASE_SSL_CA_FILE[\s\S]*VALORANT_DATABASE_SSL_SERVER_HOSTNAME[\s\S]*VALORANT_DATABASE_SSL_VERIFY=full/,
  );
  assert.doesNotMatch(handoff, /ssl=verify-full/);
  assert.match(collaboration, /Production is the VPS PostgreSQL \*{0,2}17\.11\*{0,2} container `quest-postgres`/);
  assert.match(collaboration.replace(/\s+/g, " "), /not a production rollback target.*not a Supabase production SQL editor/);
  assert.doesNotMatch(collaboration, /Run the production statement|PRODUCTION_PROJECT_REF/);

  assert.match(ciDocument, /No personal access token or sibling-repository checkout is required/);
  assert.doesNotMatch(ciDocument, /VALORANT_PLATFORM_ACCESS_TOKEN|deploy-frontend\.yml|workflows\/cd\.yml/);

  const productionChecklist = section(
    read("docs/setup-and-deployment.md"),
    "## Production Environment Checklist",
    "## Reverse Proxy Notes",
  );
  assert.match(productionChecklist, /DATABASE_URL=.*sslmode=verify-full/);
  assert.match(productionChecklist, /DIRECT_URL=.*sslmode=verify-full/);
  assert.doesNotMatch(productionChecklist, /sslmode=require/);

  const migrationPlan = read("docs/superpowers/plans/2026-08-29-vps-database-migration.md");
  assert.match(migrationPlan, /## Execution reconciliation \(2026-08-31\)/);
  assert.match(migrationPlan, /cutover completed[^\n]*2026-08-31/i);
  assert.match(migrationPlan.replace(/\s+/g, " "), /No rehearsal was performed.*retroactively/i);
  assert.match(migrationPlan, /TLS[^\n]*Compose adoption[^\n]*backup/i);
});

test("operator documents keep live VPS, test Supabase, and release-input claims consistent", () => {
  const valorant = read("docs/valorant-integration.md");
  const valorantTopology = section(valorant, "### 2.1 Topology", "### 2.2 Two schemas, four roles");
  assert.match(valorantTopology, /VPS PostgreSQL 17\.11/);
  assert.match(valorantTopology, /quest-postgres/);
  assert.match(valorantTopology, /127\.0\.0\.1:5433/);
  assert.doesNotMatch(valorantTopology, /Supabase/i);
  const valorantLocal = section(valorant, "## 6. Local development", "## 7. Verification — what is verified vs prospective");
  assert.match(valorantLocal, /dedicated Supabase test project/);

  const checklist = read("docs/pre-deployment-checklist.md");
  assert.match(checklist, /live VPS PostgreSQL.*quest-postgres/i);
  assert.doesNotMatch(checklist, /production Supabase|Paris Supabase/i);

  const safety = read("docs/DEPLOYMENT_SAFETY.md");
  const migrationSpec = read("docs/superpowers/specs/2026-08-29-vps-database-migration-design.md");
  assert.match(migrationSpec, /Status:\*\* Superseded historical design; live-state addendum below/);
  assert.match(migrationSpec.replace(/\s+/g, " "), /Live-state addendum.*cutover completed on \*\*2026-08-31\*\*.*quest-postgres.*17\.11.*127\.0\.0\.1:5433/);
  assert.match(migrationSpec, /rehearsal was skipped and[\s\S]*cannot be performed[\s\S]*retroactively/);
  assert.match(migrationSpec, /Supabase is stale[\s\S]*?not a rollback target/);
  assert.match(migrationSpec, /TLS material blocks Compose adoption[\s\S]*backup pipeline/);
  assert.match(migrationSpec, /unrestricted deploy-root access and two GitHub Actions keys/i);
  assert.match(safety, /The normal production authority is immutable Docker Compose/);
  assert.match(safety, /retired PM2 and Vercel[\s\S]*not deployment alternatives/);
  assert.match(safety.replace(/\s+/g, " "), /After approval.*main.*RELEASE_SHA.*SSH\/scp/);
  assert.match(safety, /quest-postgres[\s\S]*17\.11/);
  assert.match(safety, /access-restricted backups/i);
  const safetyValorant = section(safety, "## VALORANT two-schema expand-first rules (Quest + valorant-platform-backend)");
  assert.match(safetyValorant, /live VPS[\s\S]*PostgreSQL 17\.11[\s\S]*quest-postgres/);
  assert.match(safetyValorant, /dedicated Supabase test project[\s\S]*not a production target/);
  assert.doesNotMatch(safety, /live Paris database|production Supabase project/i);

  const database = section(
    read("docs/database-and-storage.md"),
    "## Backup And Operations Guidance",
    "## Production Improvement Opportunities",
  );
  assert.match(database, /live VPS PostgreSQL 17\.11[\s\S]*quest-postgres[\s\S]*127\.0\.0\.1:5433/);
  assert.match(database, /historical\/pre-cutover or staging tooling/);
  assert.doesNotMatch(database, /live Paris database|target Supabase project/i);

  const setupStatus = section(read("docs/setup-and-deployment.md"), "## Current production status", "## Requirements");
  assert.match(setupStatus, /2026-08-31[\s\S]*quest-postgres[\s\S]*127\.0\.0\.1:5433/);
  assert.match(setupStatus, /Supabase[\s\S]*not a rollback target/);
  assert.doesNotMatch(setupStatus, /Supabase[^\n]*rollback material/i);

  const environment = read("docs/environment-reference.md");
  const e2e = section(environment, "## VALORANT two-service E2E contract", "## Deployment and release controls");
  assert.match(e2e, /protected, manual, owner-gated/);
  assert.match(e2e, /not ordinary CI or a[\s\S]*pull-request check/);
  const releaseControls = section(environment, "## Deployment and release controls", "## Backup and recovery controls");
  assert.match(releaseControls, /`rollback_sha`/);
  assert.match(releaseControls, /`COMPOSE_DEPLOY_ENABLED`/);
  assert.doesNotMatch(releaseControls, /`compose_run_id`|`deploy_sha`|`BACKEND_DEPLOY_ENABLED`|`FRONTEND_DEPLOY_ENABLED`/);
  assert.match(environment, /Production `DATABASE_URL` and `DIRECT_URL` must use `sslmode=verify-full`/);
  assert.match(environment, /VPS container `quest-postgres`/);

  const runbook = read("docs/production-runbook.md");
  assert.doesNotMatch(runbook, /sslmode=require/);
  assert.match(runbook, /verify-full private-CA TLS/);
  assert.match(runbook, /Production environment files are root-controlled outside Git/);
});
