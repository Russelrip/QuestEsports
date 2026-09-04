# CI/CD

QuestEsports uses one production delivery path: immutable Docker images deployed
with Docker Compose on the Quest VPS. PM2 backend deployment and Vercel frontend
promotion are retired and are not represented by active workflows.

## Production flow

```text
push to main
  -> CI + secret scan
  -> build, sign, and attest four application images
  -> resolve the exact successful CI/build lineage
  -> production-compose approval
  -> verify manifest, signatures, attestations, and host policy
  -> deploy the complete Compose release
  -> publish compose-release-success evidence
```

A release always promotes one full 40-character commit SHA. The frontend, Quest
backend, Quest migrator, and VALORANT backend image references are recorded by
digest in a single release manifest. PostgreSQL is not built by this repository;
its exact approved upstream digest remains pinned in repository/environment
configuration and in the host release policy.

## Active workflows

| Workflow | Trigger | Responsibility |
| --- | --- | --- |
| `CI` | Pull requests and pushes to `main` | Tests the frontend, Quest backend, VALORANT backend, deployment contracts, and repository policy. |
| `Secret scan` | Pull requests and pushes | Rejects committed credentials and secret-like material. |
| `Build container images` | Successful `CI` push run on `main` | Builds, pushes, signs, and attests the frontend, backend, migrator, and VALORANT images; emits the immutable manifest. |
| `Deploy immutable Compose release` | Successful image build or owner dispatch from `main` | Verifies the complete upstream lineage and deploys the manifest to the VPS. |
| `VALORANT E2E (protected)` | Owner-only manual dispatch | Runs the two-service E2E suite from the monorepo at the exact current `main` SHA. |
| `Release Admin APK` | Its configured release trigger | Produces the Android admin application release. |

The workflows are in [`.github/workflows`](../.github/workflows). All third-party
actions are pinned to full commit SHAs. Production workflows use least-privilege
permissions and do not persist checkout credentials.

## CI

`CI` is required before images can be built. In addition to application tests it
asserts the deployment architecture itself:

- Compose is the only production workflow.
- A deployment can select only the current successful build or an explicit
  `rollback_sha`.
- Build and deploy runs must originate from this repository, `main`, and the
  same exact commit.
- Every application image has an immutable digest, a keyless Cosign signature,
  BuildKit provenance, and an SBOM attestation.
- The VALORANT E2E job uses `valorant-platform-backend/` in this monorepo and
  cannot use an external checkout token.

Pull-request CI never receives production deployment secrets.

## Image build and manifest

After a successful push CI run on `main`, `build-container-images.yml` builds:

- `ghcr.io/russelrip/quest-frontend`
- `ghcr.io/russelrip/quest-backend`
- `ghcr.io/russelrip/quest-migrator`
- `ghcr.io/russelrip/quest-valorant-backend`

The images are tagged by commit SHA, but deployment uses only their digest-pinned
references. The builder creates maximum-mode provenance and an SBOM, then signs
each image with GitHub Actions OIDC. The manifest artifact name binds the
upstream CI run ID and release SHA.

The build environment is `container-image-build`. It requires these variables:

| Variable | Purpose |
| --- | --- |
| `PRODUCTION_API_URL` | Public HTTPS API URL embedded in the frontend build. |
| `PRODUCTION_SITE_URL` | Public HTTPS site URL embedded in the frontend build. |
| `POSTGRES_17_BOOKWORM_DIGEST` | Approved PostgreSQL 17 Bookworm digest. |
| `POSTGRES_IMAGE_APPROVED_REF` | Exact approved `postgres:17-bookworm@sha256:...` reference. |

## Production deployment

`deploy-compose.yml` is enabled only when both of these repository variables are
set:

```text
PRODUCTION_DEPLOYMENT_MODE=compose
COMPOSE_DEPLOY_ENABLED=true
```

The actor must be the repository owner. The deploy job uses the protected
`production-compose` environment, whose reviewer and `main` branch policy form
the human production gate.

Required `production-compose` secrets:

| Secret | Purpose |
| --- | --- |
| `BACKEND_SSH_HOST` | VPS host name. |
| `BACKEND_SSH_PORT` | VPS SSH port. |
| `BACKEND_SSH_USER` | Restricted deployment account. |
| `BACKEND_SSH_PRIVATE_KEY` | Deployment SSH private key. |
| `BACKEND_SSH_HOST_KEY` | Pinned `known_hosts` entry. |

The environment must also define `POSTGRES_IMAGE_APPROVED_REF` with the exact
PostgreSQL reference allowed by release policy.

