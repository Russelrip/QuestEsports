# VALORANT backend map

This directory is the monorepo home of the VALORANT FastAPI service formerly
maintained in `Russelrip/valorant-platform-backend`.

- `app/` contains the HTTPS API, database access, rating logic, and service
  authentication.
- `workers/` contains the updater, Discord bot, and scheduled name-audit
  processes. They share the same immutable image as the API. The updater also
  runs the leaderboard server check (`workers/server_check.py`): once a day per
  player it records the servers of their recent competitive matches (0018), and
  `app/domain/leaderboard/server_check.py` flags from them at read time.
- `supabase/migrations/` owns only the PostgreSQL `valorant` schema and its
  `_migration_ledger`; it must not reference Quest's `public` schema.
- Leaderboard bans (0019) name a PUUID and/or Discord id. Registration
  (`app/services/registration_service.py`) and restore refuse either while a ban
  is active; banning removes what either holds. A shared/exclusive advisory lock
  (`LEADERBOARD_BAN_LOCK_KEY`) keeps a ban and a registration from interleaving.
- Hidden players (0020) stay registered but are left off the public board, its
  search and its stats (`_LEADERBOARD_FILTERS` / `is_listed` in
  `app/db/repositories/leaderboard_player_repository.py`). The updater and
  Discord bot still see them; a removal copy and a repoint carry the hide.
- `scripts/` contains migration, runtime-access, and release-image validators.
- `tests/` contains non-live API, database, worker, security, and rating tests.
- `Dockerfile` builds the single runtime image from this directory.
- `docker-compose.production.yml` is kept byte-equivalent to
  `ops/docker/valorant.production.compose.yml`, which is the production release
  contract installed on the VPS.

The root `CI` workflow validates this code against PostgreSQL 17. After CI on
`main`, `build-container-images.yml` builds, publishes, signs, and attests the
VALORANT image as `ghcr.io/Russelrip/quest-valorant-backend` together with the
Quest images. The resulting digest is included in the same release manifest and
deployed by the shared Compose controller. The distinct package name prevents
the archived standalone repository's GHCR permissions from controlling
monorepo releases.


Production configuration fails closed before startup. Health performs a DB read,
checks required configuration and verifies a Quest-signed service token without
writes. The release controller admits workers only after sustained liveness.
Discord reconciliation mutates only explicit rank/Unverified roles, preserves
unrelated roles, and skips bots and Manual members before nickname/role changes.
