# Backup and Disaster Recovery

Repository record date: September 8, 2026. The PostgreSQL 17 VPS cutover is
closed as completed on 2026-08-31; this record still does not replace live
verification of backup, destination, timer, or service state.

This is the source of truth for Quest Esports production backup, restore testing, and disaster recovery. The [Production Operations Runbook](./production-runbook.md) covers the surrounding VPS and deployment procedures.

## Safety rules

1. Never test a restore against live production: PostgreSQL 17 in Compose
   container `quest-prod-postgres-1` (private endpoint `quest-postgres:5432`),
   or the live upload directories.
2. Never print or commit `/etc/quest-esports-backup.env` or any protected per-remote rclone configuration.
3. Never place the private `age` identity in Git, Google Drive, email, chat, support tickets, or a normal cloud-synced folder.
4. Always require both an encrypted archive and its matching `.sha256` file.
5. Always verify the checksum before decrypting.
6. Treat `ops/restore-production-backup.sh` as destructive: it runs `pg_restore --clean --if-exists` and synchronizes both upload roots with `rsync --delete`.
7. Stop application writes and preserve the current failed state before an intentional production restore whenever possible.

Visitor maintenance mode alone is not a write freeze: background jobs and the PayHere notification callback intentionally continue. A restore or destructive recovery requires stopping the PM2 backend process as described below.

## Repository-recorded production recovery status

| Component | Current state |
| --- | --- |
| Cutover status | Completed on 2026-08-31; PostgreSQL 17 on the VPS is the current production target |
| Migration source/rollback material | Supabase remains intact but stale recovery material; it is not a rollback target after the first VPS writer |
| Production target | PostgreSQL 17 in Compose container `quest-prod-postgres-1`, reached privately as `quest-postgres:5432` on `quest-shared`, with no published host port and durable data at `/srv/quest-esports/postgres/17/data` |
| Staging overlay | `ops/docker/compose.postgres-staging.yml` publishes `127.0.0.1:55432` only when explicitly applied for host-run maintenance; it is not part of production Compose |
| Backend | France VPS, `/var/www/QuestEsports`, Compose service `quest-prod-backend-1` |
| Public uploads | `/srv/quest-esports/uploads` |
| Public event-album previews | `/srv/quest-esports/uploads/poster-images` (WebP previews) |
| Private uploads | `/srv/quest-esports/private` |
| Private event-album originals | `/srv/quest-esports/private/event-album-originals` (mode `700` tree) |
| Backup staging | `/srv/quest-esports/backups`, seven-day local retention |
| Active off-site destinations | Protected environment labels and destinations; owner verification required |
| Historical destination | Retained only according to the protected multi-remote configuration; owner verification required |
| Encryption | `age` public-recipient encryption; private identity kept offline |
| Automation | The canonical producer uses an ephemeral PostgreSQL 17 client on `quest-shared`, preserving verify-full mTLS without publishing PostgreSQL. Before this correction it incorrectly required the staging-only `127.0.0.1:55432` endpoint. |
| Interim backup coverage | Retire `quest-pg17-interim-backup.timer`, `quest-media-interim-backup.timer`, and `quest-pg17-interim-freshness.timer` only after this change is deployed and a canonical `quest-production-*.tar.gz.enc` recovery point succeeds |
| Schedule | Daily at 02:15 UTC with up to 15 minutes randomized delay; missed runs are persistent |
| Restore-drill status | Skipped; the hard rehearsal gate was not performed and cannot be satisfied retroactively |
| Remaining trust risks | The backup client CA, certificate, and key were provisioned on 2026-09-01; the stale published-port assumption was the remaining canonical-backup blocker. Offline decryption and rehearsal-signing key custody remain owner-controlled recovery prerequisites. |

The backup client CA, certificate, and key are provisioned as of 2026-09-01.
The checked-in systemd units pin them to the deploy-readable paths
`/etc/quest-esports-backup/backup-client-ca.crt`, `backup-client.crt`, and
`backup-client.key`, and refuse to invoke the wrapper unless
`/var/www/QuestEsports` is available as the working directory. The canonical
backup blocker was the producer's stale dependency on the staging-only
`127.0.0.1:55432` publication, not missing TLS material. A missing certificate,
target setting, Docker/network prerequisite, or working tree is still a failed
prerequisite and must not be hidden by an interim job.

The checked-in record describes the configured remotes as using separate,
QuestEsports-owned credentials. Remote labels, destinations, and token state
remain owner-verification items and must never be printed in alerts or logs.

The production archive restore deliberately uses PostgreSQL 17
`pg_restore --no-owner --no-acl --single-transaction --exit-on-error`. ACL
replay from the archive remains a parked compatibility issue; the canonical
bootstrap SQL and security verifier apply and prove the approved roles, grants,
and default ACLs separately. Do not change this `--no-acl` decision implicitly.

## Recovery objectives and limitations

- The timer provides a technical recovery-point interval of approximately 24 hours plus up to 15 minutes when the timer, VPS, database, and Drive destination are healthy. A migration-changing CD run creates an additional backup immediately before migration.
- The owner must record an approved RPO and RTO before host mutation and before
  accepting rehearsal evidence. The rehearsal records the approved values via
  `REHEARSAL_RPO_SECONDS`/`REHEARSAL_RPO_DECISION` and
  `REHEARSAL_RTO_SECONDS`/`REHEARSAL_RTO_DECISION`; restore duration and
  resource usage remain measured observations, not operator estimates.
