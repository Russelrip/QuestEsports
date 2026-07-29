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
- Remote Google Drive retention is not automatically pruned. Review storage and apply an approved remote retention policy without deleting the newest verified recovery points.
- A failed systemd job does not currently page an operator by itself. Monitor the timer/service or connect systemd failure reporting to the approved alert channel.

## What a full production archive contains

Each `quest-production-YYYYMMDDTHHMMSSZ.tar.gz.enc` contains:

- `database.dump`: PostgreSQL custom-format dump of the application-owned `public` schema.
- `manifest.txt`: creation time, source host, dump format, and source upload paths.
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

Install PostgreSQL client 17, `age`, `rclone`, and `rsync`. The generic Ubuntu `pg_dump` may still resolve to PostgreSQL 16, so the backup environment pins `/usr/lib/postgresql/17/bin` at the start of `PATH`.

Use the dedicated Google OAuth client when creating the rclone remote. Create and test a new remote before changing `BACKUP_RCLONE_REMOTE`; this preserves the previous remote as rollback access. Never use `rclone config show` in logs or support output.

## Routine verification

Run these non-secret checks on the VPS:

```bash
systemctl list-timers quest-esports-backup.timer --no-pager

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

The confirmation value acknowledges destructive behavior; it does not prove that the target is safe. The operator must still verify the disposable database and paths.

After the script finishes:

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
4. Restore-test the selected archive on disposable infrastructure first.
5. Prefer running the guarded restore from an isolated recovery host. Point `DIRECT_URL` at the approved database target and use empty recovery-host upload directories; keep the private identity off the production VPS.
6. After database restoration, securely synchronize the verified recovered upload trees to the stopped VPS. Treat any `--delete` operation as destructive and verify exact absolute targets first.
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
| Drive storage grows continuously | Remote retention is manual | Review with the owner; never delete the newest verified recovery points |

## Verified drill record

The first full off-site drill completed on 2026-07-29 using `quest-production-20260729T133809Z.tar.gz.enc` from the historical destination. Its SHA-256 matched. Disposable PostgreSQL 17 restored 35 public tables and 33 completed migrations. All 41 public files and 10 private files matched their SHA-256 inventories. Production was never a restore target.

The drill exposed and corrected a missing `pg_restore --dbname` option in the guarded restore script, and a regression test now covers it. After the dedicated OAuth switch, manual archive `quest-production-20260729T154756Z.tar.gz.enc` and its checksum were confirmed on the active destination, and the restricted systemd service returned `Result=success` and status 0.

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
