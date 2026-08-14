# Backup and Disaster Recovery

Last verified: July 29, 2026

This is the source of truth for Quest Esports production backup, restore testing, and disaster recovery. The [Production Operations Runbook](./production-runbook.md) covers the surrounding VPS and deployment procedures.

## Safety rules

1. Never test a restore against the live Paris database or live upload directories.
2. Never print or commit `/etc/quest-esports-backup.env` or `/srv/quest-esports/rclone/quest-esports.conf`.
3. Never place the private `age` identity in Git, Google Drive, email, chat, support tickets, or a normal cloud-synced folder.
4. Always require both an encrypted archive and its matching `.sha256` file.
5. Always verify the checksum before decrypting.
6. Treat `ops/restore-production-backup.sh` as destructive: it runs `pg_restore --clean --if-exists` and synchronizes both upload roots with `rsync --delete`.
7. Stop application writes and preserve the current failed state before an intentional production restore whenever possible.

Visitor maintenance mode alone is not a write freeze: background jobs and the PayHere notification callback intentionally continue. A restore or destructive recovery requires stopping the PM2 backend process as described below.

## Current production recovery status

| Component | Current state |
| --- | --- |
| Database | Supabase PostgreSQL, Paris `eu-west-3` |
| Backend | France VPS, `/var/www/QuestEsports`, PM2 process `quest-backend` owned by `deploy` |
| Public uploads | `/srv/quest-esports/uploads` |
| Private uploads | `/srv/quest-esports/private` |
| Backup staging | `/srv/quest-esports/backups`, seven-day local retention |
| Active off-site destination | `quest-backups-custom:quest-esports-v2/production` |
| Historical destination | `quest-backups:quest-esports/production` |
| Encryption | `age` public-recipient encryption; private identity kept offline |
| Automation | `quest-esports-backup.service` and `quest-esports-backup.timer` |
| Schedule | Daily at 02:15 UTC with up to 15 minutes randomized delay; missed runs are persistent |
| Last full restore drill | Passed on 2026-07-29 |

The active Drive remote uses a QuestEsports-owned Google OAuth desktop client, the least-privilege `drive.file` scope, and an **In production** publishing status. The older shared-client remote is retained only for historical archives until their approved retention period ends.

## Recovery objectives and limitations

- The timer provides a technical recovery-point interval of approximately 24 hours plus up to 15 minutes when the timer, VPS, database, and Drive destination are healthy. A migration-changing CD run creates an additional backup immediately before migration.
- There is no contractual recovery-time objective recorded yet. Time the next quarterly drill and have the business owner approve an RTO and RPO.
- Local encrypted copies older than `BACKUP_LOCAL_RETENTION_DAYS` are removed by the script; the current value is seven days.
- The repository includes a dry-run-first remote retention tool with a minimum-recovery-point guard. Production deletion remains disabled until the owner approves the retention values and runs the exact confirmation-gated command.
- The repository includes a systemd `OnFailure` notifier. It pages an operator only after the failure unit is installed and an approved Discord-compatible HTTPS webhook is added to the protected backup environment and tested.

## What a full production archive contains

Each `quest-production-YYYYMMDDTHHMMSSZ.tar.gz.enc` contains:

- `database.dump`: PostgreSQL custom-format dump of the application-owned `public` schema.
- `manifest.txt`: creation time, source host, dump format, source upload paths, and the two-pass file snapshot strategy.
- The entire public upload directory.
- The entire private upload directory, including protected payment evidence.

Each archive has a sibling `quest-production-....tar.gz.enc.sha256` checksum file.

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
| Backup environment | `/etc/quest-esports-backup.env`, `root:deploy`, mode `640` | Contains the database URL; never print the file |
| rclone configuration | `/srv/quest-esports/rclone/quest-esports.conf`, `deploy:deploy`, mode `600` | Contains OAuth material; inspect only through safe rclone commands |
| Google OAuth client | Google Cloud project `QuestEsports Backups` | Do not commit/download/store its JSON unnecessarily; rotate if exposed |
| Production application secrets | Approved encrypted secret store | Not included in the backup archive |