- Local encrypted copies older than `BACKUP_LOCAL_RETENTION_DAYS` are removed by the script; the current value is seven days.
- The repository includes a dry-run-first, per-remote retention tool with a minimum-recovery-point guard. Production deletion remains disabled until the owner approves the retention values and runs the exact confirmation-gated command for object-locked destinations.
- The repository includes a systemd `OnFailure` notifier. It pages an operator only after the failure unit is installed and an approved Discord-compatible HTTPS webhook is added to the protected backup environment and tested.

### Historical pre-first-write rollback boundary (superseded 2026-08-31)

Before the first PostgreSQL 17 writer was admitted, a failed cutover would have
kept writers frozen, restored the source URLs, and restarted only the previously
active legacy writers. Supabase was the temporary rollback source at that
historical boundary, not a second writable production database. That boundary
has passed and is not an available recovery path.

Once PostgreSQL 17 writer admission starts, Supabase is stale recovery material.
There is no automatic or one-service Supabase URL rollback. A post-first-write
incident requires both writer groups to stop, coordinated freeze to be
re-enabled, current PostgreSQL 17 and both upload roots to be captured, the
expected loss/RPO to be recorded, and incident-owner approval for either
fix-forward or a controlled restore. Never restart an old writer against the
new state or redirect only one service to Supabase. The release records this
boundary as `supabase_authority_boundary=stale-after-first-vps-write` and
`supabase_url_rollback=prohibited` in private recovery evidence.

## What a full production archive contains

Each `quest-production-YYYYMMDDTHHMMSSZ.tar.gz.enc` contains:

- `database.dump`: PostgreSQL custom-format dump of the application-owned `public` schema and, when the `valorant` schema exists, the application-owned `valorant` schema too. The manifest records the selected database scope.
- `manifest.txt`: creation time, exact release SHA, source host, dump format, public/private upload roots, explicit event-album preview/original roots, and the two-pass file snapshot strategy.
- `public-upload-inventory.tsv` and `private-upload-inventory.tsv`: deterministic, secret-free file/directory inventories containing each relative name, byte count, and file SHA-256. Restore compares both decrypted inventories with the staged target trees before activation.
- The entire public upload directory.
- The entire private upload directory, including protected payment evidence.

The event-album upload contract stores a WebP preview in
`/srv/quest-esports/uploads/poster-images` and the untouched upload in
`/srv/quest-esports/private/event-album-originals`. The `ImageAsset` row keeps
the preview `storedFilename` and the client-provided `originalName`, which are
used together to locate an original safely. A valid manifest names both
event-album roots, and the archive contains both corresponding directories;
a previews-only archive is rejected before restore staging.

Each archive has a sibling `quest-production-....tar.gz.enc.sha256` checksum file.
The checksum file must contain exactly one row naming that archive; unrelated or
additional rows are rejected by freshness, restore, rehearsal, and release
verification.

## Release-bound backup evidence

Release and cutover consume the repository implementation
`ops/deploy/verify-backup-evidence.sh`, not an executable which merely prints a
token. A root-created, secret-free contract at
`/var/lib/quest-esports/backup-evidence/release.env` (`root:deploy`, mode `0640`)
contains exactly one release SHA, archive name and hashes, the exact remote-label
set, the rehearsal evidence directory, and the five status fields. The consumer
recomputes the archive checksum and decrypted manifest release binding, verifies
both upload inventories, requires terminal backup result `status=success` and
`exit_status=0`, checks freshness, verifies every configured remote pair, and
invokes the signed rehearsal verifier for the same archive. Only then does it
emit the release-bound `verified-complete` line. The former
`BACKUP_EVIDENCE_COMMAND` is retained only for fixture compatibility and is not
the production release authority.

The archive intentionally excludes:

- Supabase-managed schemas, extensions, Auth configuration, API settings, project keys, and platform settings.
- The production backend `.env` and every third-party credential.
- The rclone configuration and Google OAuth credentials/token.
- The private `age` identity.
- Nginx, PM2, systemd, firewall, DNS, Vercel, and GitHub configuration outside this repository.

Consequently, the production `.env` and infrastructure credentials require a separate encrypted, access-controlled secret-recovery process. An archive alone cannot rebuild the complete service if those values are lost.

## Key and credential custody

| Item | Required location | Rules |
| --- | --- | --- |
| `age` public recipient | `/etc/quest-esports-backup.env` | Safe for encryption; not sufficient to decrypt |
| `age` private identity | Secured offline recovery package | Maintain at least two controlled offline copies; never keep it permanently on the VPS |
| Backup environment | `/etc/quest-esports-backup.env`, `root:deploy`, mode `640` | Exact protected service contract; contains the database URL; never print the file |
| Backup TLS client directory | `/etc/quest-esports-backup`, `root:deploy`, mode `750` | Dedicated deploy-traversable parent; no broader secret exposure; separate from server TLS |
| Backup TLS trust bundle | `/etc/quest-esports-backup/backup-client-ca.crt`, `root:deploy`, mode `640` | Deploy-readable copy/bundle containing the issuer of `quest-postgres.crt`; separate path from server TLS, never client identity material |
| Backup TLS client certificate/key | `/etc/quest-esports-backup/backup-client.{crt,key}`, `root:deploy`, mode `640` | Readable by the scheduled `deploy` service; never reuse the server key; no group/other write |
| rclone configurations | One mode-`600` protected config per configured remote | Contains OAuth material; inspect only through safe rclone commands |
| Google OAuth client | Google Cloud project `QuestEsports Backups` | Do not commit/download/store its JSON unnecessarily; rotate if exposed |
| Production application secrets | Approved encrypted secret store | Not included in the backup archive |

