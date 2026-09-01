# CI/CD Pipeline

This repository uses GitHub Actions for continuous integration and owner-controlled backend, frontend, and Android production releases. The normal production flow is `main` push -> CI -> container image build -> immutable Compose release -> frontend deployment. Disable Vercel's automatic production deployment from `main`; the protected frontend workflow follows only a successful immutable Compose release and promotes its exact SHA after checking backend API compatibility. See the [Developer Guide](developer-guide.md), [Environment Reference](environment-reference.md), and [VALORANT Local Development](valorant-local-development.md) for contributor and integration details.

## Current production status

This repository records that the database cutover completed on **2026-08-31**.
Quest and VALORANT currently use PostgreSQL **17.11** in the VPS container
`quest-postgres` through `127.0.0.1:5433`. Supabase is intact but stale and is
not a rollback target. No rehearsal was performed; the rehearsal gate cannot be
satisfied retroactively.

The Compose workflows below describe the target production authority, but the
host has not completed Compose adoption. Missing PostgreSQL TLS material blocks
both Compose adoption and the real backup pipeline. The scheduled backup has
failed since **2026-08-30 04:20**; the interim
`quest-pg17-interim-backup.{service,timer}` unit covers the gap. Host bootstrap,
TLS provisioning, backup recovery, and retirement of the interim unit remain
operator gates. The deploy account's unrestricted root grant and two GitHub
Actions keys also require host remediation. These are repository-recorded
risks, not live verification or owner approval.

After TLS is provisioned, production PostgreSQL clients must use
`sslmode=verify-full` with the private CA. The sibling VALORANT asyncpg client
must use its equivalent full certificate and hostname verification settings.
External PostgreSQL/VALORANT Cosign signer settings are not required: those
images remain exact owner-approved digest references, while Quest images use the
Quest-only Cosign identity.

## Production deployment authority

The protected repository variable `PRODUCTION_DEPLOYMENT_MODE` selects
the production path. It must be set to `compose` for the current production
authority. In that mode, `deploy-compose.yml` is the sole production deployment
workflow and `deploy-frontend.yml` follows its successful run; there is no second
automatic production trigger. The legacy PM2 workflow remains in the repository
only for rollback history and is runnable only when the variable is explicitly
set to `legacy-pm2`. Keep PM2 CD disabled before and after the Compose cutover.
All three production deployment workflows share the `production-release`
concurrency group.

## Workflows

- `.github/workflows/ci.yml` runs on pull requests to `main` and pushes to `main`.
- `.github/workflows/secret-scan.yml` scans pull requests and pushes to `main` for committed credentials.
- `.github/workflows/cd.yml` retains the legacy PM2 path and its manual/CI triggers for rollback history, but every job is gated by `PRODUCTION_DEPLOYMENT_MODE=legacy-pm2`; it is disabled before and after the Compose cutover.
- `.github/workflows/deploy-frontend.yml` automatically runs only after a
  successful `Deploy immutable Compose release` for `main`. It downloads the
  Compose proof and the separate `frontend-release` SHA artifact from that exact
  Compose run, then requires the SHA to be the current successful `main` CI
  commit and the live backend to report API compatibility version 2 or newer.
  Manual dispatch accepts only an exact successful Compose run ID; it does not
  accept a manually supplied source SHA.
- `.github/workflows/release-admin-apk.yml` builds and signs the private Android admin APK for tags matching `admin-vMAJOR.MINOR.PATCH`, then attaches the APK and checksum to a GitHub Release.
- `.github/workflows/build-container-images.yml` publishes immutable frontend,
  backend-runtime, and backend-migrator images only after a successful `CI` run
  for a `main` push from this repository, after the build job's protected
  `container-image-build` Environment approves the external image references.
  It checks out and compares the exact successful CI SHA before publishing. It
  does not run for pull requests or publish on a direct PR event.