Losing every copy of the private `age` identity makes existing encrypted archives unrecoverable. If the rclone token is lost, the encrypted files remain in Google Drive and can be downloaded through an authorized account while the remote is re-authorized.

## Installation and configuration

The production templates are:

- `ops/quest-esports-backup.env.example`
- `ops/systemd/quest-esports-backup.service`
- `ops/systemd/quest-esports-backup.timer`
- `ops/systemd/quest-esports-backup-failure@.service`
- `ops/systemd/quest-esports-backup-freshness.service`
- `ops/systemd/quest-esports-backup-freshness.timer`

Install PostgreSQL client 17, `age`, `rclone`, and `rsync`. The generic Ubuntu `pg_dump` may still resolve to PostgreSQL 16, so the backup environment pins `/usr/lib/postgresql/17/bin` at the start of `PATH`.

The backup takes an exclusive `flock`, copies both immutable upload trees, runs the database dump, and copies the upload trees a second time before packaging. This closes the common gap where a database row commits while its file is omitted from the archive. PostgreSQL and the VPS filesystem still cannot participate in one distributed transaction, so the application must keep random upload filenames immutable and quarterly restore verification remains required.

Use the dedicated Google OAuth client when creating the rclone remote. Create and test a new remote before changing `BACKUP_RCLONE_REMOTE`; this preserves the previous remote as rollback access. Never use `rclone config show` in logs or support output.

## Routine verification

Run these non-secret checks on the VPS:

```bash
systemctl list-timers quest-esports-backup.timer quest-esports-backup-freshness.timer --no-pager

systemctl show quest-esports-backup.service \
  --property=Result,ExecMainStatus,ActiveState \
  --no-pager

journalctl -u quest-esports-backup.service --since today --no-pager

sudo -u deploy -H rclone lsl \
  quest-backups-custom:quest-esports-v2/production \
  --config /srv/quest-esports/rclone/quest-esports.conf
```

A completed oneshot service normally reports:

```text
Result=success
ExecMainStatus=0
ActiveState=inactive
```

`inactive` is expected after the oneshot exits. Confirm the newest archive and checksum have the same base name and a plausible non-zero size.

### Create a manual full backup

Run from a directory accessible to `deploy`; do not launch it while the working directory is `/root`.

```bash
cd /var/www/QuestEsports

sudo -u deploy -H env \
  BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
  bash ops/backup-production.sh
```

Success is not established until both remote objects are visible. A local encrypted file alone is insufficient.

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

Set `BACKUP_MAX_AGE_MINUTES=2160` in the protected environment, then verify and enable the independent freshness path:

```bash
sudo -u deploy -H env BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
  bash ops/check-backup-freshness.sh
systemctl start quest-esports-backup-freshness.service
systemctl show quest-esports-backup-freshness.service \
  --property=Result,ExecMainStatus,ActiveState --no-pager
systemctl enable --now quest-esports-backup.timer quest-esports-backup-freshness.timer
```

The freshness timer runs after the normal backup window and fails if there is no archive/checksum pair from the last 36 hours whose local checksum is valid and whose off-site contents match. Its `OnFailure` path uses the same notifier, covering a timer or backup schedule that silently stops producing verified recovery points. Restore drills remain the proof of actual recoverability.

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

Do not automate this deletion until at least one newer archive has passed a full isolated restore drill and the business owner has approved the schedule. The rclone listing handles the complete remote; do not manually delete pages of Drive results.

### Create the separate secret recovery package

The database/upload archive is not a complete environment backup. Follow [Secret and Infrastructure Recovery](./secret-and-infrastructure-recovery.md) to create, transfer, and independently restore-test the separately encrypted backend environment, rclone configuration, and installed infrastructure configuration. Its private identity must remain offline and separate from the normal backup identity and destination.

## Database-only Windows recovery snapshot

The secured Windows recovery PC can create and restore-test a Paris database-only snapshot:

```powershell
Set-Location D:\Work\Projects\QuestEsports
.\ops\backup-paris-database-windows.ps1
.\ops\test-paris-database-backup-windows.ps1
```

This workflow validates an encrypted public-schema dump in disposable PostgreSQL 17. It does not contain VPS uploads and does not replace the full off-site backup.

## Recovery decision matrix

| Incident | Preferred recovery |
| --- | --- |
| One missing upload | Recover the matching file from an archive on an isolated host, verify it, then copy only that file back |
| Upload tree corruption | Stop writes, restore both upload roots from one consistent archive, and verify database/file references |
| Accidental application-table change | Restore the archive into disposable PostgreSQL first, inspect the required rows, then choose targeted SQL recovery or an approved full restore |
| Paris database loss | Create a compatible PostgreSQL/Supabase target, restore the application `public` schema, update secrets, run migrations/security checks, then switch the backend |
| VPS loss with database intact | Rebuild the VPS from Git and the secret store, restore public/private uploads, reinstall PM2/Nginx/systemd/rclone, then verify health |
| Complete environment loss | Rebuild database and VPS, restore database/uploads, restore external configuration from its separate secret recovery process, then update DNS and verify every integration |
| OAuth token revoked | Re-authorize the dedicated rclone remote and run a manual plus systemd backup test; do not change archive encryption keys |
| Private `age` identity lost | Existing archives cannot be decrypted; locate the second offline identity copy before taking any destructive action |

## Isolated full restore drill

Perform this at least quarterly and after meaningful changes to the backup scripts, database major version, upload layout, encryption, or storage provider.

1. Select one archive and its exact `.sha256` sibling from the active remote.
2. Download both through the Google Drive UI or a recovery-only rclone configuration to an access-controlled recovery host.
3. Copy `ops/quest-esports-recovery.env.example` outside the repository and set:
   - `DIRECT_URL` to disposable PostgreSQL 17, never Paris production.
   - `UPLOAD_ROOT` and `PRIVATE_UPLOAD_ROOT` to new empty temporary directories.
   - `BACKUP_AGE_IDENTITY_FILE` to the offline identity path.
4. Restrict the recovery environment to the recovery operator.
5. Independently verify the checksum.
6. Confirm the database host and both target paths again.
7. Run the guarded restore script.

```bash
chmod 600 /secure/recovery/quest-esports-recovery.env

cd /path/to/QuestEsports

RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
  BACKUP_ENV_FILE=/secure/recovery/quest-esports-recovery.env \
  bash ops/restore-production-backup.sh \
  /secure/archives/quest-production-YYYYMMDDTHHMMSSZ.tar.gz.enc
```

The confirmation value acknowledges destructive behavior; it does not prove that the target is safe. The operator must still verify the disposable database and paths. Before changing any target, the script checksum-verifies and decrypts the archive, rejects unsafe archive paths, validates the manifest and PostgreSQL dump, and builds complete upload replacement trees on the target filesystems. It then activates both trees with same-filesystem renames under an exit rollback guard and restores the database in one transaction. A database or activation failure rolls the file trees back; after success, the previous trees are retained for inspection/manual rollback. Keep the API in maintenance mode throughout because the file and database stores cannot share one transaction.

After the script finishes:

- Verify both schemas were restored: the archive's manifest `database_scope=application_public_and_valorant_schemas` and the restore script printed non-zero table counts for both `public` and `valorant`.
- Count restored public tables and completed Prisma migrations.
- Compare public/private file counts and byte totals with the source manifest or recorded production inventory.
- Validate representative images and private proofs without exposing them.
- Run application migrations and `npm run prisma:security:verify` against the disposable database.
- Record start/end time, archive name, checksum result, counts, failures, and cleanup.
- Remove plaintext extraction trees, disposable database resources, temporary credentials, and recovery-only OAuth tokens.
- Keep the encrypted archive/checksum only under the approved retention policy.

## Intentional production restore

A production restore requires an incident decision because it replaces application database objects and makes both upload trees exactly match the selected archive.

