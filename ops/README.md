# Production Operations Scripts

These scripts support encrypted backup and recovery for Quest Esports production. The complete safety procedure is in [Backup and Disaster Recovery](../docs/backup-and-disaster-recovery.md).

| File | Purpose |
| --- | --- |
| `backup-production.sh` | Dumps the application `public` schema, packages both upload roots, encrypts with `age`, uploads with rclone, verifies both remote objects, and prunes old local encrypted files |
| `restore-production-backup.sh` | Checksum-verifies, decrypts, restores PostgreSQL, and synchronizes both upload roots; destructive and confirmation-gated |
| `backup-paris-database-windows.ps1` | Creates an encrypted Paris database-only snapshot on the secured Windows recovery PC |
| `test-paris-database-backup-windows.ps1` | Restores the database-only snapshot into disposable PostgreSQL 17 |
| `quest-esports-backup.env.example` | Production backup environment template |
| `quest-esports-recovery.env.example` | Isolated recovery environment template |
| `systemd/quest-esports-backup.service` | Restricted oneshot service running as `deploy` |
| `systemd/quest-esports-backup.timer` | Persistent daily schedule at 02:15 UTC plus randomized delay |

Never commit a filled environment file, archive, checksum, database dump, rclone configuration, OAuth credential, or private `age` identity. Never use the production database or live upload paths for a restore drill.
