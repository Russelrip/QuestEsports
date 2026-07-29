# Production Operations Scripts

These scripts support encrypted backup and recovery for Quest Esports production. The complete safety procedure is in [Backup and Disaster Recovery](../docs/backup-and-disaster-recovery.md).

| File | Purpose |
| --- | --- |
| `backup-production.sh` | Locks against overlap, snapshots both upload roots around a PostgreSQL `public`-schema dump, encrypts with `age`, uploads with rclone, verifies remote content, and prunes old local encrypted files |
| `restore-production-backup.sh` | Preflights/stages both file trees, activates them under an exit rollback guard, restores PostgreSQL in one transaction, and retains replaced trees after success; destructive and confirmation-gated |
| `prune-production-backups.sh` | Dry-run-by-default off-site retention with an age threshold, explicit confirmation, and a minimum-recovery-point guard |
| `notify-backup-failure.sh` | Sends a minimal Discord-compatible webhook alert without including secrets or backup URLs |
| `check-backup-freshness.sh` | Fails when no locally checksum-valid and remotely matching archive/checksum pair is newer than the configured maximum age |
| `create-secret-recovery-package.sh` | Creates a confirmation-gated, `age`-encrypted package of allowlisted application/infrastructure secrets for transfer to a separate recovery vault |
| `backup-paris-database-windows.ps1` | Creates an encrypted Paris database-only snapshot on the secured Windows recovery PC |
| `test-paris-database-backup-windows.ps1` | Restores the database-only snapshot into disposable PostgreSQL 17 |
| `quest-esports-backup.env.example` | Production backup environment template |
| `quest-esports-recovery.env.example` | Isolated recovery environment template |
| `systemd/quest-esports-backup.service` | Restricted oneshot service running as `deploy` |
| `systemd/quest-esports-backup.timer` | Persistent daily schedule at 02:15 UTC plus randomized delay |
| `systemd/quest-esports-backup-failure@.service` | Restricted `OnFailure` notification service; requires an approved webhook in the protected environment file |
| `systemd/quest-esports-backup-freshness.service` | Restricted freshness probe that alerts through the same failure notifier |
| `systemd/quest-esports-backup-freshness.timer` | Persistent daily freshness check at 05:00 UTC plus randomized delay |

Never commit a filled environment file, archive, checksum, database dump, rclone configuration, OAuth credential, or private `age` identity. Never use the production database or live upload paths for a restore drill.