1. Declare the incident, recovery owner, archive timestamp, expected data loss, and approval.
2. Stop writes to the API. On the current VPS:

   ```bash
   sudo -u deploy -H pm2 stop quest-backend
   ```

3. Preserve the current database and upload state when it is safe; evidence from the failed state may be needed for targeted recovery.
4. Restore-test the selected archive on disposable infrastructure first. Confirm the selected archive includes the `valorant` schema before restoring; a public-only archive restored over a project that already contains VALORANT data would drop it (`pg_restore --clean`).
5. Prefer running the guarded restore from an isolated recovery host. Point `DIRECT_URL` at the approved database target and use empty recovery-host upload directories; keep the private identity off the production VPS. The script stages files before the transactional database restore and activates them only after it succeeds.
6. If recovery was performed off-VPS, securely synchronize the verified recovered upload trees to the stopped VPS. Treat any deletion or directory replacement as destructive and verify exact absolute targets first. If the guarded script was run on the target host, record and retain the printed `.quest-previous-*` directories until business verification is complete, then remove them only under a separate approved cleanup.
7. If a new Supabase project is used, update both production database URLs and rotate project/database credentials. Recreate required Supabase-managed settings separately.
8. On the VPS, restore ownership and permissions:

   ```bash
   chown -R deploy:deploy /srv/quest-esports/uploads /srv/quest-esports/private
   chmod 700 /srv/quest-esports/private
   ```

9. From `/var/www/QuestEsports/backend`, run migration status, deploy any forward-compatible pending migrations, and run the database security verifier.
10. Restart and persist the backend process:

    ```bash
    sudo -u deploy -H pm2 restart quest-backend --update-env
    sudo -u deploy -H pm2 save
    ```

11. Verify `/api/health/ready`, tournaments, products, commerce capabilities, authentication, admin access, uploads, and any enabled mail/payment paths.
12. Monitor logs and retain the incident record. Do not destroy the preservation copy until business sign-off.

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
| `pg_dump` version mismatch | `/usr/lib/postgresql/17/bin/pg_dump --version` and backup `PATH` | Install/pin client 17; do not downgrade the server |
| `find: Failed to restore initial working directory` | Current directory is `/root` while running as `deploy` | `cd /var/www/QuestEsports` and rerun |
| rclone authentication failure | OAuth app status, Drive API, token revocation, remote name | Re-authorize interactively without printing config; retest manual and systemd paths |
| Archive exists without checksum | Service journal and remote listing | Treat it as incomplete; do not restore it |
| Checksum mismatch | Download integrity and matching filename | Stop; download the matching pair again and investigate |
| `age` cannot decrypt | Correct identity file and archive generation | Stop; never rotate or overwrite the only identity while investigating |
| Upload restore path unexpected | `realpath` and recovery environment | Abort before the 10-second restore delay ends |
| systemd result failed | `journalctl -u quest-esports-backup.service` | Correct the prerequisite, rerun manually, then rerun the systemd service |
| Drive storage grows continuously | Protected retention values and dry-run output | Use `ops/prune-production-backups.sh`; do not bypass its minimum-point guard or confirmation |
| Backup fails without an alert | Failure unit installation, webhook setting, and direct notifier test | Install/reload the template, add the protected webhook, test one alert, then rerun the backup service |

## Verified drill record

The first full off-site drill completed on 2026-07-29 using `quest-production-20260729T133809Z.tar.gz.enc` from the historical destination. Its SHA-256 matched. Disposable PostgreSQL 17 restored 35 public tables and 33 completed migrations. All 41 public files and 10 private files matched their SHA-256 inventories. Production was never a restore target.

The drill exposed and corrected a missing `pg_restore --dbname` option in the guarded restore script, and a regression test now covers it. After the dedicated OAuth switch, manual archive `quest-production-20260729T154756Z.tar.gz.enc` and its checksum were confirmed on the active destination, and the restricted systemd service returned `Result=success` and status 0. The later overlap lock, two-pass upload snapshot, remote-content check, full preflight, single-transaction restore, and atomic file activation changes pass repository tests but require a new isolated end-to-end drill before they may be described as production restore-verified.

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
