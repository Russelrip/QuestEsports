# Task 4 implementation report

## Implementation

- Pinned `psql`, `pg_dump`, and `pg_restore` to absolute PostgreSQL 17
  executables, accepting either `POSTGRES17_BIN` or individually pinned path
  variables; no PostgreSQL client is discovered through `PATH`.
- Bound production backup URLs to `quest_backup`, `127.0.0.1:55432`, database
  `quest`, PostgreSQL 17, `sslmode=verify-full`, canonical TLS material, and
  the root-owned PostgreSQL target sentinel grammar.
- Made the `public` plus `valorant` custom-format archive scope mandatory;
  backup refuses a target missing `valorant` rather than downgrading silently.
- Added pre-activation restore checks for disposable or explicitly authorized
  production target identity, URL host/port/database, PostgreSQL major, TLS,
  loopback endpoint, sentinel fields, and disposable upload roots.
- Preserved encrypted archive, two-pass upload snapshot, confirmation token,
  cleanup/rollback guard, checksum, upload, and rclone verification behavior.
- Added secure disposable fixtures for target identity, schema omission,
  mutable client discovery, wrong endpoint/major/database, and unauthorized
  restore targets.

## Commands and outputs

The environment did not provide `/bin/bash`:

```text
WSL (3594 - Relay) ERROR: CreateProcessCommon:640: execvpe(/bin/bash) failed: No such file or directory
```

Installed Git Bash was used for the required checks:

```text
"C:\\Program Files\\Git\\bin\\bash.exe" -n ops/backup-production-multi-remote.sh ops/restore-production-backup.sh
```

Output: none; passed.

```text
"C:\\Program Files\\Git\\bin\\bash.exe" ops/tests/media-backup-contract.test.sh
```

Output:

```text
media backup contract fixture tests passed
```

```text
"C:\\Program Files\\Git\\bin\\bash.exe" ops/tests/restore-production-backup.test.sh
```

Output:

```text
File activation and a transactional database restore begin in 0 seconds. Press Ctrl+C to abort.
restore schema ownership regression test passed
```

```text
git diff --check
```

Output: no diff errors; Git reported only the existing LF-to-CRLF working-copy
warning for the example environment file.

## Self-review

- No production host, database, upload root, archive, credential, private key,
  or remote was contacted or changed.
- Test fixtures use temporary disposable roots, synthetic credentials, mode-600
  identity/CA/sentinel files, and fake clients; no secret-bearing output is
  emitted.
- The rehearsal compatibility path remains limited to the existing disposable
  rehearsal sentinel and still checks target PostgreSQL settings and TLS.

## Concerns

- The production backup environment template is outside the Task 4 file list;
  operators must populate its protected copy with the new target and TLS
  settings before running production backup.
- Live PostgreSQL 17 client, TLS, sentinel, and remote verification could not
  be exercised in this checkout; only the assigned disposable contract tests
  were used for acceptance.

## Final validation addendum

After requiring the exact two-schema manifest during restore, the required
checks were rerun with installed Git Bash:

```text
"C:\\Program Files\\Git\\bin\\bash.exe" -n ops/backup-production-multi-remote.sh ops/restore-production-backup.sh
```

Output: none; passed.

```text
"C:\\Program Files\\Git\\bin\\bash.exe" ops/tests/media-backup-contract.test.sh
```

Output: `media backup contract fixture tests passed`.

```text
"C:\\Program Files\\Git\\bin\\bash.exe" ops/tests/restore-production-backup.test.sh
```

Output: `File activation and a transactional database restore begin in 0 seconds.`
and `restore schema ownership regression test passed`.

## Fix round 1

### Changed files

- `ops/backup-production-multi-remote.sh` — replaced configuration-controlled
  fixture bypass with an explicit `--test-fixture` argument; protected the
  mode/configuration decision from sourced configuration; enforced canonical
  production root, sentinel, TLS, and URL contracts; separated host
  publication `127.0.0.1:55432` from the Compose server-local `5432` endpoint;
  required a private container address, `quest_backup` session user, and
  `-X` target probes.