Losing every copy of the private `age` identity makes existing encrypted archives unrecoverable. If the rclone token is lost, the encrypted files remain in Google Drive and can be downloaded through an authorized account while the remote is re-authorized.

## Installation and configuration

## Owner gates and root-bootstrap boundary

The following record is a hard gate, not a statement that the checks have been
performed. The owner must complete it before any VPS package, filesystem,
identity, service, or database mutation. If a category is unexplained, the
corrected 72-hour rate exceeds the applicable plan quota, or an owner field is
blank, stop at this gate.

| Gate record | Required owner evidence | Status |
| --- | --- | --- |
| Supabase egress categories | Categorized totals, corrected 72-hour observation, post-fix daily rate, quota, and explanation for every category | `PENDING_OWNER_RECORD` |
| No-402 evidence | Production logs/health observation showing no 402s; 402 behavior tested only against a disposable mock | `PENDING_OWNER_RECORD` |
| Privileged actor | Named root-capable bootstrap operator and date/approval | `PENDING_OWNER_RECORD` |
| Release actor | Exact non-root release actor and narrow sudo command/rule | `PENDING_OWNER_RECORD` |
| Backup destination | Approved destination label, credential-separation confirmation, and archive/checksum pair policy | `PENDING_OWNER_RECORD` |
| Recovery objectives | Business-owner-approved RPO and RTO, with decision owner | `PENDING_OWNER_RECORD` |

Root bootstrap is operator-gated and is not performed by the rehearsal scripts.
The root-capable operator must create only these documented paths and
identities, then record the resulting ownership and modes:

| Path/identity | Required owner and mode |
| --- | --- |
| `/srv/quest-esports/postgres/17/data` | `postgres:postgres`, `700` |
| `/srv/quest-esports/uploads` | `deploy:deploy`, `750` |
| `/srv/quest-esports/private` | `deploy:deploy`, `700` |
| `/srv/quest-esports/backups` | `deploy:deploy`, `700` |
| `/opt/quest-esports/releases` | `root:deploy`, `750` |
| `/etc/quest-esports` | `root:root`, `750` |
| `/etc/quest-esports-backup` | `root:deploy`, `750` |
| `/var/lock/quest-esports-release.lock` | `root:deploy`, `660`, canonical lock |

The same operator installs Docker/Compose, Nginx, systemd/tmpfiles, and the
narrow release sudo rule. Bootstrap must not stop PM2 or any legacy VALORANT
service, must not restore a database, and must not change database authority.
The owner records Docker/Compose versions, host capacity and swap decision,
Nginx/systemd installation, lock creation, and the exact sudo rule separately.
No live bootstrap, service stop, production restore, or migration is implied by
this repository record.

The production templates are:

- `ops/quest-esports-backup.env.example`
- `ops/backup-production-multi-remote.sh`
- `ops/systemd/quest-esports-backup.service`
- `ops/systemd/quest-esports-backup.timer`
- `ops/systemd/quest-esports-backup-failure@.service`
- `ops/systemd/quest-esports-backup-freshness.service`
- `ops/systemd/quest-esports-backup-freshness.timer`
- `ops/systemd/quest-esports-release-lock.tmpfiles`

The backup client TLS material intentionally does not live below
`/etc/quest-esports`. That documented parent is `root:root 0750` for
server/container TLS and cannot be traversed by the `deploy:deploy` systemd
service. Bootstrap must create `/etc/quest-esports-backup` as `root:deploy 0750`,
then install `backup-client-ca.crt`, `backup-client.crt`, and
`backup-client.key` there as `root:deploy 0640`. `POSTGRES_CA_FILE` in the
scheduled backup environment points to the trust bundle in this hierarchy.
`backup-client-ca.crt` is a deploy-readable copy/bundle containing the issuer of
`/etc/quest-esports/tls/quest-postgres.crt`, including any intermediate
certificates required to build that chain. It may be copied from the server CA
material when that is the issuer; it is a separate-path trust copy, not the
PostgreSQL server certificate/key and not the `backup-client.crt` or
`backup-client.key` identity. If separate server/client PKIs are used, the
bundle must contain the PostgreSQL server issuer; alternatively, document both
chains and validate them. Host validation verifies this relationship
with `openssl verify -purpose sslserver`; the backup connection retains
`sslmode=verify-full`. The PostgreSQL server CA/certificate/key remain under
`/etc/quest-esports/tls` with the existing UID999-readable ownership contract.
Host validation and the backup script reject any other production hierarchy or
permissions.

Install Docker, `age`, `rclone`, and `rsync`, and keep the exact approved
PostgreSQL 17 image available locally. The backup does not use a host
`pg_dump`; both clients run from the pinned image on `quest-shared`.

The backup takes an exclusive `flock`, copies both immutable upload trees, runs the database dump, and copies the upload trees a second time before packaging. This closes the common gap where a database row commits while its file is omitted from the archive. PostgreSQL and the VPS filesystem still cannot participate in one distributed transaction, so the application must keep random upload filenames immutable and quarterly restore verification remains required.

### Backup endpoint lifecycle

