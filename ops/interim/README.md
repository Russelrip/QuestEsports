# Interim backup jobs

These are the jobs that actually produce Quest's daily backups on the production
host. They were installed by hand during the 2026-09 PostgreSQL 17 cutover and
lived only on the host until 2026-09-17. This directory is the reviewed record of
what is installed; the canonical `quest-esports-backup.timer` stays disabled
(see [Backup and Disaster Recovery](../../docs/backup-and-disaster-recovery.md)).

| File | Installed at | What it does |
| --- | --- | --- |
| `quest-pg17-backup.sh` | `/usr/local/sbin/` (root 0700) | `pg_dump -Fc` from `quest-prod-postgres-1`, age-encrypts it, writes a checksum, uploads both, and prunes local copies after `BACKUP_LOCAL_RETENTION_DAYS` |
| `quest-pg17-interim-backup.{service,timer}` and `quest-pg17-interim-backup.service.d-alert.conf` | `/etc/systemd/system/` (the drop-in goes in `quest-pg17-interim-backup.service.d/alert.conf`) | Daily at 02:40 UTC plus up to 10 minutes; the drop-in adds the failure alert |
| `quest-media-interim-backup.sh` | `/usr/local/sbin/` (root 0700) | Two-pass copy of both upload roots under the release lock, age-encrypted tar, checksum, upload, `rclone check`, local prune |
| `quest-media-interim-backup.{service,timer}` | `/etc/systemd/system/` | Daily at 03:10 UTC plus up to 10 minutes |
| `quest-pg17-interim-freshness.sh` | `/usr/local/sbin/` (root 0700) | Fails unless the newest database and media pairs are under 36 hours old, match their checksums, and match the remote |
| `quest-pg17-interim-freshness.{service,timer}` | `/etc/systemd/system/` | Every six hours at :20 UTC |

Off-site retention and the quota alarm for the same remote are
`ops/prune-production-backups.sh` and `ops/check-backup-remote-quota.sh`; see
[Backup Storage and Retention](../../docs/backup-storage-and-retention.md).

To change a job, edit it here, get it reviewed, then install it:

```bash
sudo install -m 0700 -o root -g root ops/interim/<script>.sh /usr/local/sbin/
sudo install -m 0644 -o root -g root ops/interim/<unit> /etc/systemd/system/
sudo systemctl daemon-reload
```

Check that the destination is not a masked unit (a symlink to `/dev/null`)
first, and start the freshness service afterwards to confirm the change.