- `.github/workflows/deploy-compose.yml` promotes only the manifest artifact from
  a successful image-build run whose artifact names the upstream successful
  `CI` run ID and full SHA. It re-reads the selected image-build run metadata,
  enumerates its unexpired artifacts, and requires exactly one artifact whose
  upstream CI run ID, workflow, event, branch, conclusion, and SHA all agree.
  Automatic and ordinary manual releases additionally require that this SHA is
  the current `main` head before the protected deployment environment is
  entered. An explicit `rollback_sha` dispatch input is the only exception: it
  must identify an older release with its own successful `main` CI run and image
  build; it is never an arbitrary source SHA.
  Its final `release-success` job requires both the resolver and actual `deploy`
  job to succeed; a skipped/no-op release therefore fails the workflow and
  cannot trigger frontend promotion. It uploads the exact
  `compose-release-success` proof artifact and a separate `frontend-release`
  artifact containing only the validated `RELEASE_SHA`, plus an exact
  normal/rollback release-mode marker. The frontend workflow downloads these
  artifacts from that specific Compose run and requires their SHA values and
  Compose identity to agree before promotion. A successful explicit rollback
  therefore promotes the matching backend and frontend SHA; it cannot leave
  the frontend on the normal release. The proof uses the whitespace-free stable identifier
  `compose_workflow=Deploy_immutable_Compose_release` while retaining the
  human-readable workflow name in the trigger. It supports a protected manual
  dispatch that selects the latest successful build, or an explicitly named
  older successful release through `rollback_sha`; both paths carry the same
  validated release identity to frontend promotion.

## Immutable Compose release transition

The container path is the production authority; the legacy PM2/Vercel path is
deliberately retained only for an explicitly selected rollback history.
The image workflow checks out the exact successful CI `head_sha`, tags each
Quest image with that full SHA, publishes by GHCR digest, emits BuildKit
provenance/SBOM attestations, and keylessly signs the three Quest image digests
with GitHub OIDC. Its release artifact is named with the upstream CI run ID and
full SHA and contains an exact six-entry manifest containing
`commit_sha`, `frontend_image`, `backend_image`, `migrator_image`,
`postgres_image`, and `valorant_image`; deployment rejects mutable references or
any SHA that is not bound to that artifact.

The Quest entries are fixed to the GHCR repositories
`ghcr.io/russelrip/quest-frontend`, `ghcr.io/russelrip/quest-backend`, and
`ghcr.io/russelrip/quest-migrator`. The deploy workflow rejects a manifest that
uses another repository, a tag, or an unbound digest.

Before deployment, the workflow logs in to GHCR and verifies each Quest image
digest with cosign using the fixed issuer
`https://token.actions.githubusercontent.com` and the exact certificate
identity
`https://github.com/Russelrip/QuestEsports/.github/workflows/build-container-images.yml@refs/heads/main`.
It separately inspects the OCI BuildKit attestation manifests and requires both
an SPDX/CycloneDX SBOM predicate and an SLSA provenance predicate. These are
BuildKit attestations, not cosign-signed attestations, so the workflow does not
misrepresent them with `cosign verify-attestation`.

The host template's Quest Cosign certificate policy is the exact
`build-container-images.yml` workflow identity on `refs/heads/main`; the
that identity is used only for the three Quest-owned GHCR images. The approved
live PostgreSQL service is VPS container `quest-postgres`, PostgreSQL 17.11,
and its production image reference is exactly
`postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0`.
The official PostgreSQL image and the sibling VALORANT image are external
images: neither is passed to the Quest Cosign verifier; each is accepted only
when its manifest value exactly equals the protected owner-approved reference.
Public `NEXT_PUBLIC_*` values and the non-secret provenance identity arguments
`QUEST_BUILD_WORKFLOW`, `QUEST_BUILD_REPOSITORY`, `QUEST_BUILD_BRANCH`,
`QUEST_BUILD_REVISION` are image build arguments. The approved stable builder
identity is emitted by each `--provenance` option as
`https://github.com/Russelrip/QuestEsports/.github/workflows/build-container-images.yml@refs/heads/main`.
The provenance values record which workflow, repository, branch, release commit,
and approved repository/workflow builder identity produced the image;
they are not credentials or secrets. Runtime credentials and secrets are
supplied by the protected environment or mounted host configuration, never as
build arguments.

