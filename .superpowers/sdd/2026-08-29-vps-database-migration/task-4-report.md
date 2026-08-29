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