- `ops/backup-production.sh` — forwards the explicit test argument to the
  implementation script.
- `ops/restore-production-backup.sh` — replaced the fixture environment switch
  with an explicit command-line seam; removed fabricated endpoint fallback;
  enforced production database/data-root/sentinel/TLS contracts and immutable
  target identity; rejected URL query overrides; validated public and valorant
  TOC entries before staging/activation; added `-X` to all target `psql`
  commands.
- `ops/quest-esports-backup.env.example` — aligned the production backup
  example with the pinned client, canonical TLS, loopback publication, target,
  sentinel, and `quest_backup` contract.
- `ops/quest-esports-recovery.env.example` — aligned the recovery example with
  normal production restore mode, canonical target/TLS/sentinel/data-root
  paths, and no real credentials or fixture switches.
- `ops/rehearsal/postgres17-restore-rehearsal.sh` — passes the explicit test
  argument when invoking the disposable restore primitive and exposes its
  captured refusal diagnostic.
- `ops/tests/media-backup-contract.test.sh` — added realistic container
  endpoint/session observations, custom two-schema dump argument assertions,
  writable-sentinel refusal, and a public-only TOC negative archive proving no
  destructive restore, activation, or security SQL occurs.
- `ops/tests/restore-production-backup.test.sh` — added realistic TOC/client
  fixtures, mutable-client and writable-sentinel refusals, URL override
  coverage, `-X` coverage, and destructive-ordering assertions.
- `ops/tests/backup-multi-remote.test.sh` — supplied secure PostgreSQL target
  fixtures and updated all backup invocations to use the explicit test seam.
- `ops/tests/postgres17-rehearsal.test.sh` — supplied the actual container
  endpoint observation and realistic custom-archive TOC fixture.
- `.superpowers/sdd/2026-08-29-vps-database-migration/task-4-report.md` —
  appended this fix-round implementation, validation, self-review, and
  concerns record.

### Commands and exact outputs

```text
& "C:\Program Files\Git\bin\bash.exe" -n ops/backup-production.sh ops/backup-production-multi-remote.sh ops/restore-production-backup.sh ops/rehearsal/postgres17-restore-rehearsal.sh ops/tests/media-backup-contract.test.sh ops/tests/restore-production-backup.test.sh ops/tests/backup-multi-remote.test.sh ops/tests/postgres17-rehearsal.test.sh
```

Output: none; passed.

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/media-backup-contract.test.sh
```

Output:

```text
media backup contract fixture tests passed
```

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/restore-production-backup.test.sh
```

Output:

```text
File activation and a transactional database restore begin in 0 seconds. Press Ctrl+C to abort.
restore schema ownership regression test passed
```

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/backup-multi-remote.test.sh
```

```text
Encrypted production backup uploaded successfully: quest-production-20260829T122958Z.tar.gz.enc
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
Encrypted production backup uploaded successfully: quest-production-20260829T123018Z.tar.gz.enc
backup multi-remote fixture tests passed
```

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/postgres17-rehearsal.test.sh
```

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
ok: summary without raw observations
ok: incomplete manifest evidence
ok: wrong health evidence
ok: wrong CA evidence
ok: blocked writer/freeze evidence
PostgreSQL 17 rehearsal fixture tests passed (no Docker, database, VPS, or remote contacted).
```

```text
git diff --check
```

Output: no diff errors; Git emitted only the existing LF-to-CRLF working-copy
warning for `ops/quest-esports-recovery.env.example`.

### Self-review

- No `QUEST_BACKUP_FIXTURE` or `QUEST_RESTORE_FIXTURE` configuration bypass
  remains. The only fixture path is a command-line argument, and it is
  fail-closed for `/etc/quest-esports-backup.env`; the mode decision is
  readonly before configuration is sourced.
- Backup and restore now observe host publication and container server-local
  identity independently (`127.0.0.1:55432` versus private container address
  and `5432`) and never synthesize observations after a failed probe.
- URL query strings are rejected rather than allowed to override libpq
  connection/TLS parameters; TLS is supplied through the canonical environment
  contract, and backup verifies `session_user=quest_backup`.
- TOC validation, canonical security SQL preflight, and all destructive-order
  assertions occur before file activation, destructive `pg_restore`, or
  security SQL.
- Age encryption, rclone/checksum verification, upload snapshot ordering,
  confirmation tokens, cleanup/rollback guard, PostgreSQL 17 pinning,
  two-schema scope, and secret-free output remain intact.
- All fixtures use disposable temporary roots, private synthetic files, and
  fake clients; no VPS, production database, remote, or credential was
  contacted.

### Concerns

- A live production restore/backup was not exercised in this checkout; the
  canonical root-owned sentinel, PostgreSQL 17 client, TLS material, and
  Compose endpoint must still be verified on the deployment host.
- The normal recovery example intentionally requires the operator to provide
  protected TLS material, age identity, sentinel authorization, and the
  confirmation token out of band.

## Fix round 2

### Changed files

- `ops/backup-production-multi-remote.sh` — rejected group/other-writable CA
  and certificate files in addition to the existing root ownership and strict
  private-key checks.
- `ops/restore-production-backup.sh` — applied the TLS mode contract to all
  supplied TLS files, bound the observed restore session to the role parsed
  from `DIRECT_URL`, and replaced substring TOC checks with exact parsed schema
  and object-scope validation.
- `ops/quest-esports-recovery.env.example` — changed TLS paths to the canonical
  `/etc/quest-esports/tls/...` contract.
- `ops/tests/media-backup-contract.test.sh` — added a real extra-schema archive
  fixture and verified it is rejected before destructive restore, activation,
  or security SQL; retained public-only coverage.
- `ops/tests/restore-production-backup.test.sh` — added wrong observed session
  user, server-local endpoint, TLS, and writable-CA refusal fixtures, each
  asserting no destructive restore, activation, or security SQL.
- `.superpowers/sdd/2026-08-29-vps-database-migration/task-4-report.md` —
  appended this fix-round record.

### Commands and exact outputs

```text
& "C:\Program Files\Git\bin\bash.exe" -n ops/backup-production.sh ops/backup-production-multi-remote.sh ops/restore-production-backup.sh ops/rehearsal/postgres17-restore-rehearsal.sh ops/tests/media-backup-contract.test.sh ops/tests/restore-production-backup.test.sh ops/tests/backup-multi-remote.test.sh ops/tests/postgres17-rehearsal.test.sh
```

Output: none; `STATUS:0`.

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/media-backup-contract.test.sh
```

Output: `media backup contract fixture tests passed` (`STATUS:0`).

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/restore-production-backup.test.sh
```

Output: `File activation and a transactional database restore begin in 0 seconds.`
and `restore schema ownership regression test passed` (`STATUS:0`).

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/backup-multi-remote.test.sh
```

Output:

```text
Encrypted production backup uploaded successfully: quest-production-20260829T125625Z.tar.gz.enc
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
Encrypted production backup uploaded successfully: quest-production-20260829T125650Z.tar.gz.enc
backup multi-remote fixture tests passed
```

