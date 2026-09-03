# VALORANT backend map

This directory is the monorepo home of the VALORANT FastAPI service formerly
maintained in `Russelrip/valorant-platform-backend`.

- `app/` contains the HTTPS API, database access, rating logic, and service
  authentication.
- `workers/` contains the updater, Discord bot, and scheduled name-audit
  processes. They share the same immutable image as the API.
- `supabase/migrations/` owns only the PostgreSQL `valorant` schema and its
  `_migration_ledger`; it must not reference Quest's `public` schema.
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
