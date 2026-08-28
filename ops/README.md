# Production Operations Scripts

These scripts support encrypted backup and recovery for Quest Esports production. The complete safety procedure is in [Backup and Disaster Recovery](../docs/backup-and-disaster-recovery.md).

| File | Purpose |
| --- | --- |
| `backup-production.sh` | Acquires the shared release lock, then runs the locked multi-remote snapshot wrapper |
| `backup-production-multi-remote.sh` | Snapshots both upload roots around a PostgreSQL dump, encrypts one archive, uploads/checks the pair independently on every required remote, records labeled outcomes, and prunes old local encrypted files |
| `restore-production-backup.sh` | Preflights/stages both file trees, activates them under an exit rollback guard, restores PostgreSQL in one transaction, and retains replaced trees after success; destructive and confirmation-gated |
| `rehearsal/postgres17-restore-rehearsal.sh` | Fail-closed disposable-only PostgreSQL 17 restore rehearsal wrapper; privately runs the existing restore primitive and writes machine-readable evidence |
| `rehearsal/verify-rehearsal-evidence.sh` | Rejects stale, incomplete, production-looking, or non-runtime rehearsal evidence |
| `prune-production-backups.sh` | Shared-lock, per-remote, dry-run-by-default off-site retention with explicit confirmation and a minimum-recovery-point guard |
| `notify-backup-failure.sh` | Sends a minimal Discord-compatible webhook alert without including secrets or backup URLs |
| `check-backup-freshness.sh` | Shared-lock freshness check that requires a locally checksum-valid and remotely matching pair on every required remote |
| `create-secret-recovery-package.sh` | Creates a confirmation-gated, `age`-encrypted package of allowlisted application/infrastructure secrets for transfer to a separate recovery vault |
| `backup-paris-database-windows.ps1` | Creates an encrypted Paris database-only snapshot of both Quest-owned schemas (`public` and `valorant`) on the secured Windows recovery PC |
| `test-paris-database-backup-windows.ps1` | Restores the database-only snapshot into disposable PostgreSQL 17 and asserts both schemas restored |
| `quest-esports-backup.env.example` | Production backup environment template |
| `quest-esports-recovery.env.example` | Isolated recovery environment template |
| `systemd/quest-esports-backup.service` | Restricted oneshot service running as `deploy` |
| `systemd/quest-esports-backup.timer` | Persistent daily schedule at 02:15 UTC plus randomized delay |
| `systemd/quest-esports-backup-failure@.service` | Restricted `OnFailure` notification service; requires an approved webhook in the protected environment file |
| `systemd/quest-esports-backup-freshness.service` | Restricted freshness probe that alerts through the same failure notifier |
| `systemd/quest-esports-backup-freshness.timer` | Persistent daily freshness check at 05:00 UTC plus randomized delay |
| `systemd/quest-esports-release-lock.tmpfiles` | Creates the shared root-owned release lock at boot |

Never commit a filled environment file, archive, checksum, database dump, rclone configuration, OAuth credential, or private `age` identity. Never use the production database or live upload paths for a restore drill.

## Host bootstrap and owner gate

Root VPS bootstrap is an operator-gated prerequisite and is intentionally not
implemented or executed by the rehearsal scripts. Before mutation, retain the
categorized Supabase egress totals and corrected 72-hour observation, explain
every category, record the post-fix daily rate/quota and no-402 evidence (with
402 behavior tested only in a disposable mock), and name the root-capable
bootstrap actor, exact release actor, approved backup destination, and
business-approved RPO/RTO. Any unexplained category, over-quota rate, or missing
owner decision stops the procedure.

The root-capable operator documents creation of `/srv/quest-esports/postgres/17/data`
(`postgres:postgres`, `700`), `/srv/quest-esports/uploads`
(`deploy:deploy`, `750`), `/srv/quest-esports/private` and
`/srv/quest-esports/backups` (`deploy:deploy`, `700`),
`/opt/quest-esports/releases` (`root:deploy`, `750`), `/etc/quest-esports`
(`root:root`, `750`), and `/var/lock/quest-esports-release.lock`
(`root:deploy`, `660`). Docker/Compose, Nginx, systemd/tmpfiles, and the
narrow release sudo rule are installed without stopping PM2 or legacy
VALORANT services. These are operator records, not checked-in proof of a live
host.

