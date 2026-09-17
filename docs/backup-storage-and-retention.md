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

### First application (2026-09-17)

| Step | Time (UTC) | Result |
| --- | --- | --- |
| Integrity sweep of all 132 Drive archives | from 03:19, finished during the trash run | 131 OK; 1 transient stream error on a pair later proven intact |
| Fresh dry run | 03:51 | Delete and keep sets identical to the reviewed list |
| Trash (`RETENTION_CONFIRMATION`) | 03:51–03:59 | Exit 0; trash holds exactly the 75 approved pairs (150 objects, 8.171 GiB); live holds exactly the 57 kept pairs |
| Second dry run | after trash | `delete=0` for every family |
| `quest-pg17-interim-freshness.service` | after trash | `Result=success`; newest database and media pairs fresh and off-site |
| Drills from Drive | after trash | Database and media drills passed as below; pinned `20260903T165638Z` checksum OK |
| Empty trash (`TRASH_CONFIRMATION`) | 04:02–04:08 | Trash re-checked first (still exactly the 75 pairs); exit 0, 150 objects (8.17 GiB) permanently removed |
| Afterwards | after emptying | `rclone about`: Used **2.96 GiB**, Free **11.99 GiB**, Trashed 0 B; 114 live objects (2.76 GiB); freshness `Result=success` |

`verify-backup-evidence.sh` was not re-run end to end: it refuses before reading
the remote because the age identity is only on the host during a gated release.
The archive it binds for the current migration release
(`quest-production-20260917T012243Z`) is live and rehearsal-bound.

At the steady state the policy targets, Drive holds about 3–3.5 GiB of live
backups plus at most one week of trashed pairs.

## Applying retention

### Automatically

`quest-esports-backup-retention.timer` runs every Sunday at 04:30 UTC (plus up to
15 minutes). The service runs as root and does two steps in this order:

1. Empty the trash: permanently remove the backup pairs the previous run moved
   to trash.
2. Move newly expired pairs to trash.

So every pruned pair spends a week in Drive trash, where it can be restored from
the Drive web UI, before it is gone for good. Trash never holds more than one
week of deletions against the quota. A failure in either step stops the run and
alerts through `quest-esports-backup-failure@`.

The empty step removes **every** trashed object whose name is a backup archive
or checksum and that is not live, including one a person trashed by hand in the
Drive UI. To keep a trashed pair, restore it before Sunday.

Install, or reinstall after changing either unit:

```bash
sudo install -m 0644 ops/systemd/quest-esports-backup-retention.service \
  ops/systemd/quest-esports-backup-retention.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now quest-esports-backup-retention.timer
```

Check the destinations are not masked first (`ls -l /etc/systemd/system/quest-esports-backup-retention.*`);
a masked unit is a symlink to `/dev/null`.

### By hand

The policy settings are in `ops/quest-esports-backup.env.example` and live in
`/etc/quest-esports-backup.env` on the host. Every step holds the shared release
lock, so it cannot race a backup or a release. Use the manual sequence after a
policy change, or when a run needs to be watched step by step.

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

## Quota alarm

`quest-esports-backup-quota.timer` runs `ops/check-backup-remote-quota.sh` daily
at 05:15 UTC, after the nightly uploads. It asks each remote how much space the
account has left and fails when any remote is below `BACKUP_REMOTE_MIN_FREE_GIB`
(2 GiB). The failure alerts through `quest-esports-backup-failure@`. It also
fails if a remote cannot be read, or does not report free space at all, rather
than passing silently.

The threshold is read from `/etc/quest-esports-backup.env`, which overrides the
environment of the command that calls the script. To try a different threshold
by hand, point `BACKUP_ENV_FILE` at a file that sources the real one and then
sets the value.

Installed and first run on 2026-09-17: 11.99 GiB free of 15.00 GiB. The first
test run used a parser that could not read rclone's pretty-printed JSON. It
failed, and **the notifier sent one false "backup unit failed" alert for
`quest-esports-backup-quota.service`**. The parser was fixed, and the test
fixture now emits rclone's real output shape.

## Cleanup on 2026-09-17

- The unused `quest-backups:` remote (revoked token, referenced nowhere) was
  removed from the rclone config. A root-only copy of the previous config is at
  `/root/rclone-quest-esports.conf.bak-20260917`.
- `quest-pg17-interim-freshness.service` can now write the rclone config
  directory, so rclone can save its refreshed token. That clears the
  `Failed to save config` noise it logged on every run. The previous unit is at
  `/root/quest-pg17-interim-freshness.service.bak-20260917`.
- The three interim jobs and their units are now in the repository under
  [`ops/interim/`](../ops/interim/README.md).
- The superseded local adoption pair `quest-adoption-…-20260903T111422Z` was
  removed from `/srv/quest-esports/backups`; its Drive copy had already been
  pruned under the policy.

## Open items

- **Unseen Drive usage.** About 0.2 GiB of Drive usage is invisible to the
  `drive.file` token, which can only see files it created. Check the Drive web UI
  for files created by other means, such as the removed `quest-backups:` remote
  or manual uploads. Only someone signed in to the account can see them.
- **Key custody.** The only known copy of the age identity is on one workstation
  (`~/.config/quest-esports/recovery/`). The recovery doc calls for at least two
  controlled offline copies.
- **Pinned local copies.** The `quest-adoption-…-20260903T112030Z` pair and the
  `quest-legacy-media-20260827T191544Z` pair (155 MB) stay in
  `/srv/quest-esports/backups` as second copies of the Drive pins. No local prune
  rule matches them, so remove them by hand after 2026-12-02.
