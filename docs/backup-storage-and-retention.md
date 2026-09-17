# Backup Storage and Retention

What Quest keeps on Google Drive, the retention policy the owner approved on
2026-09-17, how to apply it safely, and a recovery drill that has been run
against the Drive copies. For key custody, the canonical archive format, and
intentional production restores, see
[Backup and Disaster Recovery](./backup-and-disaster-recovery.md).

## Inventory on 2026-09-17

Remote `quest-backups-custom:quest-esports-v2/production` (the only
`BACKUP_RCLONE_REMOTE` in `/etc/quest-esports-backup.env`). The remote is a free
15 GiB Google account with the `drive.file` scope, so the token can only see
files it created itself.

| Family | Name pattern | Produced by | Pairs | Size | Span |
| --- | --- | --- | --- | --- | --- |
| database | `quest-pg17-*.dump.age` | `quest-pg17-interim-backup.timer` (daily ~02:45 UTC), plus ad-hoc runs before releases | 36 | 0.04 GiB | 2026-08-30 to now |
| media | `quest-media-*.tar.gz.age` | `quest-media-interim-backup.timer` (daily ~03:15 UTC) | 17 | 2.36 GiB | 2026-09-03 to now |
| release | `quest-production-*.tar.gz.enc` | `ops/backup-production-multi-remote.sh`, run by hand for each migration release; the old daily canonical timer ran before the cutover | 74 | 8.25 GiB | 2026-07-29 to now |
| cutover | `quest-adoption-<sha>-*`, `quest-legacy-media-*` | One-off runs during the 2026-08-27 and 2026-09-03 cutover | 5 | 0.28 GiB | 2026-08-27 to 2026-09-03 |