## Isolated PostgreSQL 17 restore rehearsal

The rehearsal wrapper is the only documented full-drill entry point. It never
defaults a target, requires `REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL`,
an existing private evidence directory, an absolute archive/checksum pair, an
offline identity, a mode-600 target sentinel, and roots below a previously absent
dedicated upload parent that the wrapper creates before creating the two roots. Cleanup
removes only empty disposable roots and their parent; nonempty restored trees remain
available for inspection or manual rollback. The `DIRECT_URL`
loopback host/port must match the inspected container's PostgreSQL port mapping;
`QUEST_RUNTIME_DATABASE_URL` must use `quest_runtime` against the same endpoint;
a PostgreSQL 17 client bin
directory (or three individually pinned client paths). `BACKUP_ENV_FILE` is
parsed as data and copied into a temporary private environment; it is never
sourced by the wrapper. Production-looking URLs/paths, symlinks, nested roots,
unsafe permissions, missing manifest scope, and source-major mismatches without
an explicit logical-migration approval are refused. The target image contract is
exactly `postgres:17-bookworm@sha256:<64 lowercase hex characters>`. The raw
`server_version` inventory records PostgreSQL's normal `17.<minor>` value with
an optional package suffix; it does not use a fabricated `PostgreSQL_17` label.

Provide these additional disposable-only variables: `REHEARSAL_EVIDENCE_DIR`,
`QUEST_RUNTIME_DATABASE_URL` (the `quest_runtime` credential for the same
disposable database endpoint),
`REHEARSAL_TARGET_SENTINEL_FILE` (a private record containing the disposable
target kind/id, exact container ID, and both upload roots),
`SOURCE_VERSION_EVIDENCE_FILE` (a private operator-recorded record containing
`source_major`, `source_version`, and `provenance=operator_recorded`),
`SECURITY_VERIFY_COMMAND` (an executable wrapper around the repository security
verifier), `NO_WRITER_ADMISSION_COMMAND` (an executable disposable-target
probe), `QUEST_LIVENESS_URL`, `QUEST_READINESS_URL`,
`VALORANT_HEALTH_URL`, `VALORANT_CA_FILE`, `FREEZE_STATUS_URL`,
`FREEZE_MUTATION_URL`, `FREEZE_CALLBACK_URL`, six executable
`FAILURE_INJECTION_<NAME>_COMMAND` hooks (bad checksum, bad decryption, wrong
CA, blocked network, failed service health, and attempted mutation/callback),
`REHEARSAL_RPO_SECONDS`, `REHEARSAL_RPO_DECISION=met|not_met`,
`REHEARSAL_RTO_SECONDS`, and `REHEARSAL_RTO_DECISION=met|not_met`. These are
owner-approved objectives; measured duration/resource values are emitted by
the wrapper. `REHEARSAL_TIME_COMMAND` may replace `/usr/bin/time` only with an
absolute, non-symlink executable for an approved disposable harness. The URLs must point to disposable services and the CA must be
supplied explicitly. Health probes require JSON
`status=ok`; readiness also requires `db=up`, and frozen mutation/callback
probes must return `503` with `X-Write-Freeze: validation`.

Each hook is an operator-provided disposable-target wrapper, not a fabricated
status variable. `SECURITY_VERIFY_COMMAND` must return exact stdout
`security-verified`; failure hooks return structured result, failure class,
service identity, endpoint ID/hash, pre/post state, and containment fields, all
with a successful exit. It probes the target ledger state before restore,
then queries the exact Quest `public._prisma_migrations` and VALORANT
`_migration_ledger` tables after restore. It also verifies the four bootstrap
roles, memberships, owners, grants, default ACLs, and RLS posture.