The workflow downloads the manifest from the selected successful build run. It
then verifies the selected build and its upstream CI run, the repository and
branch identity, exact release SHA, manifest shape, expected GHCR repositories,
Cosign identity, BuildKit provenance, SBOM, and PostgreSQL pin before opening an
SSH connection.

The VPS receives only the verified manifest and invokes the root-owned release
controller through a narrow sudo rule. It does not check out source or run npm
on the server. Host validation repeats the application signature checks and
enforces release-directory, Compose, TLS, database, backup, ownership, and
health policies. A successful deployment uploads the `compose-release-success`
artifact.

## Host adapter

Every `*_COMMAND` and `*_CHECK` setting in `/etc/quest-esports/release.env` is
served by one reviewed script, `ops/deploy/host-hooks.sh`. It dispatches on its
own basename, so each setting is installed as a root-owned `0755` alias of that
one file:

```bash
install -o root -g root -m 0755 ops/deploy/host-hooks.sh /usr/local/sbin/quest-release-hooks
grep -oE '^quest-release-[a-z0-9-]+' ops/deploy/host-hooks.aliases \
  | xargs -I{} ln -f /usr/local/sbin/quest-release-hooks /usr/local/sbin/{}
```

The adapter refuses to run unless it is invoked as root with the canonical
root-owned `release.env`, and it fails closed on any name it does not implement.
Settings listed as deliberately unimplemented in `ops/deploy/host-hooks.aliases`
— legacy PM2/VALORANT restart and unmask, and blind Supabase URL rollback — must
stay unset on the host. `ops/tests/host-hooks.test.sh` pins the alias list, the
dispatcher, and `ops/deploy/release.env.example` against each other, so a
renamed hook fails CI instead of a release.

Two settings deliberately point outside the adapter: `BACKUP_COMMAND` and
`BACKUP_FRESHNESS_COMMAND` must name the same canonical backup and freshness
scripts the `quest-esports-backup` timers run, so release evidence and scheduled
backups cannot diverge. Because the controller already holds the canonical
release lock, it hands that open descriptor to those scripts as fd 8 together
with `BACKUP_RELEASE_LOCK_HELD=1`. A child that re-opens the lock path instead —
including through `/proc/self/fd/N`, which is a re-open rather than a dup on
Linux — blocks against the lock its own parent holds.
`ops/tests/release-lock-handoff.test.sh` pins that.

## Normal deploy and rollback

With deployment enabled, a successful image build starts the production workflow
automatically and waits at the `production-compose` approval gate.

For a manual redeploy of the newest approved `main` release:

1. Open **Actions → Deploy immutable Compose release → Run workflow**.
2. Select `main` and leave `rollback_sha` empty.
3. Review and approve the `production-compose` deployment.

For an intentional rollback, enter the full lowercase 40-character SHA in
`rollback_sha`. The SHA must already have a successful `main` CI run, successful
image build, and an unexpired release manifest. Rollback never rebuilds an image
from a moving tag and does not reverse database migrations. Production migrations
must therefore remain backward-compatible with the previous application release.

## VALORANT E2E

The protected E2E workflow accepts the exact current `main` SHA and uses the
checked-out `valorant-platform-backend/` directory. The `valorant-e2e`
environment supplies only test data and database credentials:

- `E2E_VAL_DATABASE_URL`
- `E2E_QUEST_DATABASE_URL`
- `E2E_ADMIN_EMAIL`
- `E2E_ADMIN_PASSWORD`
- `E2E_SAVED_TEAM_A_ID`
- `E2E_SAVED_TEAM_B_ID`
- `E2E_PLAYER_A`
- `E2E_PLAYER_B`
- `E2E_MATCH_HENRIK_ID`
- `E2E_MATCH_UUIDS`
- `E2E_ANCHOR_MISMATCH_SERIES`

No personal access token or sibling-repository checkout is required.

## Operational checks

Before enabling deployment or after changing the controller:

```bash
bash -n ops/deploy/release.sh ops/deploy/validate-host.sh ops/deploy/verify-release.sh
bash ops/tests/adopt-compose.test.sh
bash ops/tests/deploy-release.test.sh
bash ops/tests/host-hooks.test.sh
```

Also verify that the installed root-owned host scripts match the reviewed
repository versions before enabling `COMPOSE_DEPLOY_ENABLED`. Keep production
environment files outside Git; back them up only to an access-restricted secret
backup location.

See [Production Operations Runbook](production-runbook.md),
[Environment Reference](environment-reference.md), and
[Deployment Safety](DEPLOYMENT_SAFETY.md) for host, configuration, and recovery
details.
