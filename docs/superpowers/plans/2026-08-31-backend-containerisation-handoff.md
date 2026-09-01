# Backend containerisation — handoff context

**Date:** 2026-08-31
**Written by:** the session that executed the database cutover
**For:** whoever picks up Phase 1/2 (frontend + backend into Compose)

The database half of Phase 3 was executed on 2026-08-31, **ahead of Phases 1
and 2**. The cutover is complete: VPS PostgreSQL 17 in `quest-postgres` is the
current database authority for Quest and VALORANT, while immutable Compose is
the repository's current production deployment authority. Supabase is stale
staging/recovery material only, not a rollback target. No rehearsal was
performed, and unavailable live VPS, hosted GitHub, registry, and Linux-only
checks remain unverified. This document records the resulting host state,
because it is not yet the state `ops/docker/compose.production.yml` expects.

---

## Current host state after the 2026-08-31 database cutover

`vmi3324499` / `api.questesports.lk` — Ubuntu 24.04.4, 4 vCPU, 7.8 GB RAM,
145 GB disk (9% used), **no swap**.

### What runs where

| Component | How it runs | Where |
|---|---|---|
| PostgreSQL 17.11 | ad-hoc `docker run`, **not** Compose-managed | container `quest-postgres` |
| Quest backend | PM2, host process | `0.0.0.0:5001` |
| VALORANT API | systemd + uvicorn, host process | `127.0.0.1:8000` |
| VALORANT updater / bot | systemd, host processes | — |
| Frontend | still Vercel | — |
| Nginx + Certbot | host | `:80`, `:443` |

### Database

```
container  quest-postgres
image      postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0
data       /srv/quest-esports/postgres/17/data   (uid/gid 999, mode 700)
published  127.0.0.1:5433 -> 5432
networks   quest-db-net (bridge, routable)
           quest-database (internal, created then abandoned — see gotchas)
database   quest
roles      quest_runtime (owns public), val_runtime (owns valorant)
contents   public 86 tables / 1700 rows · valorant 11 tables / 512 rows
TLS        NONE — server has no certificates configured
```

Quest and VALORANT use this PostgreSQL 17.11 instance through
`127.0.0.1:5433`. Supabase remains intact but stale and is not a rollback
target. No rehearsal was performed; the hard rehearsal gate was skipped and
cannot be satisfied retroactively.

### Runtime configuration

```
/etc/quest-esports/postgres.env      600 root:root   POSTGRES_{PASSWORD,USER,DB}
/etc/quest-esports/quest-db.env      600 root:root   QUEST_DATABASE_URL
/etc/quest-esports/valorant-db.env   600 root:root   VAL_DATABASE_URL (asyncpg form)
/etc/quest-esports-backup.env        640 root:deploy (deploy must read it — see gotchas)
```

Application env:

- `/var/www/QuestEsports/backend/.env` — `DATABASE_URL` and `DIRECT_URL` both
  point at `postgresql://quest_runtime@127.0.0.1:5433/quest?sslmode=disable`
- `/var/www/valorant-platform-backend/.env` — `DATABASE_URL` is
  `postgresql+asyncpg://val_runtime@127.0.0.1:5433/quest`
- Pre-cutover copies preserved as `.env.pre-pg17-<stamp>` in both directories

---

## Current provisioning contract for Compose and backup follow-up

The following are current post-cutover provisioning requirements, not evidence
that database authority is still pending: `POSTGRES_COMPOSE_CA_FILE`,
`POSTGRES_COMPOSE_CERT_FILE`, `POSTGRES_COMPOSE_KEY_FILE`, `POSTGRES_CA_FILE`,
`BACKUP_CLIENT_CERT_FILE`, `BACKUP_CLIENT_KEY_FILE`, `BACKUP_CLIENT_TLS_DIR`,
and the `POSTGRES_TARGET_*` settings. The active backup trust-bundle variable is
`POSTGRES_CA_FILE`; `BACKUP_CLIENT_CA_FILE` is not part of the contract. These
requirements unblock Compose adoption and the real backup pipeline.

## Historical pre-Compose gap snapshot (superseded; not a pending cutover)

`ops/docker/compose.production.yml` declares:

```yaml
postgres:
  user: "999:999"
  command:
    - ssl=on
    - ssl_ca_file=/run/postgresql/tls/ca.crt
    - ssl_cert_file=/run/postgresql/tls/server.crt
    - ssl_key_file=/run/postgresql/tls/server.key
```

At the handoff timestamp, the running database had **no TLS**, was **not**
Compose-managed, and published a host port the target topology forbids. The
following list is preserved historical missing-state evidence; it is not a
claim that the 2026-08-31 authority cutover did not occur:

```
POSTGRES_COMPOSE_{CA,CERT,KEY}_FILE
POSTGRES_CA_FILE, BACKUP_CLIENT_CERT_FILE, BACKUP_CLIENT_KEY_FILE
BACKUP_CLIENT_TLS_DIR
POSTGRES_TARGET_{HOST,PORT,DATABASE,MAJOR,DATA_ROOT,SENTINEL_COMMAND}
POSTGRES_IMAGE_APPROVED_REF
```

External PostgreSQL/VALORANT Cosign signer settings are not required. The
official PostgreSQL image is trusted by the exact approved digest, and Quest
frontend/backend/migrator images use Quest-only Cosign verification.