Configure these non-secret repository variables before enabling the path:

```text
PRODUCTION_API_URL=https://api.questesports.lk
PRODUCTION_SITE_URL=https://questesports.lk
POSTGRES_17_BOOKWORM_DIGEST=sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0
POSTGRES_IMAGE_APPROVED_REF=postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0
VALORANT_IMAGE=ghcr.io/<sibling-owner>/<image>@sha256:<owner-verified-digest>
VALORANT_IMAGE_APPROVED_REF=ghcr.io/<sibling-owner>/<image>@sha256:<same-owner-approved-digest>
COMPOSE_DEPLOY_ENABLED=true
```

Use a protected `container-image-build` Environment with required reviewers for
the external digest/reference variables above, and configure the same two
approved reference variables in the protected `production-compose` Environment. Both
workflows fail closed unless the approved PostgreSQL and VALORANT references
exactly equal the manifest values. Quest does not assert or create signatures
for those externally built/published images; the owner-approved exact-digest
controls are the trust boundary for this phase.

`production-compose` should be a protected GitHub Environment with required
reviewers. The deploy job uses the existing `BACKEND_SSH_HOST`,
`BACKEND_SSH_PORT`, `BACKEND_SSH_USER`, `BACKEND_SSH_PRIVATE_KEY`, and
`BACKEND_SSH_HOST_KEY` contract, requires the user to be exactly `deploy`, and
invokes only the root-owned `/usr/local/sbin/quest-esports-release` through
non-interactive sudo with the full SHA and downloaded manifest path. The host
bootstrap must install that fixed script and its narrow sudoers entry and
pre-create `/var/lib/quest-esports/incoming/release-manifest` as a non-symlink
`root:deploy` mode `0660` file. The workflow overwrites that existing inode so
the Task 7A root-ownership check remains true; it does not remove or replace
the file. This workflow does not grant Docker access or run source checkout,
npm, PM2, or migrations on the VPS.

The image workflow requests only `contents: read`, `packages: write`, and
`id-token: write`. BuildKit's registry-pushed SBOM/provenance attestations do
not require the separate GitHub Artifact Attestations permission. Both the
build and deploy workflows run Cosign from the same immutable official
container reference:
`ghcr.io/sigstore/cosign/cosign:v2.4.1@sha256:b03690aa52bfe94054187142fba24dc54137650682810633901767d8a3e15b31`.
No upstream Cosign binary checksum is invented; the container digest is the
reproducibility pin, while upstream binary-checksum pinning remains a
limitation.

This phase does **not** change DNS or claim that a VPS, registry, signing,
attestation, SSH, or hosted GitHub execution has been verified. Keep
`.github/workflows/cd.yml` and the Vercel promotion code as the legacy PM2/Vercel
transition path, but leave PM2 CD disabled before and after the Compose cutover
by requiring `PRODUCTION_DEPLOYMENT_MODE=legacy-pm2` for that workflow. The
frontend workflow follows Compose when `PRODUCTION_DEPLOYMENT_MODE=compose`; it
must not follow legacy `CD`. No DNS cutover occurs in the immutable image or
deployment workflows.

For a local contract check, confirm both new files contain only 40-hex SHA
workflow/artifact bindings, `cancel-in-progress: false`, no `workflow_dispatch`
in the build workflow, exact CI/build SHA checks, fixed cosign identity/issuer,
external approval equality checks, and no `npm ci`, `pm2`, `docker group`, or
mutable `:latest` deployment reference. Runtime evidence still requires the
assigned actionlint and host/operator checks; documentation cannot provide that
evidence.

