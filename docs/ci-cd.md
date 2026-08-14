# CI/CD Pipeline

This repository uses GitHub Actions for continuous integration and owner-approved backend, frontend, and Android production releases. Disable Vercel's automatic production deployment from `main`; the protected frontend workflow promotes only the exact CI-passed commit after checking backend API compatibility.

## Workflows

- `.github/workflows/ci.yml` runs on pull requests to `main` and pushes to `main`.
- `.github/workflows/secret-scan.yml` scans pull requests and pushes to `main` for committed credentials.
- `.github/workflows/cd.yml` can only be started manually from the GitHub Actions tab and only deploys when the actor is the repository owner.
- `.github/workflows/deploy-frontend.yml` deploys an explicitly supplied, CI-passed `main` SHA after the production backend reports API compatibility version 2 or newer.
- `.github/workflows/release-admin-apk.yml` builds and signs the private Android admin APK for tags matching `admin-vMAJOR.MINOR.PATCH`, then attaches the APK and checksum to a GitHub Release.

The APK workflow references the `android-release` Environment and accepts only an owner-created tag pointing at the current `main` commit after CI passed that exact SHA. Where the GitHub plan supports required reviewers for private repositories, require repository-owner approval before exposing `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. GitHub Free private repositories cannot use that as a security boundary; keep releases offline or move deployment automation to an owner-only repository before granting another account write access. Keep the original keystore in encrypted offline custody; all future updates must use the same signing certificate.

## CI Checks

Backend:

```bash
cd backend
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:migrate:status
npx prisma migrate diff --exit-code --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma
npm run test:coverage
npm run lint
```

CI also runs `npm audit --omit=dev --audit-level=moderate`. The backend suite enforces line, branch, and function coverage thresholds and includes database integration tests against PostgreSQL 16.

Frontend:

```bash
cd frontend
npm ci
npm run lint
npm test
npm run build
npm run test:e2e
```

CI audits frontend production dependencies, runs Vitest unit tests, builds Next.js,
installs Chromium, and runs the Playwright critical journeys under
`frontend/tests/e2e` with two workers. From a fresh local checkout,
`npm run test:e2e:local` builds before starting Playwright.
Playwright starts a deterministic local mock API on port 5001 so frontend CI
does not depend on an external backend process.

The frontend CI build uses these non-production values:

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

The VALORANT integration adds two schema-scope CI guards: Quest CI runs
`node scripts/verify-prisma-schema-scope.js` (Prisma must never reference the
`valorant` schema) and the `valorant-platform-backend` CI runs a grep guard
(its migrations must never reference the Quest-owned `public` schema or create
cross-schema foreign keys).

## Enabling Deployment

Backend deployment is disabled by default. Enable it with this GitHub repository variable:

```text
BACKEND_DEPLOY_ENABLED=true
```

For frontend releases, set `FRONTEND_DEPLOY_ENABLED=true`, set `PRODUCTION_API_URL`, and configure `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`. Use a `frontend-production` Environment with a required repository-owner reviewer only when the plan supports that protection for private repositories. Otherwise keep production credentials out of any repository writable by collaborators and deploy from an owner-only repository or locally. Run **Deploy frontend** with the full approved `main` SHA only after the backend for that release is healthy.

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

After a successful CI run, the repository owner may manually deploy the current `main` commit. On deploy, the workflow runs:

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

When a migration file changed, deployment additionally requires `BACKEND_MIGRATION_APPROVAL_SHA` to equal the exact 40-character `DEPLOY_SHA`. Before applying that migration, CD runs `ops/backup-production.sh`; any missing backup prerequisite, encryption failure, or off-site upload failure aborts deployment. Set this secret only after reviewing the migration and clear it after the successful release. Use a required repository-owner reviewer for the `production` Environment only when the plan enforces that protection for private repositories; otherwise perform migration deployment from an owner-only system.

Backup success in CD proves archive creation and remote presence; it does not replace an isolated restore drill. Follow [Backup and Disaster Recovery](./backup-and-disaster-recovery.md) for quarterly restoration, key custody, and full environment recovery.

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

## Manual Deployment

To redeploy the current `main` branch without pushing a new commit:

1. Open GitHub Actions.
2. Select `CD`.
3. Choose `Run workflow`.

The workflow deploys the current `main` commit only after confirming that the same commit has a successful `CI` run. The production environment approval and deploy enablement variables still apply.

The owner-only manual trigger is intentional because GitHub Free does not provide branch-protection enforcement for this private personal repository. See [Collaboration And Staging](./collaboration-and-staging.md) before granting collaborator access.

## Troubleshooting And Verification

Use the [Production Operations Runbook](./production-runbook.md) for:

- missing or mismatched Actions secrets
- pinned host-key failures
- non-root checkout and deploy-key setup
- production `.env` validation failures
- PM2/systemd ownership and reboot recovery
- post-deployment health checks and rollback semantics
- coordinated frontend/backend maintenance mode and deployment behavior