```bash
chmod 600 /secure/recovery/quest-esports-recovery.env
chmod 600 /secure/recovery/quest-rehearsal-target.env
chmod 700 /secure/recovery/rehearsal-evidence
REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL \
  BACKUP_ENV_FILE=/secure/recovery/quest-esports-recovery.env \
  REHEARSAL_EVIDENCE_DIR=/secure/recovery/rehearsal-evidence \
  REHEARSAL_TARGET_SENTINEL_FILE=/secure/recovery/quest-rehearsal-target.env \
  POSTGRES17_BIN=/usr/lib/postgresql/17/bin \
  bash ops/rehearsal/postgres17-restore-rehearsal.sh \
  /secure/archives/quest-production-YYYYMMDDTHHMMSSZ.tar.gz.enc
REHEARSAL_TRUSTED_SIGNING_PUBLIC_KEY=/secure/recovery/rehearsal-trusted-signing-public.pem \
  bash ops/rehearsal/verify-rehearsal-evidence.sh \
  /secure/archives/quest-production-YYYYMMDDTHHMMSSZ.tar.gz.enc \
  /secure/recovery/rehearsal-evidence
```

The host must bootstrap `openssl` plus a protected signing key pair. The
wrapper requires `REHEARSAL_SIGNING_PRIVATE_KEY`; verification requires the
operator-configured trusted `REHEARSAL_TRUSTED_SIGNING_PUBLIC_KEY`. If either
key/tool is unavailable the flow fails closed. The evidence directory contains
mode-`600` summary, raw observation, target-sentinel, migration-ledger,
failure-injection, and other inventory artifacts. The summary includes a
SHA-256 binding to the fixed-name
`rehearsal-observations.env`; the verifier hashes and parses that artifact and
the raw role/inventory outputs before accepting the summary. Upload checksums
are explicitly post-restore tree checksums, not source-equivalence claims
unless a source per-file inventory was also supplied. Every failure hook is
staged into the evidence directory before execution; its configured source hash,
staged hash, signed manifest entry, and pre-execution identity must agree.
Evidence never contains
database URLs, credentials, tokens, or secret environment contents; these are
not written to the summary/observations. The signed failure-injection inventory
contains only approved hook paths, executable hashes, configured endpoint IDs,
and endpoint hashes. The
fixture test is deliberately limited to fake commands and generated
disposable evidence. It does not contact Docker, PostgreSQL, age, a VPS, a
hosted service, a live upload root, or an rclone remote.

## Operational examples

The [Backup and Disaster Recovery](../docs/backup-and-disaster-recovery.md) runbook is the authoritative recovery procedure. These examples use placeholders for paths and never include credentials or secret values. Any newer backup or restore safety change still requires a fresh isolated drill unless a checked-in record proves that drill; these examples do not claim that a production restore drill was performed.

### Create a full encrypted backup

The protected environment consumes `BACKUP_RCLONE_REMOTES` as newline-separated
`label=remote:path` entries and `BACKUP_RCLONE_CONFIGS` as matching
`label=/path/to/private-rclone-config` entries. Each remote must have its own
rclone config and credentials. The older `BACKUP_RCLONE_REMOTE` plus
`RCLONE_CONFIG` pair remains supported while migrating a single destination.
The wrapper acquires `/var/lock/quest-esports-release.lock` before the nested
`/srv/quest-esports/backups/.quest-backup.lock`, and holds both through the
archive, every upload/check, and the per-run `.results` record. The result file
contains only the archive name, remote labels, and success/failure outcomes.

**Classification: production-source read operation with a local cleanup side effect.** The script reads the configured production database and upload roots, creates and uploads an encrypted archive, and deletes local encrypted backup/checksum files older than `BACKUP_LOCAL_RETENTION_DAYS`; it does not delete production source data. `BACKUP_ENV_FILE` defaults to `/etc/quest-esports-backup.env` and is shown explicitly here.

```bash
cd /var/www/QuestEsports
sudo -u deploy -H env \
  BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
  bash ops/backup-production.sh
```

The command has no dry-run mode and has no confirmation token. Treat it as successful only after the archive and matching `.sha256` file pass the script's remote `rclone check`; review the configured local retention because expired local backup pairs are removed as part of the run.

### Check backup freshness

**Classification: read-only.** `BACKUP_ENV_FILE` defaults to `/etc/quest-esports-backup.env`. The script uses `BACKUP_MAX_AGE_MINUTES`, defaulting to `2160` when it is unset, and checks both the local checksum and matching remote objects.

```bash
sudo -u deploy -H env \
  BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
  bash ops/check-backup-freshness.sh
```