The Compose deployment is the automatic, repository-owner-only production job
when `PRODUCTION_DEPLOYMENT_MODE=compose`; it is gated by
`COMPOSE_DEPLOY_ENABLED=true`, the exact successful CI SHA carried by the
immutable image manifest, and protected `production-compose` approval. A CI or
Compose release failure prevents the frontend workflow from running. Frontend
deployment is owner-only and gated by `FRONTEND_DEPLOY_ENABLED=true`, the full
`main` SHA from a successful `Deploy immutable Compose release` run, successful
CI, and live API-compatibility checks. The legacy PM2 CD remains available only
when `PRODUCTION_DEPLOYMENT_MODE=legacy-pm2` is explicitly selected for
rollback history. APK release is gated by an owner-created version tag
pointing to the tested `main` commit and runs audit, typecheck, tests, Expo
doctor, Android prebuild, and signing.

The APK workflow references the `android-release` Environment and accepts only an owner-created tag pointing at the current `main` commit after CI passed that exact SHA. Where the GitHub plan supports required reviewers for private repositories, require repository-owner approval before exposing `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. GitHub Free private repositories cannot use that as a security boundary; keep releases offline or move deployment automation to an owner-only repository before granting another account write access. Keep the original keystore in encrypted offline custody; all future updates must use the same signing certificate.

## CI Checks

Backend CI uses Node 24 and PostgreSQL 16, then runs:

```bash
cd backend
npm ci
npm audit --omit=dev --audit-level=moderate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:migrate:status
npx prisma migrate diff --exit-code --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma
node scripts/verify-prisma-schema-scope.js
npm run prisma:security:verify
npm run test:coverage
npm run lint
```

CI also runs `npm audit --omit=dev --audit-level=moderate`. The backend suite enforces line, branch, and function coverage thresholds and includes database integration tests against PostgreSQL 16.

The PostgreSQL 16 service is a disposable CI fixture and remains intentionally
unchanged. It does not represent the production database major. The separate
`postgres17-contracts` job performs static, secret-free checks for the
PostgreSQL 17 production contract: the base Compose file has no database host
publication, the staging overlay uses only loopback `127.0.0.1:55432`, the
bootstrap contains the four-role/schema and default-ACL contract, the backup
target is `127.0.0.1:55432`/`quest` with pinned PostgreSQL 17 clients, and the
restore rehearsal requires the immutable PostgreSQL 17 target, exact two-schema
scope, and owner/deployment-host evidence gate. The job renders Compose with
synthetic image digests and a disposable empty env-file placeholder; it does
not contact a VPS, database, registry, backup remote, or hosted endpoint.
The external VALORANT image is released only with the checked-in
`ops/docker/valorant.production.compose.yml` contract: its asyncpg URL uses
`ssl=require`; full certificate and hostname verification are supplied
separately through `VALORANT_DATABASE_SSL_CA_FILE`,
`VALORANT_DATABASE_SSL_SERVER_HOSTNAME`, and
`VALORANT_DATABASE_SSL_VERIFY=full`. The repository validates that the
owner-supplied Compose source contains those inputs but cannot claim to inspect
the image's Python SSL-context implementation; validation fails closed when
the contract is absent.

Frontend:

```bash
cd frontend
npm ci
npm audit --audit-level=high
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium firefox webkit
npm run test:e2e
```

CI audits frontend dependencies (including development dependencies), runs
ESLint, the strict TypeScript check, Vitest unit tests, and the Next.js build,
installs Chromium, Firefox, and WebKit, and runs the Playwright critical
journeys under `frontend/tests/e2e` with one worker in CI. From a fresh local checkout,
`npm run test:e2e:local` builds before starting Playwright.
Playwright starts a deterministic local mock API on port 5011 so frontend CI
does not depend on an external backend process.

### Mobile-admin CI

The `mobile-admin` job runs on every CI workflow with Node 24. It installs with
`npm ci`, runs `npm run audit:ci`, unit tests, TypeScript typecheck, and
Expo Doctor validation. The workflow supplies the configured API and site
environment values for configuration validation; this job does not build or
publish an APK.

### Protected VALORANT two-service E2E

VALORANT two-service E2E is deliberately outside pull-request CI. The
`.github/workflows/valorant-e2e.yml` workflow is manually dispatched by the
repository owner with the full SHA currently at `main`. A credential-free
validation job checks that SHA before the E2E job can run. The E2E job uses the
protected `valorant-e2e` Environment, checks out only that validated revision
and the sibling `valorant-platform-backend` repository, and receives the
dedicated test values through environment variables. It installs both
`backend` npm dependencies and the sibling FastAPI development dependencies
before running `npm run test:valorant:e2e`.

Do not move these credentials into `ci.yml` or add a pull-request trigger to
the protected workflow. The test project and credentials are owner-maintained
fixtures only; this is not a production integration test.

The frontend CI build uses these non-production values:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:5011
NEXT_PUBLIC_SITE_URL=http://localhost:3000
PLAYWRIGHT_MOCK_API_PORT=5011
```