Result: `STATUS:0`.

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
ok: summary without raw observations
ok: incomplete manifest evidence
ok: wrong health evidence
ok: wrong CA evidence
ok: blocked writer/freeze evidence
PostgreSQL 17 rehearsal fixture tests passed (no Docker, database, VPS, or remote contacted).
```

Result: `STATUS:0`.

```text
git diff --check
```

Output: no diff errors; Git emitted only the existing LF-to-CRLF working-copy
warning for `ops/quest-esports-recovery.env.example` (`STATUS:0`).

### Self-review

- Restore now requires the observed `session_user` to equal the configured URL
  role, and observed TLS, private-container address, and server-local port
  remain independently checked.
- Canonical production CA, certificate, and key paths remain unchanged; all
  supplied TLS files reject group/other write bits and the key remains exact
  mode 600. No secret or credential value is printed.
- TOC parsing accepts normal PostgreSQL list spacing, requires exactly the
  `public` and `valorant` schema entries, rejects third schemas and duplicate
  schema entries, and compares object schema tokens exactly rather than by
  substring.
- Public-only and extra-schema archives, wrong observed identity/endpoint/TLS,
  and writable CA fixtures all prove refusal before destructive `pg_restore`,
  file activation, and security SQL. Existing client, flag, two-schema,
  encryption/rclone/checksum/upload/confirmation/cleanup, and rehearsal
  contracts remain covered.
- No VPS, production database, remote, credential, or private key was
  contacted or changed.

### Concerns

- A live production restore/backup was not exercised in this checkout; the
  canonical root-owned TLS material, PostgreSQL 17 clients, sentinel, and
  Compose endpoint still require deployment-host verification.
- The normal recovery example still requires operators to provide protected
  TLS material, age identity, sentinel authorization, and confirmation out of
  band.

## Fix round 3

### Changed files

- `ops/restore-production-backup.sh` — made TOC inspection fail closed for
  every non-comment entry, explicitly parsed schema/object scope for
  `FK CONSTRAINT`, `ROW SECURITY`, `POLICY`, `ACL`, `COMMENT`, and the other
  PostgreSQL custom-archive descriptors, and corrected `MATERIALIZED VIEW DATA`
  to read its schema after the `DATA` field while retaining legitimate global
  archive metadata.
- `ops/tests/restore-production-backup.test.sh` — added an activation move
  counter and asserted it is unchanged for mutable-client, sentinel, and all
  target-binding preflight refusals while retaining destructive restore and
  security-SQL ordering assertions.
- `ops/tests/media-backup-contract.test.sh` — added scoped-descriptor negative
  coverage, activation-counter checks for preflight refusals, and a valid
  two-schema materialized-view-data fixture that must activate successfully.
- `.superpowers/sdd/2026-08-29-vps-database-migration/task-4-report.md` —
  appended this round-3 record.

### Commands and exact outputs

```text
& "C:\Program Files\Git\bin\bash.exe" -n ops/backup-production.sh ops/backup-production-multi-remote.sh ops/restore-production-backup.sh ops/rehearsal/postgres17-restore-rehearsal.sh ops/tests/media-backup-contract.test.sh ops/tests/restore-production-backup.test.sh ops/tests/backup-multi-remote.test.sh ops/tests/postgres17-rehearsal.test.sh
```

Output: `STATUS:0`.

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/media-backup-contract.test.sh
```

Output:

```text
media backup contract fixture tests passed
STATUS:0
```

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/restore-production-backup.test.sh
```

Output:

```text
File activation and a transactional database restore begin in 0 seconds. Press Ctrl+C to abort.
restore schema ownership regression test passed
STATUS:0
```

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/backup-multi-remote.test.sh
```

Output:

```text
Encrypted production backup uploaded successfully: quest-production-20260829T132145Z.tar.gz.enc
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
Encrypted production backup uploaded successfully: quest-production-20260829T132212Z.tar.gz.enc
backup multi-remote fixture tests passed
STATUS:0
```

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
ok: summary without raw observations
ok: incomplete manifest evidence
ok: wrong health evidence
ok: wrong CA evidence
ok: blocked writer/freeze evidence
PostgreSQL 17 rehearsal fixture tests passed (no Docker, database, VPS, or remote contacted).
STATUS:0
```

```text
git diff --check
```

Output: no diff errors (`STATUS:0`).

### Self-review

- Every non-comment TOC line must match the PostgreSQL list grammar and a
  recognized descriptor. Schema-scoped descriptors are mapped to their exact
  schema field and must name only `public` or `valorant`; unsupported or
  ambiguous entries fail before staging, activation, destructive `pg_restore`,
  or security SQL. Recognized global metadata remains allowed without a fake
  schema assignment.
- `MATERIALIZED VIEW public name` and `MATERIALIZED VIEW DATA public name` now
  use their distinct field positions, so valid materialized-view data passes
  while an extra scoped descriptor fails.
- The activation counter records attempted `mv` operations in refusal fixtures;
  all preflight refusal assertions require no counter change and continue to
  check destructive `pg_restore` and security SQL logs.
- Strict TLS/session binding, canonical paths, explicit fixture seam,
  host/container endpoint distinction, PostgreSQL 17 pinning, both-schema
  scope, encryption/rclone/checksum/upload/confirmation/cleanup behavior, and
  secret-free output remain unchanged. No VPS, production database, remote,
  credential, or private key was contacted.

### Concerns

- A live production restore/backup was not exercised in this checkout; the
  canonical root-owned TLS material, PostgreSQL 17 clients, sentinel, and
  Compose endpoint still require deployment-host verification.
- The normal recovery example still requires operators to provide protected
  TLS material, age identity, sentinel authorization, and confirmation out of
  band.

## Fix round 4

### Changed files

- `ops/restore-production-backup.sh` — parsed PostgreSQL's distinct column
  `DEFAULT` and `DEFAULT ACL` TOC grammars; treated schema-qualified default
  ACL entries as schema-scoped and allowed only `public` or `valorant`, while
  retaining the legitimate database-global `DEFAULT ACL -` form.
- `ops/tests/media-backup-contract.test.sh` — added independent refusal
  archives for FK CONSTRAINT, ROW SECURITY, POLICY, ACL, COMMENT, and DEFAULT
  ACL entries with an unexpected schema; added valid column-default,
  database-global default ACL, and schema-qualified default ACL entries to the
  accepted materialized-view archive; retained activation and destructive-order
  assertions for every refusal.

### Commands and exact outputs

```text
& "C:\Program Files\Git\bin\bash.exe" -n ops/backup-production.sh ops/backup-production-multi-remote.sh ops/restore-production-backup.sh ops/rehearsal/postgres17-restore-rehearsal.sh ops/tests/media-backup-contract.test.sh ops/tests/restore-production-backup.test.sh ops/tests/backup-multi-remote.test.sh ops/tests/postgres17-rehearsal.test.sh
```

Output: none; passed.

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/media-backup-contract.test.sh
```

Output:

```text
media backup contract fixture tests passed
```

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/restore-production-backup.test.sh
```

Output:

```text
File activation and a transactional database restore begin in 0 seconds. Press Ctrl+C to abort.
restore schema ownership regression test passed
```

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/backup-multi-remote.test.sh
```

Output:

```text
Encrypted production backup uploaded successfully: quest-production-20260829T135707Z.tar.gz.enc
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
Encrypted production backup uploaded successfully: quest-production-20260829T135746Z.tar.gz.enc
backup multi-remote fixture tests passed
```

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
ok: summary without raw observations
ok: incomplete manifest evidence
ok: wrong health evidence
ok: wrong CA evidence
ok: blocked writer/freeze evidence
PostgreSQL 17 rehearsal fixture tests passed (no Docker, database, VPS, or remote contacted).
STATUS:0
```

```text
git diff --check
```

Output: no diff errors; Git emitted the working-copy LF-to-CRLF warning for
`.superpowers/sdd/2026-08-29-vps-database-migration/task-4-report.md`
(`STATUS:0`).

### Self-review

- `DEFAULT ACL` now follows actual PostgreSQL TOC positioning: `ACL` is the
  descriptor continuation, the namespace is the next field, and the default
  privileges tag is validated separately. Schema namespaces and any optional
  `IN SCHEMA` content are constrained to the same allowed schema; only `-`
  remains global.
- Single-word column `DEFAULT` entries are accepted as schema/table/column
  descriptors and still pass the exact schema check. Valid materialized-view
  data and both required schemas remain accepted.
- Each named descriptor refusal runs in a fresh archive and independently
  proves no activation, destructive restore, or security SQL, so early parser
  failure cannot hide later descriptor coverage.
- Prior PostgreSQL 17 pinning, strict target/TLS/session identity, endpoint
  separation, two-schema scope, encryption/rclone/checksum/upload,
  confirmation, cleanup, explicit fixture seam, and secret-free behavior are
  unchanged. No VPS, production database, remote, credential, or private key
  was contacted or changed.

### Concerns

- A live production backup or restore was not exercised; deployment-host
  verification of PostgreSQL 17 clients, TLS material, sentinel, and Compose
  endpoint remains required.
- The normal recovery example still requires protected TLS material, age
  identity, sentinel authorization, and confirmation out of band.

## Fix round 5

### Changed files

- `ops/restore-production-backup.sh` — corrected `DEFAULT ACL` parsing to the
  PostgreSQL 17 TOC grammar (`schema`, `GLOBAL` or `IN SCHEMA <schema>` tag,
  and owner), accepting only exact global or allowed-schema forms and rejecting
  malformed or ambiguous entries before activation.
- `ops/tests/media-backup-contract.test.sh` — replaced fabricated TOC forms
  with PostgreSQL 17-style owner/tag fields for FK CONSTRAINT, ROW SECURITY,
  POLICY, ACL, COMMENT, DEFAULT ACL, column DEFAULT, and MATERIALIZED VIEW
  DATA coverage; retained independent refusal archives and valid global and
  schema-specific default ACL coverage.
- `ops/tests/restore-production-backup.test.sh` — made the baseline custom
  archive TOC entries use PostgreSQL 17 owner fields.
- `ops/tests/postgres17-rehearsal.test.sh` — made the baseline custom archive
  TOC entries use PostgreSQL 17 owner fields.
- `.superpowers/sdd/2026-08-29-vps-database-migration/task-4-report.md` —
  appended this fix-round record.

### Commands and exact outputs

```text
& "C:\Program Files\Git\bin\bash.exe" -n ops/backup-production.sh ops/backup-production-multi-remote.sh ops/restore-production-backup.sh ops/rehearsal/postgres17-restore-rehearsal.sh ops/tests/media-backup-contract.test.sh ops/tests/restore-production-backup.test.sh ops/tests/backup-multi-remote.test.sh ops/tests/postgres17-rehearsal.test.sh
```

Output: none; passed.

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/media-backup-contract.test.sh
```