The checked-in backup service uses the exact PostgreSQL 17 Compose target in
`ops/quest-esports-backup.env.example`: `quest-postgres:5432` on
`quest-shared`, database `quest`, and role `quest_backup`. It launches the
approved `postgres:17-bookworm` digest as a short-lived read-only client and
first verifies the exact `quest-prod-postgres-1` Compose identity, durable data
mount, network alias, and absence of a published host port. It uses the
provisioned backup client trust bundle, certificate, and key from
`/etc/quest-esports-backup`, with the
bundle containing the PostgreSQL server issuer and the certificate/key remaining
a separate client identity. It must never use the former Paris Supabase
session pooler.
The staging overlay is no longer required for backups. Host-run restores still
use `ops/docker/compose.postgres-staging.yml`, bound only to
`127.0.0.1:55432`, because the destructive restore primitive has not moved into
the private network. There is no supported transition back to Supabase: after
the first VPS writer, every backup and restore must target PostgreSQL 17 or the
change is a release blocker.

If host backup or restore access is intentionally suspended, use these exact
controls before stopping PostgreSQL or changing the Compose invocation:

```bash
sudo systemctl disable --now quest-esports-backup.timer quest-esports-backup-freshness.timer
sudo systemctl stop quest-esports-backup.service quest-esports-backup-freshness.service
```

Before a subsequent backup, start PostgreSQL from the production Compose file,
verify the private target and `quest-shared` attachment, and re-enable the
timers. Do not apply the staging overlay for backup or freshness operations:

```bash
COMPOSE_ENV=/etc/quest-esports/quest.production.env
docker compose --env-file "$COMPOSE_ENV" \
  -f ops/docker/compose.production.yml up -d postgres
docker compose --env-file "$COMPOSE_ENV" \
  -f ops/docker/compose.production.yml ps postgres
docker network inspect quest-shared
sudo systemctl enable --now quest-esports-backup.timer quest-esports-backup-freshness.timer
```