The VALORANT integration adds two schema-scope CI guards: Quest CI runs
`node scripts/verify-prisma-schema-scope.js` (Prisma must never reference the
`valorant` schema) and the `valorant-platform-backend` CI runs a grep guard
(its migrations must never reference the Quest-owned `public` schema or create
cross-schema foreign keys).

Deployment health semantics are consistent across the workflows: `/api/health/live`
is liveness, while `/api/health` and `/api/health/ready` are readiness aliases
that check database and storage and, when clustered realtime is enabled, the
acknowledged shared realtime transport. They may return `503` during
maintenance or dependency failure. `/api/openapi.json` is the API schema
endpoint.

## Enabling Deployment

Backend deployment is disabled by default. Enable it with this GitHub repository variable:

```text
PRODUCTION_DEPLOYMENT_MODE=compose
COMPOSE_DEPLOY_ENABLED=true
FRONTEND_DEPLOY_ENABLED=true
```

For Compose releases, set `COMPOSE_DEPLOY_ENABLED=true` and protect the
`production-compose` Environment. For frontend releases, set
`FRONTEND_DEPLOY_ENABLED=true`, set `PRODUCTION_API_URL`, and configure
`VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`. Use a
`frontend-production` Environment with a required repository-owner reviewer only
when the plan supports that protection for private repositories. Otherwise keep
production credentials out of any repository writable by collaborators and
deploy from an owner-only repository or locally. The automatic **Deploy
frontend** workflow uses the exact successful Compose release SHA; retain
manual dispatch for emergency/manual redeploys. To use the legacy PM2 workflow
for rollback history, explicitly select `PRODUCTION_DEPLOYMENT_MODE=legacy-pm2`;
never enable it alongside Compose.

The legacy PM2 path is separate and rollback-only:

```text
PRODUCTION_DEPLOYMENT_MODE=legacy-pm2
BACKEND_DEPLOY_ENABLED=true
```

## Backend Deployment Secrets

The backend job deploys to the `production` environment over SSH and follows the production flow from the setup guide. Secrets may be repository secrets or environment secrets; environment secrets are preferred when the repository plan supports them.

Required GitHub secrets:

```text
BACKEND_SSH_HOST=your.server.host
BACKEND_SSH_PORT=22
BACKEND_SSH_USER=deploy
BACKEND_SSH_PRIVATE_KEY=private SSH key for the deploy user
BACKEND_SSH_HOST_KEY=the complete pinned known_hosts line for the VPS
BACKEND_APP_DIR=/var/www/QuestEsports
BACKEND_PM2_PROCESS=quest-backend
BACKEND_HEALTHCHECK_URL=http://127.0.0.1:5001/api/health
```

`BACKEND_SSH_PRIVATE_KEY` authenticates the GitHub Actions runner **to the VPS**. It does not give the VPS permission to pull a private GitHub repository.

The server must already have:

- read-only GitHub deploy-key access to this repository
- Node.js 24 LTS
- npm
- PM2
- backend production environment variables configured
- PostgreSQL access from `DATABASE_URL` and `DIRECT_URL`
- persistent public and private storage configured through `UPLOAD_ROOT` and `PRIVATE_UPLOAD_ROOT`
- a non-root `deploy` user that owns the checkout and its Quest PM2 process
- `pm2-deploy.service` enabled for automatic boot recovery
- `backend/.env` owned by the deploy user with mode `600` (or group-readable mode `640`)