Output:

```text
media backup contract fixture tests passed
```

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/restore-production-backup.test.sh
```

Output:

```text
File activation and a transactional database restore begin in 0 seconds. Press Ctrl+C to abort.
restore schema ownership regression test passed
```

```text
& "C:\Program Files\Git\bin\bash.exe" ops/tests/backup-multi-remote.test.sh
```

Output:

```text
Encrypted production backup uploaded successfully: quest-production-20260829T145149Z.tar.gz.enc
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
Encrypted production backup uploaded successfully: quest-production-20260829T145236Z.tar.gz.enc
backup multi-remote fixture tests passed
```

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
ok: summary without raw observations
ok: incomplete manifest evidence
ok: wrong health evidence
ok: wrong CA evidence
ok: blocked writer/freeze evidence
PostgreSQL 17 rehearsal fixture tests passed (no Docker, database, VPS, or remote contacted).
```

```text
git diff --check
```

Output: no diff errors; Git emitted the working-copy LF-to-CRLF warning for
`.superpowers/sdd/2026-08-29-vps-database-migration/task-4-report.md`
(`STATUS:0`).

### Self-review

- `DEFAULT ACL` now requires the exact PostgreSQL 17 TOC field sequence. The
  global `- GLOBAL owner` form has no schema scope; `schema IN SCHEMA schema
  owner` is checked against exactly `public` and `valorant`. SQL privilege
  subtypes are not incorrectly parsed as TOC fields.
- The accepted descriptor fixture independently covers FK CONSTRAINT, ROW
  SECURITY, POLICY, ACL, COMMENT, DEFAULT ACL, column DEFAULT, and
  MATERIALIZED VIEW DATA using realistic owner/tag positions. Unexpected
  schema descriptors remain separate refusal archives, so an early failure
  cannot mask descriptor coverage.
- PostgreSQL 17 client pinning, strict target/TLS/session/endpoint binding,
  exact two-schema scope, explicit fixture seam, encryption, rclone/checksum/
  upload verification, confirmation, cleanup, and secret-free output remain
  unchanged. No VPS, production database, remote, credential, or private key
  was contacted.

### Concerns

- A live production backup or restore was not exercised; deployment-host
  verification of PostgreSQL 17 clients, TLS material, sentinel, and Compose
  endpoint remains required.
- The normal recovery example still requires protected TLS material, age
  identity, sentinel authorization, and confirmation out of band.