Destructive restore is a separate lifecycle. Keep both timers and both oneshot
services disabled from before the restore through target, security, and
service-recovery validation. Do not run the enable command above for a restore;
re-enable the timers only after the restore has passed validation and the
selected recovery point (archive/checksum and outcome) has been recorded in
the incident record, as required by [Intentional production restore](#intentional-production-restore).

Set `BACKUP_RCLONE_REMOTES` to newline-separated `label=remote:path` entries and
`BACKUP_RCLONE_CONFIGS` to matching newline-separated `label=/path/to/config`
entries. Each remote must have a separate rclone config and credential/token.
The transition path may temporarily contain one configured destination, but
normal operation requires a complete archive/checksum pair to succeed on every
configured remote. Never use `rclone config show` in logs or support output.

The root bootstrap creates the shared lock before any release, migration,
backup, or name-audit operation:

```bash
install -o root -g root -m 644 ops/systemd/quest-esports-release-lock.tmpfiles \
  /etc/tmpfiles.d/quest-esports-release.conf
systemd-tmpfiles --create /etc/tmpfiles.d/quest-esports-release.conf
```

The exact tmpfiles contract is `f /var/lock/quest-esports-release.lock 0660
root deploy -`. The backup wrapper takes this canonical lock before
`/srv/quest-esports/backups/.quest-backup.lock` and holds it through archive
creation, every remote upload/check, and the per-run result record.

## Routine verification

Run these non-secret checks on the VPS:

```bash
systemctl list-timers quest-esports-backup.timer quest-esports-backup-freshness.timer --no-pager

systemctl show quest-esports-backup.service \
  --property=Result,ExecMainStatus,ActiveState \
  --no-pager

journalctl -u quest-esports-backup.service --since today --no-pager

sudo -u deploy -H rclone lsl \
  '<configured-remote:path>' \
  --config '<protected-per-remote-rclone-config>'
```

A completed oneshot service normally reports:

```text
Result=success
ExecMainStatus=0
ActiveState=inactive
```

`inactive` is expected after the oneshot exits. Confirm the newest archive and checksum have the same base name and a plausible non-zero size.
The backup result record also retains `status=success`, `exit_status=0`, and a
success row for every configured remote. A failed remote leaves the archive
and checksum result record in place with `status=failed`; it is not a usable
recovery point. Script success output is limited to the archive basename and
the non-secret systemd result status; it never includes a remote URL,
credential, or environment-file value.

### Create a manual full backup

Run from a directory accessible to `deploy`; do not launch it while the working directory is `/root`.

```bash
cd /var/www/QuestEsports

sudo -u deploy -H env \
  BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
  bash ops/backup-production.sh
```

Success is not established until the encrypted archive and matching checksum
are visible and verified independently on every configured remote. A local
encrypted file alone is insufficient.

Before a release or cutover may migrate, the release-bound recovery command must
return exactly:

```text
verified-complete release_sha=$RELEASE_SHA schemas=verified:public,valorant uploads=verified:public,private archive=verified checksum=verified remote=verified
```

The signed isolated PostgreSQL 17 rehearsal is additional evidence, not a
substitute for this fresh local/remote pair and its exact release binding.

### Test the automated path

```bash
systemctl start quest-esports-backup.service

systemctl show quest-esports-backup.service \
  --property=Result,ExecMainStatus,ActiveState \
  --no-pager
```

### Install and test failure and stale-backup notification

Install the template together with the updated backup service, then reload systemd:

```bash
install -o root -g root -m 644 \
  ops/systemd/quest-esports-backup.service \
  ops/systemd/quest-esports-backup.timer \
  ops/systemd/quest-esports-backup-failure@.service \
  ops/systemd/quest-esports-backup-freshness.service \
  ops/systemd/quest-esports-backup-freshness.timer \
  /etc/systemd/system/

systemctl daemon-reload
```

Add `BACKUP_FAILURE_WEBHOOK_URL` to `/etc/quest-esports-backup.env` without printing the file. The endpoint must be an approved Discord-compatible HTTPS webhook. Test the notifier directly before relying on `OnFailure`:

```bash
sudo -u deploy -H env BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
  bash ops/notify-backup-failure.sh operator-test
```

Confirm exactly one safe alert arrives. The message contains only the host and failed unit name. Rotate the webhook immediately if its URL appears in terminal output, chat, logs, or screenshots.

Set `BACKUP_MAX_AGE_MINUTES=2160` in the protected environment, then verify and
enable the independent freshness path. This is a backup/freshness procedure,
not a restore step. Freshness passes only when the same recent local pair
verifies independently on every required remote:

```bash
sudo -u deploy -H env BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
  bash ops/check-backup-freshness.sh
systemctl start quest-esports-backup-freshness.service
systemctl show quest-esports-backup-freshness.service \
  --property=Result,ExecMainStatus,ActiveState --no-pager
systemctl enable --now quest-esports-backup.timer quest-esports-backup-freshness.timer
```

The freshness timer runs after the normal backup window and fails if there is no archive/checksum pair from the last 36 hours whose local checksum is valid and whose contents match on every required remote. Its `OnFailure` path uses the same notifier, covering a timer or backup schedule that silently stops producing verified recovery points. Restore drills remain the proof of actual recoverability.

### Review and apply off-site retention

Set owner-approved `BACKUP_REMOTE_RETENTION_DAYS` and `BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS` values in the protected environment. First run the tool without a confirmation; it must report a dry run and refuse any policy that would leave fewer than the minimum recovery points:

```bash
sudo -u deploy -H env BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
  bash ops/prune-production-backups.sh
```

After comparing the candidate count with Drive and the incident/finance retention requirement, run the intentional deletion once:

```bash
sudo -u deploy -H env \
  BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
  RETENTION_CONFIRMATION=PRUNE_QUEST_PRODUCTION \
  bash ops/prune-production-backups.sh
```

Do not automate this deletion until at least one newer archive has passed a full isolated restore drill and the business owner has approved the schedule. The tool lists and evaluates every configured remote independently; do not manually delete remote objects. Object-locked destinations remain confirmation-gated and a failed remote causes a nonzero result.

### Create the separate secret recovery package

The database/upload archive is not a complete environment backup. Follow [Secret and Infrastructure Recovery](./secret-and-infrastructure-recovery.md) to create, transfer, and independently restore-test the separately encrypted backend environment, rclone configuration, and installed infrastructure configuration. Its private identity must remain offline and separate from the normal backup identity and destination.

## Historical pre-cutover Windows recovery snapshot

The following Windows commands are retained as historical pre-cutover tooling
only. They must not be treated as a current production backup or recovery
target; current production is the VPS PostgreSQL 17 target recorded above:

```powershell
Set-Location D:\Work\Projects\QuestEsports
.\ops\backup-paris-database-windows.ps1
.\ops\test-paris-database-backup-windows.ps1
```

This workflow validates an encrypted application-database snapshot in disposable PostgreSQL 17. The Windows snapshot contains the application `public` schema only, does not contain VPS uploads, and does not replace the full off-site backup or a full `public` plus `valorant` recovery archive.

## Recovery decision matrix

| Incident | Preferred recovery |
| --- | --- |
| One missing upload | Recover the matching file from an archive on an isolated host, verify it, then copy only that file back |
| Upload tree corruption | Stop writes, restore both upload roots from one consistent archive, and verify database/file references |
| Accidental application-table change | Restore the archive into disposable PostgreSQL first, inspect the required rows, then choose targeted SQL recovery or an approved full restore |
| VPS PostgreSQL 17 database loss | Replace or recover the VPS PostgreSQL 17 target (`quest-postgres`, `127.0.0.1:5433`) from a verified complete archive, restore the application schemas recorded by the archive manifest (`public` and `valorant` when included), update protected secrets, run migrations/security checks, then switch the backend only after validation; never select stale Supabase |
| VPS loss with database intact | Rebuild the VPS from Git and the secret store, restore public/private uploads, reinstall PM2/Nginx/systemd/rclone, then verify health |
| Complete environment loss | Rebuild database and VPS, restore database/uploads, restore external configuration from its separate secret recovery process, then update DNS and verify every integration |
| OAuth token revoked | Re-authorize the affected configured remote and run a manual plus systemd backup test; do not change archive encryption keys |
| Private `age` identity lost | Existing archives cannot be decrypted; locate the second offline identity copy before taking any destructive action |

## Isolated full restore drill

Perform this at least quarterly and after meaningful changes to the backup scripts, database major version, upload layout, encryption, or storage provider.

### Phase 8 rehearsal boundary

Use `ops/rehearsal/postgres17-restore-rehearsal.sh`, not a direct invocation of
the destructive restore primitive, for a full drill. Create the evidence
directory before starting and make it private. The wrapper requires an
explicit `REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL`, an existing
mode-600 recovery environment, an absolute encrypted archive and exact
`.sha256` sibling, an offline age identity, a private mode-600 disposable-target
sentinel, and roots below a previously absent dedicated upload parent that the
wrapper creates before creating the two roots. Cleanup removes only empty disposable
roots and their parent; nonempty restored trees remain available for inspection or
manual rollback. The `DIRECT_URL` loopback host/port must match the
inspected container's PostgreSQL port mapping, and `QUEST_RUNTIME_DATABASE_URL`
must use `quest_runtime` against that same endpoint,
and pinned PostgreSQL 17 `psql`, `pg_restore`, and `pg_dump`. It also requires
an operator-recorded source-version evidence file, an executable repository
security-verifier hook, executable disposable failure-injection hooks, and an
executable no-writer-admission probe. It refuses
production-looking database hosts and paths, root/symlink/nested/identical
targets, unsafe environment-file content, missing manifest checksum/age
identity/evidence, non-17 clients, and an unapproved source-major mismatch.
The security verifier hook must return only the exact stdout token
`security-verified`; its private output artifact and SHA-256 binding are
retained in the evidence bundle. Failure hooks retain their executable path and
content hash, raw structured output, attempted endpoint ID/hash, affected
service, pre/post state, and containment result.
The host must bootstrap `openssl` and a protected signing key pair. The wrapper
requires `REHEARSAL_SIGNING_PRIVATE_KEY`; verification requires the operator-
trusted `REHEARSAL_TRUSTED_SIGNING_PUBLIC_KEY`. Missing key material or the
signature tool fails closed.

The wrapper makes a temporary isolated `BACKUP_ENV_FILE`, invokes
`restore-production-backup.sh` with `RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION`
and a zero countdown, and captures its output privately. It emits a fixed-name
`rehearsal-observations.env` plus hashed raw role/inventory artifacts, binds
that raw file into the summary, and then records the
exact two-schema manifest scope, source/client versions, checksum/decryption,
both schema/object counts, the pre-restore and post-restore migration ledgers
(including the exact VALORANT `_migration_ledger`), roles/owners/grants/default
ACLs, before/after extensions/settings/RLS, upload counts/bytes/checksums, Quest and
VALORANT health/CA/database status, validation freeze and writer rejection,
named negative injections, measured resources, and explicit owner-approved
RPO/RTO decisions.
No database URL, credential, token, or secret environment value is printed or
written to the summary/observations; only approved failure-hook paths,
executable hashes, configured endpoint IDs, and endpoint hashes are retained in
the signed artifact inventory. Verify only with:

The recorded upload checksums are post-restore tree checksums. They are not
claims that the restored tree equals the source unless a source per-file
inventory was supplied and independently bound. The source-version record is
labelled `operator_recorded` when this isolated target cannot measure the live
source; a different major is an approved logical-migration gate, never a live
source probe.

```bash
REHEARSAL_TRUSTED_SIGNING_PUBLIC_KEY=/secure/recovery/rehearsal-trusted-signing-public.pem \
  bash ops/rehearsal/verify-rehearsal-evidence.sh \
  /secure/archives/quest-production-YYYYMMDDTHHMMSSZ.tar.gz.enc \
  /secure/recovery/rehearsal-evidence
```

The verifier recomputes the selected archive checksum and every deterministic
evidence-artifact hash, and requires the detached manifest signature from the
trusted public key. Hooks receive only the disposable isolated-target context;
their absolute paths, executable hashes, configured endpoint identities, and
exact accepted outputs are retained in private evidence. The wrapper independently
checks the nonce through `pg_stat_activity` inside the inspected container and
uses the least-privileged `quest_runtime` URL for the Quest read probe.
The verifier rejects stale, malformed, incomplete, production-looking, or
file-existence-only evidence. A valid rehearsal still does not prove a live
VPS, Supabase project, rclone remote, Docker deployment, or the sibling
VALORANT deployment. The sibling VALORANT Compose manifest and live
source-major record remain required operator artifacts; this Quest worktree
cannot manufacture either one. If the recorded source major differs from 17,
the rehearsal is a logical-major-migration gate and must not be described as a
transparent compatible restore.

1. Select one archive and its exact `.sha256` sibling from the active remote.
2. Download both through the Google Drive UI or a recovery-only rclone configuration to an access-controlled recovery host.
3. Copy `ops/quest-esports-recovery.env.example` outside the repository and set:
   - `DIRECT_URL` to disposable PostgreSQL 17, never live production. This
     fixture-only name is not accepted by the production restore primitive;
     production restores use the separately protected `RECOVERY_ADMIN_URL`.
   - `QUEST_RUNTIME_DATABASE_URL` to the `quest_runtime` credential for the same
     disposable database endpoint.
   - `UPLOAD_ROOT` and `PRIVATE_UPLOAD_ROOT` below a new, dedicated parent that
     does not already exist; the wrapper creates the parent and roots separately,
     and cleanup removes only empty roots and the now-empty parent. Nonempty restored
     trees are retained for inspection or manual rollback.
   - `BACKUP_AGE_IDENTITY_FILE` to the offline identity path.
4. Restrict the recovery environment to the recovery operator.
5. Independently verify the checksum.
6. Confirm the database host and both target paths again.
7. Run the guarded restore script.

```bash
chmod 600 /secure/recovery/quest-esports-recovery.env
chmod 600 /secure/recovery/quest-rehearsal-target.env

cd /path/to/QuestEsports

REHEARSAL_CONFIRMATION=DISPOSABLE_QUEST_REHEARSAL \
  BACKUP_ENV_FILE=/secure/recovery/quest-esports-recovery.env \
  REHEARSAL_EVIDENCE_DIR=/secure/recovery/rehearsal-evidence \
  REHEARSAL_TARGET_SENTINEL_FILE=/secure/recovery/quest-rehearsal-target.env \
  POSTGRES17_BIN=/usr/lib/postgresql/17/bin \
  bash ops/rehearsal/postgres17-restore-rehearsal.sh \
  /secure/archives/quest-production-YYYYMMDDTHHMMSSZ.tar.gz.enc
```

The confirmation value acknowledges destructive behavior; it does not prove that the target is safe. The operator must still verify the disposable database and paths. Before changing any target, the script checksum-verifies and decrypts the archive, rejects unsafe archive paths, validates the manifest and PostgreSQL dump, and builds complete upload replacement trees on the target filesystems. It then activates both trees with same-filesystem renames under an exit rollback guard and restores the database in one transaction. A database or activation failure rolls the file trees back; after success, the previous trees are retained for inspection/manual rollback. Keep the API in maintenance mode throughout because the file and database stores cannot share one transaction.

After the script finishes:

- Verify the archive's manifest database scope. For `database_scope=application_public_and_valorant_schemas`, confirm the restore script printed non-zero table counts for both `public` and `valorant`; for `database_scope=application_public_schema_only`, confirm the public-only scope is intentional for the target.
- Count restored public tables and completed Prisma migrations.
- Compare public/private file counts and byte totals with the source manifest or recorded production inventory.
- Validate representative images and private proofs without exposing them.
- Run application migrations and `npm run prisma:security:verify` against the disposable database.
- Record start/end time, archive name, checksum result, counts, failures, and cleanup.
- Remove plaintext extraction trees, disposable database resources, temporary credentials, and recovery-only OAuth tokens.
- Keep the encrypted archive/checksum only under the approved retention policy.

## Intentional production restore

A production restore requires an incident decision because it replaces application database objects and makes both upload trees exactly match the selected archive. The recovery procedure is split at the durable post-first-write boundary; do not use the legacy PM2 procedure for a PostgreSQL 17-authoritative deployment.

### Pre-cutover legacy PM2 recovery (before first PostgreSQL 17 writer)

This path applies only while the durable release evidence still says
`previous_release=supabase`, no PostgreSQL 17 writer admission has started, and
the legacy Quest PM2 process remains the active application. It is not a
Compose recovery and must not make PostgreSQL 17 authoritative.

1. Declare the incident, recovery owner, archive timestamp, expected data loss, and approval. Confirm the pre-cutover boundary in the private release evidence.
2. Stop the legacy Quest writer and preserve the failed state:

   ```bash
   sudo -u deploy -H pm2 stop quest-backend
   ```

   If the legacy VALORANT service is active, stop it through its owner-installed
   `OLD_VALORANT_STOP_COMMAND=/usr/local/sbin/quest-release-old-valorant-stop`
   wrapper as part of the same freeze; do not use a broad service stop.
3. Restore-test the selected archive on disposable infrastructure first. Confirm the manifest database scope before restoring; an archive without `valorant` must not be used as a replacement for a project that already contains VALORANT data.
4. Restore only to the approved pre-cutover database target using the guarded procedure. Keep the private identity off the production VPS, stage both upload roots, and retain the failed-state preservation copy.
5. Restore ownership and permissions, then run migration status and the database security verifier before service restart:

   ```bash
   chown -R deploy:deploy /srv/quest-esports/uploads /srv/quest-esports/private
   chmod 700 /srv/quest-esports/private
   ```

6. Restart only the previously active, still-unmasked legacy writers after the restore and all checks pass. For Quest use `OLD_QUEST_RESTART_COMMAND=/usr/local/sbin/quest-release-old-quest-restart`; for VALORANT use `OLD_VALORANT_RESTART_COMMAND=/usr/local/sbin/quest-release-old-valorant-restart`. Do not mask either legacy writer on this path.
7. Verify `/api/health/ready`, tournaments, products, commerce capabilities, authentication, admin access, uploads, and enabled mail/payment paths. Retain the incident and preservation copy until business sign-off.

### Post-first-write Compose recovery (after first PostgreSQL 17 writer)

This path applies as soon as either PostgreSQL 17 writer admission starts, even
if the final commit-point file was not completed. Supabase is then stale
recovery material. There is no PM2 restart, old-writer restart, or one-service
Supabase URL toggle on this path.

1. Declare the incident, recovery owner, archive timestamp, expected loss/RPO, and incident-owner approval. Keep both Compose writer groups stopped for the entire recovery decision.
2. Stop both current writer groups through the exact root-owned controls, and require both `stopped` acknowledgements:

   ```text
   QUEST_WRITER_STOP_COMMAND=/usr/local/sbin/quest-release-quest-writer-stop
   VALORANT_WRITER_STOP_COMMAND=/usr/local/sbin/quest-release-valorant-writer-stop
   ```

   Re-enable and acknowledge both coordinated freezes. The corresponding
   `QUEST_FREEZE_ENABLE_COMMAND` and `VALORANT_FREEZE_ENABLE_COMMAND` wrappers
   must succeed; maintenance mode alone is not a freeze. Run the coordinated
   post-commit containment wrapper, not either old PM2/service control:

   ```bash
   sudo env \
     EXPECTED_LOSS_RPO='<owner-approved statement>' \
     INCIDENT_OWNER_APPROVAL=INCIDENT_OWNER_APPROVAL \
     SUPABASE_RECONCILIATION_DECISION=controlled-restore \
     /usr/local/sbin/quest-esports-rollback post-commit
   ```
3. Capture and checksum the current PostgreSQL 17 database and both upload roots with the configured `CURRENT_STATE_CAPTURE_COMMAND`. Record expected loss/RPO before selecting fix-forward or controlled restore.
4. Restore-test the selected complete two-schema archive on disposable infrastructure first. Confirm the manifest scope, checksum, `--no-owner --no-acl --single-transaction --exit-on-error` contract, and separate security verification.
5. Keep the Quest and VALORANT Compose writer controls stopped. Before the guarded restore, reapply the staging overlay and stop both backup timers/services so no backup races the restore; then start PostgreSQL with the overlay and verify the exact `127.0.0.1:55432` endpoint:

   ```bash
   sudo systemctl disable --now quest-esports-backup.timer quest-esports-backup-freshness.timer
   sudo systemctl stop quest-esports-backup.service quest-esports-backup-freshness.service
   COMPOSE_ENV=/etc/quest-esports/quest.production.env
   docker compose --env-file "$COMPOSE_ENV" \
     -f ops/docker/compose.production.yml \
     -f ops/docker/compose.postgres-staging.yml up -d postgres
   docker compose --env-file "$COMPOSE_ENV" \
     -f ops/docker/compose.production.yml \
     -f ops/docker/compose.postgres-staging.yml ps postgres
   ```

   The supported host-run restore target is `127.0.0.1:55432`, database
   `quest`, PostgreSQL 17, and the canonical
   `/srv/quest-esports/postgres/17/data`; no private-network utility is
   implemented. After the post-commit containment wrapper completes, an
   explicitly authorized production restore uses the protected target
   environment and the existing guarded primitive:

   ```bash
   sudo env \
     RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
     RESTORE_PRODUCTION_AUTHORIZED=1 \
     RESTORE_TARGET_AUTHORIZATION=production \
     BACKUP_ENV_FILE=/secure/recovery/quest-esports-recovery.env \
     bash /var/www/QuestEsports/ops/restore-production-backup.sh \
     /secure/archives/quest-production-YYYYMMDDTHHMMSSZ.tar.gz.enc
   ```

   The separately protected recovery environment and canonical sentinel supply the exact
   target identity, TLS files, and the dedicated `quest_recovery_admin` restore
   credential contract;
   verify them without printing values. Never point this command at Supabase.
6. Do not set either runtime URL to Supabase and do not invoke `SUPABASE_URL_ROLLBACK_COMMAND`. The post-first-write release contract rejects that command. Complete either the approved fix-forward action or the controlled restore action, then start and validate both Compose candidates frozen before any writer admission.
7. Restore ownership and permissions, run both migration-status checks and the database security verifier, then verify Quest readiness, VALORANT HTTPS health (`status=ok`, `db=up`), uploads, authentication, admin access, and enabled mail/payment paths. Keep both host backup timers and both oneshot services disabled throughout the destructive restore, target/security validation, and service recovery. Record the selected recovery point (archive/checksum and outcome) in the incident record after successful validation.
8. Only after incident-owner sign-off and both readiness gates may the exact coordinated writer-enable controls be used. Never restart `OLD_QUEST_RESTART_COMMAND` or `OLD_VALORANT_RESTART_COMMAND` against the PostgreSQL 17 state, and never run either old mask command as a recovery substitute. After both writer-enable controls succeed and post-recovery service readiness is confirmed, re-enable the host backup timers:

   ```bash
   sudo systemctl enable --now quest-esports-backup.timer quest-esports-backup-freshness.timer
   ```

## Rebuilding a lost VPS

The encrypted production archive does not contain the operating system or external secrets. A rebuild also requires:

- A fresh supported Ubuntu VPS and the `deploy` account.
- The exact intended Git commit after CI approval.
- Backend `.env` values from the approved secret-recovery location.
- Nginx, TLS, firewall, PM2 startup, and persistent upload directory configuration.
- PostgreSQL client 17, Node.js, `age`, `rclone`, and `rsync`.
- Re-authorization of the dedicated Google Drive remote if its protected config is unavailable.
- Installation and enablement of the systemd backup service/timer.

Restore uploads and database before admitting user writes. Then run the full production verification checklist and create a new encrypted backup from the rebuilt system.

## Failure triage

| Symptom | Check | Safe response |
| --- | --- | --- |
| Backup PostgreSQL client image unavailable | `docker image inspect <approved-postgres-17-digest>` | Restore the exact pinned image; never fall back to a host client or publish PostgreSQL |
| `find: Failed to restore initial working directory` | Current directory is `/root` while running as `deploy` | `cd /var/www/QuestEsports` and rerun |
| rclone authentication failure | OAuth app status, Drive API, token revocation, remote name | Re-authorize interactively without printing config; retest manual and systemd paths |
| Archive exists without checksum | Service journal and remote listing | Treat it as incomplete; do not restore it |
| Checksum mismatch | Download integrity and matching filename | Stop; download the matching pair again and investigate |
| `age` cannot decrypt | Correct identity file and archive generation | Stop; never rotate or overwrite the only identity while investigating |
| Upload restore path unexpected | `realpath` and recovery environment | Abort before the 10-second restore delay ends |
| systemd result failed | `journalctl -u quest-esports-backup.service` | Correct the prerequisite, rerun manually, then rerun the systemd service |
| Drive storage grows continuously | Protected retention values and dry-run output | Use `ops/prune-production-backups.sh`; do not bypass its minimum-point guard or confirmation |
| Backup fails without an alert | Failure unit installation, webhook setting, and direct notifier test | Install/reload the template, add the protected webhook, test one alert, then rerun the backup service |

## Restore-drill record requirements

Checked-in files do not prove that a current full off-site restore drill has
been completed. The owner must select an archive, verify its checksum and
destination, run the isolated procedure above, and record the results below.
Do not describe recovery as restore-verified until that drill has been
completed against the current scripts and archive format. Production must never
be the restore target.

Record future drills using this minimum template:

```text
Date/time:
Operator:
Archive and destination:
Expected/actual SHA-256:
Recovery target:
Production modified: no
Database version:
Public table count:
Completed migration count:
Public file count/bytes/checksum result:
Private file count/bytes/checksum result:
Start/end time:
Failures and corrections:
Plaintext cleanup completed:
Next drill due:
```
