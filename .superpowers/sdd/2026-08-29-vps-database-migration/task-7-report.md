# Task 7 implementation report

## Implementation

- Updated the production runbook to identify PostgreSQL 17 on the VPS as the
  target, keep Supabase as temporary rollback material, retain native
  PostgreSQL 16.15 during staging, and document loopback-only staging access at
  `127.0.0.1:55432` with no public database port.
- Added owner-input gates, host preparation, TLS/SAN, role/password delivery,
  staged Compose commands, exact cutover acknowledgements, observation metrics,
  PG16 retirement rules, and pre/post-writer stop/mask behavior.
- Added the post-first-write recovery boundary and explicit `--no-acl` parked
  compatibility decision to the recovery documentation.
- Clarified the setup guide's production Compose target and kept the legacy
  PM2 flow explicitly pre-cutover-only.
- Added a `postgres17-contracts` CI job with static Compose/bootstrap/backup/
  rehearsal assertions and disposable PostgreSQL 17 contract suites. The
  existing CI `postgres:16` service remains unchanged.

## Commands and exact outputs

```text
git diff --check
```

Output: exit status 0; Git printed only existing LF-to-CRLF working-copy
warnings for the modified Markdown files.

```text
python -c "import yaml; p=yaml.safe_load(open('.github/workflows/ci.yml')); assert 'postgres17-contracts' in p['jobs']; assert p['jobs']['backend']['services']['postgres']['image']=='postgres:16'; print('CI YAML parsed; PG16 fixture retained; postgres17-contracts job present')"
```

Output:

```text
CI YAML parsed; PG16 fixture retained; postgres17-contracts job present
```

```text
python -c "from pathlib import Path; files=['docs/production-runbook.md','docs/setup-and-deployment.md','docs/backup-and-disaster-recovery.md','docs/ci-cd.md','ops/docker/postgres/README.md']; refs=['docs/developer-guide.md','docs/environment-reference.md','docs/valorant-local-development.md','docs/backup-and-disaster-recovery.md','docs/production-runbook.md','docs/setup-and-deployment.md','docs/ci-cd.md','ops/docker/compose.production.yml','ops/docker/compose.postgres-staging.yml','ops/quest-esports-backup.env.example']; missing=[ref for ref in refs if not Path(ref).exists()]; assert not missing, missing; print('checked relative Markdown targets; missing=[]')"
```

Output:

```text
checked relative Markdown targets; missing=[]
```

```text
npx --no-install markdown-link-check docs/production-runbook.md docs/setup-and-deployment.md docs/backup-and-disaster-recovery.md docs/ci-cd.md ops/docker/postgres/README.md
```

Output: unavailable; `markdown-link-check@3.15.0` was not installed and npx
cancelled without downloading packages. The local relative-target check passed.

```text
& "C:\Program Files\Git\bin\bash.exe" -n ops/tests/deploy-release.test.sh ops/tests/media-backup-contract.test.sh ops/tests/restore-production-backup.test.sh ops/tests/postgres17-rehearsal.test.sh
```

Output: none; passed.

```text
npm test --prefix frontend
```

Output: `46 passed` test files, `294 passed` tests; passed.

```text
npm test --prefix backend
```

Output: `1121 passed`, `2 failed`, `11 skipped` (1134 tests). The failures were
the existing `production restore passes the target database through pg_restore
--dbname` assertion, which expected `/pg_restore --dbname="$DIRECT_URL"/`,
and `production backup wrapper locks before delegated two-pass snapshot`,
which did not observe the expected fixture ordering. No application source was
changed to address these unrelated failures.

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/media-backup-contract.test.sh
```

Output: `media backup contract fixture tests passed`; passed.

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/restore-production-backup.test.sh
```