This is read-only apart from acquiring the shared release lock and has no dry-run switch or confirmation token. A recent pair must pass independently on every required remote.

### Review and prune expired remote backups

First run the **dry-run** without `RETENTION_CONFIRMATION`; it requires `BACKUP_ENV_FILE` (default `/etc/quest-esports-backup.env`), `BACKUP_REMOTE_RETENTION_DAYS`, and `BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS`. The shared release lock is held while each remote is listed and evaluated.

```bash
sudo -u deploy -H env \
  BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
  bash ops/prune-production-backups.sh
```

The dry-run lists recovery pairs that would be deleted and refuses a policy that would leave fewer than the configured minimum recovery points. After review and approval, the **destructive** deletion requires the exact confirmation token `PRUNE_QUEST_PRODUCTION`:

```bash
sudo -u deploy -H env \
  BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
  RETENTION_CONFIRMATION=PRUNE_QUEST_PRODUCTION \
  bash ops/prune-production-backups.sh
```

### Restore to a disposable target

**Classification: disposable-target-only; destructive to the configured target.** Never use production database or upload paths. `BACKUP_ENV_FILE` defaults to `/etc/quest-esports-backup.env`; the archive argument must be an absolute path and its matching `.sha256` file must be present. The script has no dry-run mode and requires `RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION`.

```bash
chmod 600 /secure/recovery/quest-esports-recovery.env
RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
  BACKUP_ENV_FILE=/secure/recovery/quest-esports-recovery.env \
  bash ops/restore-production-backup.sh \
  /absolute/path/to/quest-production-YYYYMMDDTHHMMSSZ.tar.gz.enc
```

Use an approved disposable PostgreSQL target and new empty absolute upload directories in the recovery environment file. The confirmation acknowledges the destructive operation; it does not make a production target safe.

### Send a failure notification

**Classification: external notification side effect; read-only with respect to local production data.** The script reads `BACKUP_ENV_FILE` and host/unit metadata, then POSTs a minimal alert to the approved HTTPS `BACKUP_FAILURE_WEBHOOK_URL`. The optional first argument is the failed unit name and defaults to `quest-esports-backup.service`.

```bash
sudo -u deploy -H env \
  BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
  bash ops/notify-backup-failure.sh operator-test
```

This sends one external webhook notification and has no dry-run mode or confirmation token. Do not print or paste the webhook URL.

### Create a secret recovery package

**Classification: sensitive source-read/export operation.** This creates a sensitive encrypted copy; it does not delete the allowlisted source files. Run as root only in an approved staging directory separate from the normal backup destination. The script does not use `BACKUP_ENV_FILE`; it requires `RECOVERY_PACKAGE_CONFIRMATION=PACKAGE_QUEST_SECRETS`, a valid `RECOVERY_AGE_RECIPIENT`, and exactly one absolute output-directory argument.

Prerequisite: outside the repository, create `/secure/recovery/quest-esports-secret-package.env` with mode `600`, readable by root, and a real offline `RECOVERY_AGE_RECIPIENT` that matches the script's `age1[0-9a-z]{58}` validation. Do not put a placeholder or private key in this documentation.

```bash
sudo bash -c 'set -a; . /secure/recovery/quest-esports-secret-package.env; set +a; export RECOVERY_PACKAGE_CONFIRMATION=PACKAGE_QUEST_SECRETS; exec bash /var/www/QuestEsports/ops/create-secret-recovery-package.sh /absolute/path/to/secure-recovery-staging'
```

The command has no dry-run mode. Transfer the encrypted package and checksum to the separate approved recovery vault, test decryption offline, and remove the staging copy according to the recovery runbook.

### Windows Paris database backup

**Classification: production-source backup operation with local recovery-file and ACL side effects.** The backup script intentionally reads the Paris production database named by `DIRECT_URL` from its `-EnvironmentFile` (default `..\backend\.env` relative to the script), validates the Paris host, writes an encrypted database-only archive and checksum under `-BackupRoot`, restricts their ACLs, and removes temporary staging files. It does not restore or delete the production database, but it uses production database credentials and is not disposable-target-only. It defaults `-BackupRoot`, `-RecoveryRoot`, and `-PostgresBin` to local Windows paths. It has no dry-run mode or confirmation token.

