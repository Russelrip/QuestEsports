# CI/CD Pipeline

This repository uses GitHub Actions for continuous integration and optional backend production deployment.

The frontend is deployed by Vercel's Git integration. Do not configure a separate GitHub Actions Vercel deploy unless you intentionally want to replace the Vercel auto-deploy flow.

## Workflows

- `.github/workflows/ci.yml` runs on pull requests to `main` and pushes to `main`.
- `.github/workflows/cd.yml` runs after CI succeeds on `main`, and can also be started manually from the GitHub Actions tab.

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

## Enabling Deployment

Backend deployment is disabled by default. Enable it with this GitHub repository variable:

```text
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

After a successful CI run, deployment checks out and deploys that run's exact commit SHA. On deploy, the workflow runs:

```bash
git fetch origin "$DEPLOY_SHA"
git checkout --detach "$DEPLOY_SHA"
cd backend
npm ci
npm run lint
npm run prisma:migrate:deploy
pm2 restart "$BACKEND_PM2_PROCESS" --update-env
pm2 save
```

`npm ci` runs the backend `postinstall` hook, which generates the Prisma client. The workflow refuses root deployments and dirty checkouts, validates `.env` permissions and `node_modules` ownership, runs lint and migrations, then performs a local health check. If installation, restart, or health validation fails, it restores the previous application commit and restarts it. Database migrations are intentionally not reversed, so production migrations must remain backward-compatible (expand first, deploy code, contract only in a later release). Protect the GitHub `production` environment with required reviewers and keep a current Supabase backup before approving a migration deployment.

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

Initial health retries may log connection failures while Node starts. A successful job means a later retry returned `200` and PM2 saved the process list.

## Manual Deployment

To redeploy the current `main` branch without pushing a new commit:

1. Open GitHub Actions.
2. Select `CD`.
3. Choose `Run workflow`.

The workflow deploys the current `main` commit only after confirming that the same commit has a successful `CI` run. The production environment approval and deploy enablement variables still apply.

## Troubleshooting And Verification

Use the [Production Operations Runbook](./production-runbook.md) for:

- missing or mismatched Actions secrets
- pinned host-key failures
- non-root checkout and deploy-key setup
- production `.env` validation failures
- PM2/systemd ownership and reboot recovery
- post-deployment health checks and rollback semantics