**The same missing TLS material blocked the backup pipeline at that time.**
`ops/backup-production.sh` execs `backup-production-multi-remote.sh`, which
requires `POSTGRES_CA_FILE`, `BACKUP_CLIENT_CERT_FILE`, and
`BACKUP_CLIENT_KEY_FILE`. The scheduled
backup has failed since **2026-08-30 04:20** for this reason. Provisioning the
certificates unblocks the backup job and the backend containerisation together
— they are one piece of work, not two.

### CI status

- `build-container-images.yml` — last run **success**, 2026-08-29 05:10
- At that historical snapshot, `deploy-compose.yml` had only ever **skipped**;
  no Compose deployment had occurred then. This does not undo the completed
  2026-08-31 database cutover.

Images existed. Host provisioning was what was missing at that historical
snapshot; the remaining provisioning work is post-cutover Compose adoption.

---

## Suggested order

1. **Provision TLS** under `/etc/quest-esports/tls` — CA, a server cert for
   `quest-postgres`, and client certs for the backup identity. In Compose, the
   PostgreSQL service is named `postgres` and carries the `quest-postgres`
   network alias, so Compose-network runtime verification uses
   `quest-postgres`. Use `127.0.0.1` only for host-side loopback access or the
   temporary loopback staging overlay where applicable. Populate the
   `POSTGRES_TARGET_*` and `BACKUP_CLIENT_*` settings.
2. **Prove it against the backup job first.** `systemctl start
   quest-esports-backup.service` is restartable and does not affect serving
   traffic. Getting a green run there validates the certificate contract before
   anything touches the live API.
3. **Adopt the already-authoritative PostgreSQL 17 service into Compose** with
   `ssl=on`. This is container-management adoption, not a database-authority
   cutover. The data directory is a bind mount, so recreating the container
   preserves the database. Drop the published `127.0.0.1:5433` at the same
   time.
4. **Bring up the backend** from the release manifest, verify
   `/api/health/ready`, repoint nginx from `127.0.0.1:5001`, then retire PM2.
5. **Frontend last** — it is still on Vercel and independent.

### Deviations that must retire in step 3/4

- Published `127.0.0.1:5433` — exists only because the backend and VALORANT are
  host processes and cannot reach a Docker network.
- `sslmode=disable` on both runtime URLs — justified only by the loopback bind.
- The interim backup unit `quest-pg17-interim-backup.{service,timer}`
  (`/usr/local/sbin/quest-pg17-backup.sh`) — remove once the multi-remote
  pipeline runs.

### VALORANT coordination

`val_runtime`'s URL is asyncpg-form and uses `ssl=require`; full certificate and
hostname verification are supplied separately through
`VALORANT_DATABASE_SSL_CA_FILE`, `VALORANT_DATABASE_SSL_SERVER_HOSTNAME`, and
`VALORANT_DATABASE_SSL_VERIFY=full`. It is a separate repository at
`/var/www/valorant-platform-backend` with three systemd units. It must move in
the same operation as Quest.

---

## Gotchas discovered the hard way

- **An `--internal` Docker network silently ignores `-p`.** Docker accepts the
  flag, records `PortBindings`, and never applies it — no error, no warning.
  `quest-database` was created internal for this reason and abandoned in favour
  of `quest-db-net`. Any Compose topology combining `internal: true` with a
  published port will fail the same way.
- **`pg_restore -n <schema>` does not create the schema.** The `CREATE SCHEMA`
  entry is not tagged as belonging to it and gets filtered out. Create the
  schema explicitly first, with the correct `AUTHORIZATION`.
- **Host `pg_dump` is 16.15 while `psql` is 18.6.** A version-16 client refuses
  to dump the 17.6 source outright. Always run dump/restore from the pinned
  image, never from the host `PATH`.
- **`/etc/quest-esports-backup.env` must be `root:deploy 0640`.** The unit runs
  as `User=deploy`. Setting it `600` produces `Backup configuration is not
  readable`.
- **The canonical release lock needs both halves.** `/etc/tmpfiles.d/` creates
  `/var/lock/quest-esports-release.lock`, and the unit's `ReadWritePaths` must
  list it, because `ProtectSystem=strict` makes everything else read-only. Both
  are now installed; the failure mode was `Read-only file system`.
- **`MFA_ISSUER` in Quest's `.env` is unquoted and contains a space.** dotenv
  parses it fine; `bash` sourcing does not, printing
  `Esports: command not found`. Do not "fix" it with a naive regex — `\s`
  matches newlines in Python and will swallow following lines. Doing exactly
  that destroyed `AUTH_ENCRYPTION_KEY` and took the API down for ~5 minutes.

---

## Outstanding host issues

- **`/etc/sudoers.d/quest-deploy-bootstrap` grants `deploy ALL=(ALL) NOPASSWD: ALL`.**
  `deploy`'s `authorized_keys` contains two GitHub Actions keys, so CI currently
  holds unrestricted root on the production host. This is the `docker`-group
  problem the spec's *Privileged access* section warns about, in a stronger
  form. Narrow it to the single release script before production.
- **`/etc/sudoers.d/russel-bootstrap`** — temporary grant for the cutover.
  Remove when no longer needed.
- **No swap** on a 7.8 GB host about to gain two more containers.
- **`api.valorantsl.com` has no TLS** — zero `ssl_certificate` directives.
- **`/srv/quest-esports/migration/`** holds plaintext dumps including a full
  Supabase dump (`supabase-preswitch-*.dump`). Delete once the new database is
  trusted.
- **Supabase is intact but stale.** It stops being a rollback target as writes
  accumulate on PostgreSQL 17.