It dumps **both Quest-owned schemas**, `public` and `valorant`. Dumping only `public` would silently omit the sibling FastAPI service's match, series, and rating history, which exists nowhere else; the drill script asserts both schemas restored so a regression cannot pass unnoticed. Supabase-managed schemas (`auth`, `storage`, `realtime`, `vault`) remain excluded and are Supabase's own responsibility. The checksum is written with LF endings so `sha256sum -c` validates it directly — a trailing CR makes the archive read as missing, which during a recovery looks exactly like corruption.

Use the secured recovery PC and explicit isolated paths:

```powershell
Set-Location D:\absolute\path\to\QuestEsports
.\ops\backup-paris-database-windows.ps1 `
  -EnvironmentFile D:\absolute\path\to\backend\.env `
  -BackupRoot D:\absolute\path\to\paris-database-backups `
  -RecoveryRoot D:\absolute\path\to\recovery-keys `
  -PostgresBin 'C:\Program Files\PostgreSQL\17\bin'
```

### Verify a Windows Paris database backup

**Classification: disposable-target-only.** The verification script has no environment-file variable, no dry-run mode, and no confirmation token. It accepts one optional `-BackupPath`; when omitted it selects the newest matching archive under `-BackupRoot`. It verifies the checksum and restores only into a disposable PostgreSQL 17 Docker container, which it removes afterward:

```powershell
.\ops\test-paris-database-backup-windows.ps1 `
  -BackupPath D:\absolute\path\to\paris-database-backups\quest-paris-database-YYYYMMDDTHHMMSSZ.tar.gz.age `
  -BackupRoot D:\absolute\path\to\paris-database-backups `
  -RecoveryRoot D:\absolute\path\to\recovery-keys `
  -PostgresBin 'C:\Program Files\PostgreSQL\17\bin'
```

The Windows verification workflow is disposable-target-only and is not a substitute for the full off-site backup or an isolated full restore drill.

### Install and inspect systemd backup services

**Classification: system change with scheduled-job side effects.** Installation writes root-owned unit files and the canonical lock, `daemon-reload` changes systemd's loaded configuration, and enabling/starting the persistent timers changes future execution. The inspection commands below are **read-only**. Do not use `enable --now`: because both timers are persistent, starting them may immediately trigger a missed backup or freshness job. Install all five units and the tmpfiles contract as root, reload systemd, enable the timers without starting them, inspect the schedule, and start them only after explicit approval:

```bash
sudo install -o root -g root -m 644 \
  ops/systemd/quest-esports-backup.service \
  ops/systemd/quest-esports-backup.timer \
  ops/systemd/quest-esports-backup-failure@.service \
  ops/systemd/quest-esports-backup-freshness.service \
  ops/systemd/quest-esports-backup-freshness.timer \
  /etc/systemd/system/
sudo install -o root -g root -m 644 \
  ops/systemd/quest-esports-release-lock.tmpfiles \
  /etc/tmpfiles.d/quest-esports-release.conf
sudo systemd-tmpfiles --create /etc/tmpfiles.d/quest-esports-release.conf
sudo systemctl daemon-reload
sudo systemctl enable quest-esports-backup.timer quest-esports-backup-freshness.timer
```

The backup service runs at 02:15 UTC and the freshness service at 05:00 UTC, each with up to a 15-minute randomized delay. Release, migration, backup, and name-audit jobs must acquire `/var/lock/quest-esports-release.lock` before changing shared production state. Inspect installation and recent outcomes without starting a backup or deletion operation:

```bash
systemctl list-timers quest-esports-backup.timer quest-esports-backup-freshness.timer --no-pager
systemctl status quest-esports-backup.service quest-esports-backup-freshness.service --no-pager
systemctl show quest-esports-backup.service \
  --property=Result,ExecMainStatus,ActiveState --no-pager
journalctl -u quest-esports-backup.service --since today --no-pager
```

After reviewing the timers and accepting the possibility of an immediate persistent-timer run, start them explicitly:

```bash
sudo systemctl start quest-esports-backup.timer quest-esports-backup-freshness.timer
```

The failure unit passes the failed unit name to `notify-backup-failure.sh`; test that notifier separately with the notification example before relying on `OnFailure`.