Totals: 132 archive + `.sha256` pairs, 10.93 GiB. `rclone about` reported
11.13 GiB used, 3.82 GiB free, 0 B in trash. About 0.2 GiB of Drive usage is not
visible to this token (see [Open items](#open-items)).

Checks run that day:

- **No orphans or duplicates.** Every archive has its checksum and every
  checksum has its archive. Drive allows duplicate names, but none exist.
- **Integrity.** Every archive was streamed from Drive and hashed against its
  sidecar. One pair first reported a mismatch; its Drive MD5 matched the local
  copy and the local SHA-256 matched the sidecar, so it was a transient stream
  error, not corruption. Retry any mismatch before concluding an archive is bad.
- **Job history since the journal starts (2026-09-01).** The interim database
  and media jobs have not failed once. The interim freshness check failed twice
  on 2026-09-04 and has passed every run since. The canonical
  `quest-esports-backup.timer` failed on 2026-09-01 to 09-04, before it was
  deliberately disabled.
- **Local staging** (`/srv/quest-esports/backups`, 2.7 GiB of a 145 GiB disk).
  The seven-day local prune works for all three running families. The two
  cutover families match no local prune rule, so they stay until removed by hand
  (about 290 MB).
- **Alerting.** `BACKUP_FAILURE_WEBHOOK_URL` is set, and the
  `quest-esports-backup-failure@` notifier delivered alerts on 2026-09-04.

### Why retention became urgent

Nothing had ever pruned Drive. Growth is about 245 MB/day: media ~156 MB/day and
rising with uploads, release archives ~87 MB/day on average (about one 157 MB
archive every two days), and database dumps ~1.4 MB/day. At that rate the 3.8 GiB
of headroom runs out around **2026-10-02**. After that, every backup upload fails
(the interim scripts exit on the failed `rclone copy`), and so does every
migration release, because `ops/deploy/verify-backup-evidence.sh` requires a
fresh off-site archive.

The old example value `BACKUP_REMOTE_RETENTION_DAYS=90` never fit: 90 days of
media alone is about 14 GiB. The old tool also only understood
`quest-production-*`, and it deleted into Drive trash, which does not release
quota for 30 days.

## Approved policy

Approved by the owner on 2026-09-17. `ops/prune-production-backups.sh` applies it
to every configured remote independently.

| Family | Kept | Steady-state size |
| --- | --- | --- |
| database | Every dump younger than 35 days, then the newest dump of each ISO week until 90 days | < 0.1 GiB |
| media | The newest archive of each of the 7 most recent days that have one, plus the newest of each of the 4 most recent ISO weeks | ~1.8 GiB |
| release | Every archive younger than 14 days, plus the archives named by the 3 newest signed restore rehearsals under `/secure/recovery/rehearsal-evidence*` | ~1.2 GiB |
| cutover | Only while pinned | 0.28 GiB until 2026-12-02 |
| every family except cutover | The newest `BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS` (3) pairs, whatever their age | — |

Pinned until **2026-12-02** (90 days after the PostgreSQL 17 cutover): the last
pre-cutover canonical archive `quest-production-20260903T165638Z`, the final
adoption pair `quest-adoption-1c4ccda…-20260903T112030Z` (dump and media), and
`quest-legacy-media-20260827T191544Z`. After that date they fall under their
family rules, which deletes them. All other pre-cutover (Supabase-era) release
archives are removed.

Rules the tool enforces:

- Dates come from the UTC timestamp in the archive name, not Drive's modification
  time, so a re-upload never makes an old recovery point look new.
- A pair is only deleted whole: archive first, then checksum. An archive without
  a checksum, a checksum without an archive, and any unrecognised name are
  reported and left alone.
- Evidence is read only from `rehearsal-evidence*` directories. A staged copy
  under `rehearsal-archive/` does not protect anything. If the evidence root
  cannot be read, the tool refuses to run instead of silently protecting nothing,
  which is why it runs as root.
- It refuses if the retired `BACKUP_REMOTE_RETENTION_DAYS` is still set, so an
  old configuration cannot be applied by mistake.

The first dry run against production (2026-09-17, 3.9 s) chose to delete 75 pairs
(8.17 GiB) and keep 57 pairs (about 2.8 GiB):

```text
database pairs=36  keep=36  delete=0   frees=0.00 GiB of 0.04 GiB
media    pairs=17  keep=8   delete=9   frees=1.20 GiB of 2.36 GiB
release  pairs=74  keep=10  delete=64  frees=6.84 GiB of 8.25 GiB
cutover  pairs=5   keep=3   delete=2   frees=0.13 GiB of 0.28 GiB
```

## Applying retention

The policy settings are in `ops/quest-esports-backup.env.example` and must be
copied into `/etc/quest-esports-backup.env` before the first run. Every step
holds the shared release lock, so it cannot race a backup or a release.

1. **Dry run.** Read every `Would delete` line. Each `Would keep` line gives its
   reasons (`pinned`, `rehearsal-bound`, `minimum-recovery-point`,
   `database-recent`, and so on).

   ```bash
   sudo env BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
     bash /var/www/QuestEsports/ops/prune-production-backups.sh
   ```

2. **Move expired pairs to trash.** This is still reversible from the Drive UI
   for 30 days.

   ```bash
   sudo env BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
     RETENTION_CONFIRMATION=PRUNE_QUEST_PRODUCTION \
     bash /var/www/QuestEsports/ops/prune-production-backups.sh
   ```

3. **Verify what remains.** Run the dry run again; it must report `delete=0` for
   every family. Then run [the recovery drill](#recovery-drill-from-drive) on the
   newest database and media archives, and confirm
   `quest-pg17-interim-freshness.service` still passes.

4. **Release the quota.** This permanently removes only trashed objects whose
   names are backup archives or checksums and that are no longer live. It never
   removes a trashed checksum whose archive is still live.

   ```bash
   sudo env BACKUP_ENV_FILE=/etc/quest-esports-backup.env \
     TRASH_CONFIRMATION=EMPTY_QUEST_BACKUP_TRASH \
     bash /var/www/QuestEsports/ops/prune-production-backups.sh
   ```

5. Record `rclone about` before and after in the operations log.

The host checkout at `/var/www/QuestEsports` does not update itself (root
cannot fetch its SSH origin), so copy the reviewed script in before the first
run.

## Recovery drill from Drive

`ops/rehearsal/drive-restore-drill.sh` proves a Drive copy can be restored
without touching production. It downloads from the remote rather than using local
staging, because a VPS loss takes local staging with it.

- `database` restores a `quest-pg17-*.dump.age` into a throwaway PostgreSQL
  container with no network, using the same image as production. It then
  compares every table's row count and the Prisma migration ledger with live.
- `media` decrypts a `quest-media-*.tar.gz.age` and lists it to the end of the
  stream in memory. It then compares public and private file counts and byte
  totals with live.

The age identity is streamed over SSH stdin and held only in memory. The script
refuses an identity that does not match `BACKUP_AGE_RECIPIENT`, and removes the
container and its volume on exit.

```bash
drill="$(base64 -w0 ops/rehearsal/drive-restore-drill.sh)"
ssh quest-vps "bash -c \"\$(echo $drill | base64 -d)\" drill database quest-pg17-YYYYMMDDTHHMMSSZ.dump.age" \
  < ~/.config/quest-esports/recovery/quest-esports-backup-age-key.txt
ssh quest-vps "bash -c \"\$(echo $drill | base64 -d)\" drill media quest-media-YYYYMMDDTHHMMSSZ.tar.gz.age" \
  < ~/.config/quest-esports/recovery/quest-esports-backup-age-key.txt
```

Results on 2026-09-17:

| Drill | Archive | Result |
| --- | --- | --- |
| database | `quest-pg17-20260917T024858Z.dump.age` | Checksum OK; restored in 20–27 s; migrations 85/87 on both sides; 100 of 104 tables identical. The other 4 (`audit_logs`, `sessions`, `staff_roles`, `user_staff_roles`) had writes after the dump |
| media | `quest-media-20260917T031609Z.tar.gz.age` | Checksum OK; manifest present; `uploads` 434 files / 158,783,733 bytes and `private` 22 files / 5,047,034 bytes, identical to live |
| identity guard | wrong key | Refused before downloading anything |

Repeat both drills after every retention run that deletes something, and at
least monthly.

### Recovering for real

1. Pick the recovery point. For a mistaken data change, use the newest database
   dump from before the change (dumps are kept for every day of the last 35).
   For host loss, take the newest database dump and the newest media archive.
   A migration release also has a `quest-production-*` archive bound to that
   release.
2. Run the drill on the chosen archives first. A drill that fails means that
   archive is not the recovery point.
3. For a partial repair, such as one table or a few rows, restore into the
   drill container and copy out only what is needed. That is how a removed
   leaderboard row was restored on 2026-09-14.
4. For a full restore, follow the post-first-write Compose recovery in
   [Backup and Disaster Recovery](./backup-and-disaster-recovery.md). It needs
   an incident decision and maintenance mode, because it replaces the database
   and both upload trees.

## Open items

- **Pruning is manual.** Once one full apply-and-verify cycle has passed, add a
  weekly timer for the dry run and the trash step. Keep the empty-trash step
  manual until the tool has run clean a few times.
- **No quota alarm.** Freshness checks confirm the newest pair is off-site but
  not how much space is left. A check that fails below about 2 GiB free would
  have flagged this weeks in advance.
- **Unseen Drive usage.** About 0.2 GiB of Drive usage is invisible to the
  `drive.file` token. The rclone config also holds a second remote,
  `quest-backups:`, whose token is revoked (`invalid_grant`); nothing on the host
  references it. Check the Drive web UI for files that remote created, then
  remove the dead remote entry.
- **Freshness log noise.** `quest-pg17-interim-freshness.service` logs
  `Failed to save config … read-only file system` on every run, because
  `ReadOnlyPaths` blocks rclone from saving its refreshed token. It is harmless
  while the backup jobs save the token daily, but it buries real errors.
- **Key custody.** The only known copy of the age identity is on one workstation
  (`~/.config/quest-esports/recovery/`). The recovery doc calls for at least two
  controlled offline copies.
- **Host-only scripts.** The three interim scripts under `/usr/local/sbin` (the
  database, media, and freshness jobs) are not in this repository.
- **Local cutover leftovers.** The Sep 3 `quest-adoption-*` pairs and the Aug 27
  `quest-legacy-media-*` pair in `/srv/quest-esports/backups` (about 290 MB)
  match no local prune rule. Remove them by hand once their Drive pins expire.