Capture the VPS SSH host key from a trusted administrative session and compare its fingerprint before storing it. The deployment never runs `ssh-keyscan` on an untrusted Actions runner:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
KEY="$(awk '{print $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub)"
printf 'api.questesports.lk %s\n' "$KEY"
```

The known-hosts name must exactly match `BACKEND_SSH_HOST`. Port 22 uses the bare hostname. Nonstandard ports use `[hostname]:port`.

### Private repository access from the VPS

Generate a separate SSH key while logged into the VPS as the deployment user:

```bash
ssh-keygen -t ed25519 -C "quest-backend-vps" -f ~/.ssh/quest_github_deploy -N ""
cat ~/.ssh/quest_github_deploy.pub
```

In GitHub, open the repository and add the displayed public key under:

```text
Settings -> Deploy keys -> Add deploy key
```

Leave write access disabled. Then configure the VPS deployment user's SSH client:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/quest_github_deploy
  IdentitiesOnly yes
EOF

chmod 600 ~/.ssh/config ~/.ssh/quest_github_deploy
# Pin GitHub's published SSH host keys from https://docs.github.com/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
chmod 600 ~/.ssh/known_hosts
```

Change the repository remote from HTTPS to SSH and verify access:

```bash
cd /var/www/QuestEsports
git remote set-url origin git@github.com:Russelrip/QuestEsports.git
ssh -T git@github.com
git fetch origin
```

GitHub's SSH test normally prints a successful-authentication message followed by a notice that shell access is unavailable. That is expected.

The deployment workflow prints a targeted hint when the VPS cannot fetch the configured remote. Using a read-only deploy key avoids interactive username prompts and avoids storing a long-lived personal access token on the VPS.

### PM2 systemd ownership

PM2 must run as `deploy`, not root:

```bash
sudo -u deploy -H bash -lc '
  cd /var/www/QuestEsports/backend
  pm2 start src/server.js --name quest-backend --time
  pm2 save
'
pm2 startup systemd -u deploy --hp /home/deploy
systemctl enable pm2-deploy
```