Output: `File activation and a transactional database restore begin in 0
seconds.`, followed by `restore schema ownership regression test passed`;
passed.

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/deploy-release.test.sh
```

Output: the Windows ownership fixture printed
`SKIP: canonical TLS ownership fixture skipped because Windows Git Bash cannot
create or observe POSIX ownership changes.`; the process did not complete within
300 seconds and was terminated by the validation harness.

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/postgres17-rehearsal.test.sh
```

Output: the process did not complete within the available Windows Git Bash
validation window; the negative fixture output reached `ok: decryption failure`
before the harness terminated the process. It was not reported as passed.

## Self-review

- The CI fixture remains exactly `postgres:16`; PostgreSQL 17 is checked through
  a separate job and synthetic, non-secret Compose values.
- The documentation preserves the required `--no-acl` restore decision and
  says ACL normalization is performed by the canonical bootstrap/verifier.
- Owner-supplied RPO/RTO and live host evidence are labelled as inputs; no
  checked-in file is described as proof of live VPS state.
- No VPS, production database, backup remote, hosted endpoint, credential,
  private key, or production archive was contacted or changed.

## Concerns

- `markdown-link-check` and actionlint are not installed in this environment;
  YAML parsing and a local relative Markdown-target check were used instead.
- Backend tests retain two unrelated existing failures, and the deployment and
  rehearsal shell suites could not complete under Windows Git Bash within the
  available validation windows. The controller should rerun those suites in
  the intended Linux/GitHub Actions environment.
- The CI Compose render uses an empty disposable `/etc/quest-esports/quest.production.env`
  placeholder on Linux runners; it does not assert or imply production secret
  availability.

## Fix round 1

### Changed files

- `docs/backup-and-disaster-recovery.md` — split intentional production restore
  into pre-cutover legacy PM2 recovery and post-first-write Compose recovery;
  require both current Quest/VALORANT writer stops, coordinated freeze,
  PostgreSQL 17 recovery, and no Supabase URL rollback. Documented the exact
  loopback backup endpoint lifecycle and the four legacy stop/mask controls.
- `docs/production-runbook.md` — documented the exact old Quest/VALORANT
  stop/mask wrappers and durable-commit ordering, clarified the loopback-overlay
  exception for the host backup service, and removed the Paris session-pooler
  backup instruction.
- `docs/setup-and-deployment.md` — linked directly to the post-first-write
  rollback boundary and clarified the backup-only staging-overlay exception.
- `.github/workflows/ci.yml` — rendered base and staging Compose JSON with fake
  immutable values, asserted no base PostgreSQL publication and exactly
  loopback `55432` staging publication, and bound `NOBYPASSRLS` to each exact
  role ALTER ROLE statement while retaining the `postgres:16` fixture.
- `backend/tests/backup-scripts.test.js` — updated only stale expectations for
  the intentional pinned PostgreSQL client invocations.

### Commands and exact outputs

```text
npm test --prefix backend
```

```text
1..1113
# tests 1134
# suites 0
# pass 1123
# fail 0
# cancelled 0
# skipped 11
# todo 0
```

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/deploy-release.test.sh
```

```text
SKIP: canonical TLS ownership fixture skipped because Windows Git Bash cannot create or observe POSIX ownership changes.
deploy release fixture tests passed
```

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/postgres17-rehearsal.test.sh
```

```text
ok: successful wrapper-path pre/post evidence generation
ok: valid signed evidence
...
ok: blocked writer/freeze evidence
PostgreSQL 17 rehearsal fixture tests passed (no Docker, database, VPS, or remote contacted).
```

```text
& "C:\Program Files\Git\bin\bash.exe" -n ops/tests/deploy-release.test.sh ops/tests/postgres17-rehearsal.test.sh ops/backup-production.sh ops/backup-production-multi-remote.sh ops/restore-production-backup.sh
```

```text
(no output; exit status 0)
```

```text
git diff --check
```

```text
exit status 0; Git printed only existing LF-to-CRLF working-copy warnings for modified files.
```