Verify `systemctl is-active pm2-deploy` and `sudo -u deploy -H pm2 list`. See the [Production Operations Runbook](./production-runbook.md#pm2-and-automatic-boot) for migrating an existing root-owned PM2 process and recovering from `Result: protocol`.

When `PRODUCTION_DEPLOYMENT_MODE=legacy-pm2` is explicitly selected for
rollback history, the legacy CD workflow deploys the exact successful `main` CI
commit. A workflow-dispatch ref must be `main`; the workflow verifies that the
current `main` head has the exact successful CI run before deployment. On deploy,
the workflow runs:

```bash
git fetch origin "$DEPLOY_SHA"
git checkout --detach "$DEPLOY_SHA"
cd backend
npm ci
npm run lint
npm run prisma:migrate:deploy
npm run prisma:security:verify
pm2 restart "$BACKEND_PM2_PROCESS" --update-env
pm2 save
```

`npm ci` runs the backend `postinstall` hook, which generates the Prisma client. The workflow refuses root deployments and dirty checkouts, validates `.env` permissions and `node_modules` ownership, runs lint and migrations, and then verifies process liveness plus application readiness. In normal operation it also reads tournaments, products, and commerce capabilities. During an approved maintenance window it accepts readiness only when the response is `503` with `X-Maintenance-Mode: active`, and skips public data reads that are intentionally blocked. Any other installation, restart, or health failure restores the previous application commit and restarts it. Database migrations are intentionally not reversed, so production migrations must remain backward-compatible (expand first, deploy code, contract only in a later release).

Every backend deployment is approved through the `Production` environment's required reviewer: the job pauses before its first step and the owner approves it under `Actions -> the run -> Review deployments`. Destructive or backward-incompatible migrations additionally require `BACKEND_DESTRUCTIVE_MIGRATION_APPROVAL_SHA` to equal the exact 40-character `DEPLOY_SHA`; set it only after reviewing the migration and clear it after the release. Before applying a migration, CD runs `ops/backup-production.sh`; any missing backup prerequisite, encryption failure, or off-site upload failure aborts deployment.

Backup success in CD proves archive creation and remote presence; it does not replace an isolated restore drill. Follow [Backup and Disaster Recovery](./backup-and-disaster-recovery.md) for quarterly restoration, key custody, and full environment recovery. The live production host, region, backup destination, and restore-drill status require owner verification; checked-in workflow files cannot prove those runtime facts.

CD also queries the production `_prisma_migrations` table after installing the target release. A pending database migration requires the same approval and backup even when the VPS checkout was advanced by an earlier interrupted deployment. Every successful deployment records `.quest-successful-deploy-sha`; all non-zero exits use an `EXIT` rollback handler, including deliberate approval failures that do not trigger Bash's `ERR` trap.

### Repairing `node_modules` ownership

If deployment fails with `EACCES` while removing `backend/node_modules/.prisma/client`, files were created by a different VPS user (commonly by running `sudo npm ci`). Repair the existing dependency directory once, using the GitHub environment values for `BACKEND_SSH_USER` and `BACKEND_APP_DIR`:

```bash
DEPLOY_USER=deploy
APP_DIR=/var/www/QuestEsports
DEPLOY_GROUP="$(id -gn "$DEPLOY_USER")"
sudo chown -R "$DEPLOY_USER:$DEPLOY_GROUP" "$APP_DIR/backend/node_modules"
sudo -u "$DEPLOY_USER" -H test -w "$APP_DIR/backend/node_modules/.prisma"
```

Rerun the failed workflow after the write check succeeds. Run future `npm` and Prisma commands as the deploy user, not through `sudo`; the workflow now stops before checking out a new commit if it finds foreign-owned or unwritable dependency directories.

Initial liveness retries may log connection failures while Node starts. A successful job means liveness returned `200` and either readiness plus public smoke reads passed normally, or readiness returned the explicit maintenance `503` header during an approved window. PM2 then saves the process list.

## Emergency And Manual Redeployment

The automatic Compose flow is preferred. To redeploy the latest successful
`main` release without pushing a new commit, use `Deploy immutable Compose
release` while `PRODUCTION_DEPLOYMENT_MODE=compose`. For an intentional older
release, supply its exact successful release as `rollback_sha`; this is the only
Compose exception to the current-main check and is still validated against its
successful `main` CI/build identity.
Use the legacy `CD` workflow only for rollback history, and only after
explicitly selecting `PRODUCTION_DEPLOYMENT_MODE=legacy-pm2`:

1. Open GitHub Actions.
2. Select `Deploy immutable Compose release` (or `CD` only for explicit legacy PM2 rollback).
3. Choose `Run workflow`.

The selected workflow deploys only after confirming the required successful
upstream run and protected mode. The Compose workflow resolves its exact
immutable manifest SHA and checks the current `main` head unless the explicit
`rollback_sha` path is selected; the legacy CD workflow requires the current
`main` head and its successful CI run. No workflow accepts an arbitrary manually
supplied source SHA. The production environment approval and deploy enablement
variables still apply.

The owner-only manual triggers are retained for emergency/manual redeploys. GitHub Free does not provide branch-protection enforcement for this private personal repository. See [Collaboration And Staging](./collaboration-and-staging.md) before granting collaborator access.

## Troubleshooting And Verification

Use the [Production Operations Runbook](./production-runbook.md) for:

- missing or mismatched Actions secrets
- pinned host-key failures
- non-root checkout and deploy-key setup
- production `.env` validation failures
- PM2/systemd ownership and reboot recovery
- post-deployment health checks and rollback semantics
- coordinated frontend/backend maintenance mode and deployment behavior