```text
python -c "import yaml; p=yaml.safe_load(open('.github/workflows/ci.yml')); assert 'postgres17-contracts' in p['jobs']; assert p['jobs']['backend']['services']['postgres']['image']=='postgres:16'; print('CI YAML parsed; PG16 fixture retained; postgres17-contracts job present')"
```

```text
CI YAML parsed; PG16 fixture retained; postgres17-contracts job present
```

### Self-review

- Production behavior was not changed; the backend test changes only match the
  existing pinned `pg_dump`/`pg_restore` variables.
- The restore boundary now has separate PM2-before-cutover and Compose-after-
  first-write procedures. Post-first-write recovery stops both current writer
  groups, captures current PostgreSQL 17/upload state, and prohibits blind
  Supabase URL rollback.
- Backup instructions now bind the host service to the documented PostgreSQL 17
  loopback target and state the precise overlay condition; the base Compose file
  remains without a host PostgreSQL publication.
- CI keeps the existing PostgreSQL 16 service unchanged and checks each runtime
  role's complete `ALTER ROLE ... NOBYPASSRLS` contract.
- No secrets, production URLs, VPS state, production database, backup remote,
  or live service were contacted or mutated.

### Concerns

- The Windows Git Bash deployment suite passed, with only its documented
  POSIX-ownership fixture skipped. The PostgreSQL 17 rehearsal suite passed
  without Docker/database/VPS/remote access.
- `markdown-link-check` and actionlint were not installed; link validation was
  limited to the direct anchor edits, repository-local references, YAML parsing,
  and shell syntax checks.
- The CI-only Docker Compose JSON render was not executed locally; Docker is
  installed, but the workflow assertion is intended for its Ubuntu runner and
  uses the runner's `/etc/quest-esports/quest.production.env` placeholder.

## Fix round 2

### Changed files

- `.github/workflows/ci.yml` — replaced the PostgreSQL 16 text-count assertion
  with a parsed workflow-YAML service assertion, proving the sole service image
  is the unchanged `postgres:16` fixture without matching the assertion text;
  retained the rendered base/staging PostgreSQL 17 checks and added static
  checks for the supported backup/restore lifecycle.
- `docs/production-runbook.md` — selected the keep/reapply staging-overlay path
  for host backup and restore, documented exact timer/service stop and overlay
  start controls, and removed the unimplemented private-network utility option.
- `docs/backup-and-disaster-recovery.md` — made loopback overlay connectivity
  mandatory for post-first-write host restore, stopped backup timers/services
  around the restore, and re-enabled them only after validation.
- `docs/setup-and-deployment.md` — clarified that host backup and restore keep
  or reapply the loopback overlay and never substitute a private utility or
  Supabase.
- `ops/docker/postgres/README.md` — aligned the PostgreSQL overlay lifecycle
  and exact timer controls with the supported host backup/restore path.

### Commands and exact outputs

```text
& "C:\Program Files\Git\bin\bash.exe" -n ops/tests/deploy-release.test.sh ops/tests/postgres17-rehearsal.test.sh ops/tests/media-backup-contract.test.sh ops/tests/restore-production-backup.test.sh ops/tests/backup-multi-remote.test.sh ops/backup-production.sh ops/backup-production-multi-remote.sh ops/restore-production-backup.sh ops/rehearsal/postgres17-restore-rehearsal.sh
```

Output:

```text
shell syntax passed
```

```text
python -c "import yaml; from pathlib import Path; p=yaml.safe_load(Path('.github/workflows/ci.yml').read_text(encoding='utf-8')); b=p['jobs']['backend']['services']['postgres']; imgs=[s['image'] for j in p['jobs'].values() for s in j.get('services',{}).values() if isinstance(s,dict) and 'image' in s]; assert b['image']=='postgres:16'; assert imgs==['postgres:16'], imgs; print('Workflow YAML parsed; exactly one PostgreSQL service fixture is postgres:16; rendered PG17 checks remain in job script')"
```

Output:

```text
Workflow YAML parsed; exactly one PostgreSQL service fixture is postgres:16; rendered PG17 checks remain in job script
```

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/deploy-release.test.sh
```

Output: with the strongest available Windows Git Bash timeout (600 seconds),
the fixture printed:

```text
SKIP: canonical TLS ownership fixture skipped because Windows Git Bash cannot create or observe POSIX ownership changes.
release refused: could not record the Quest writer admission boundary.
post-commit boundary: stopping both writer groups and re-enabling coordinated freeze.
URGENT: post-commit recovery requires an explicit expected-loss/RPO record.
URGENT: post-commit recovery requires incident-owner approval.
```

The validation harness terminated the command after 600000 ms. It was not
reported as passed.

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/postgres17-rehearsal.test.sh
```

Output:

```text
ok: missing confirmation
ok: production-looking target
ok: missing target sentinel
ok: world-readable target sentinel
ok: group-readable target sentinel
ok: existing generic upload parent
ok: URL/container port mismatch
ok: nested roots
ok: traversal target
ok: bad checksum
ok: decryption failure
ok: successful wrapper-path pre/post evidence generation
ok: valid signed evidence
ok: arbitrary ACL payload
ok: wrong ACL grantee
ok: wrong ACL privilege
ok: PUBLIC default ACL grant
ok: extra default ACL row
ok: unsafe extension version
ok: unsafe PostgreSQL setting
ok: uncontained wrong-CA evidence
ok: unknown failed-service identity
ok: unprotected public table
ok: policy-count/artifact mismatch
ok: non-permission denial error
ok: quiet-mode write output
ok: plaintext session
ok: failed cleanup
ok: summary/observation status mismatch
ok: summary without raw observations
ok: incomplete manifest evidence
ok: wrong health evidence
ok: blocked writer/freeze evidence
PostgreSQL 17 rehearsal fixture tests passed (no Docker, database, VPS, or remote contacted).
```

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/media-backup-contract.test.sh; if ($?) { & "C:\Program Files\Git\bin\bash.exe" ops/tests/restore-production-backup.test.sh }; if ($?) { & "C:\Program Files\Git\bin\bash.exe" ops/tests/backup-multi-remote.test.sh }
```

Output:

```text
media backup contract fixture tests passed
File activation and a transactional database restore begin in 0 seconds. Press Ctrl+C to abort.
restore schema ownership regression test passed
Encrypted production backup uploaded successfully: quest-production-20260830T023411Z.tar.gz.enc
Another release operation is already running.
Production backup configuration is not canonical or private.
Rclone configuration paths must be readable and unique.
Production backup was created but one or more required remotes failed; see the per-run result record.
No locally valid and remotely verified production backup/checksum pair newer than 2160 minutes was found.
No locally valid and remotely verified production backup/checksum pair newer than 2160 minutes was found.
Inspected remote label primary.
Inspected remote label secondary.
Remote retention candidate archives for label primary: 1; recovery points retained: 4.
Remote retention deletion was incomplete for label primary; the recovery pair was retained.
Remote retention candidate archives for label secondary: 1; recovery points retained: 3.
Encrypted production backup uploaded successfully: quest-production-20260830T023439Z.tar.gz.enc
backup multi-remote fixture tests passed
```

The expected negative-case diagnostics are part of the disposable multi-remote
fixture; the final success lines show the media, restore, and multi-remote
suites passed.

```text
npm test --prefix backend
```

Output:

```text
1..1113
# tests 1134
# pass 1123
# fail 0
# cancelled 0
# skipped 11
# todo 0
# duration_ms 18983.5348
```

```text
npm test --prefix frontend
```

Output:

```text
Test Files  46 passed (46)
Tests  294 passed (294)
```

```text
docker info --format '{{.ServerVersion}}'
docker compose version
```

Output:

```text
28.0.4
Docker Compose version v2.34.0-desktop.1
```

```text
$env:QUEST_FRONTEND_IMAGE='ghcr.io/example/frontend@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; $env:QUEST_BACKEND_IMAGE='ghcr.io/example/backend@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; $env:POSTGRES_IMAGE='postgres:17-bookworm@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'; $env:VALORANT_IMAGE='ghcr.io/example/valorant@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'; $env:POSTGRES_STAGING_HOST_PORT='55432'; docker compose -f ops/docker/compose.production.yml config --format json; if ($?) { docker compose -f ops/docker/compose.production.yml -f ops/docker/compose.postgres-staging.yml config --format json }
```

Output:

```text
env file D:\Work\Projects\QuestEsports\ops\docker\etc\quest-esports\quest.production.env not found: CreateFile D:\Work\Projects\QuestEsports\ops\docker\etc\quest-esports\quest.production.env: The system cannot find the path specified.
```

The genuine rendered base/staging checks remain in the Ubuntu CI job. Local
Windows rendering could not proceed because the workflow's absolute Linux
`/etc/quest-esports/quest.production.env` service env file is unavailable.

```text
npx --no-install markdown-link-check docs/production-runbook.md docs/setup-and-deployment.md docs/backup-and-disaster-recovery.md docs/ci-cd.md ops/docker/postgres/README.md
```

Output:

```text
npm error npx canceled due to missing packages and no YES option: ["markdown-link-check@3.15.0"]
```

```text
python -c "from pathlib import Path; refs=['docs/developer-guide.md','docs/environment-reference.md','docs/valorant-local-development.md','docs/backup-and-disaster-recovery.md','docs/production-runbook.md','docs/setup-and-deployment.md','docs/ci-cd.md','ops/docker/compose.production.yml','ops/docker/compose.postgres-staging.yml','ops/quest-esports-backup.env.example']; missing=[ref for ref in refs if not Path(ref).exists()]; assert not missing, missing; print('checked relative Markdown targets; missing=[]')"
```

Output:

```text
checked relative Markdown targets; missing=[]
```

```text
git diff --check
```

Output: exit status 0; Git printed only existing LF-to-CRLF working-copy
warnings for the modified Markdown files.

```text
Get-Command actionlint, docker, npx
```

Output:

```text
actionlint=unavailable
docker=C:\Program Files\Docker\Docker\resources\bin\docker.exe
npx=C:\Program Files\nodejs\npx.ps1
```

### Self-review

- The workflow no longer counts its own command text. Parsed YAML proves that
  `backend.services.postgres.image` is exactly `postgres:16` and that the only
  workflow service image is that unchanged fixture; rendered base/staging
  PostgreSQL 17 Compose checks remain after this assertion.
- Host-run backup and post-first-write restore now have one supported
  connectivity path: PostgreSQL runs with the loopback staging overlay and the
  exact `127.0.0.1:55432` endpoint. Timers/services are stopped before restore
  and re-enabled after validation. No unimplemented private utility is claimed.
- Supabase remains temporary pre-first-writer rollback material only and is
  explicitly prohibited as a backup or restore target after the first VPS
  writer. Exact target, security, cutover, `--no-acl`, and no-public-port
  contracts were preserved.
- No secrets, live VPS state, production database, backup remote, hosted
  endpoint, or production service was contacted or mutated.

### Concerns

- The deployment fixture did not complete under Windows Git Bash even with the
  strongest available 600-second timeout; it emitted its ownership skip and
  expected recovery-guard diagnostics before harness termination. It needs a
  Linux/GitHub Actions rerun and is not a pass here.
- `markdown-link-check` and actionlint are unavailable locally. Relative target
  checks and YAML parsing passed; the Ubuntu CI job retains the Docker Compose
  render and shell contract checks.
- Docker and Compose are installed locally, but Compose rendering cannot reach
  the workflow's Linux `/etc/quest-esports/quest.production.env` placeholder on
  Windows. No production or live-state command was attempted.
