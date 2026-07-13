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
npm test
```

The backend unit suite includes coverage for admin registration/recruitment Excel export generation, admin deletion workflows, tournament registration duplicate handling, and recruitment validation.

Frontend:

```bash
cd frontend
npm ci
npm run lint
npm run build
```

The frontend lint/build checks cover the admin download helper and registration status UI at compile time. There is no browser E2E workflow in CI yet.

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

The backend job deploys to a VPS over SSH and follows the production flow from the setup guide.

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
- persistent storage mounted for `backend/uploads/`
- a non-root `deploy` user that owns the checkout and can manage only the Quest PM2 process
- `backend/.env` owned by the deploy user with mode `600` (or group-readable mode `640`)

Capture the VPS SSH host key from a trusted administrative session and compare its fingerprint before storing it. The deployment never runs `ssh-keyscan` on an untrusted Actions runner:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
printf '%s ' 'api.questesports.lk'; cat /etc/ssh/ssh_host_ed25519_key.pub
```

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

After a successful CI run, deployment checks out and deploys that run's exact commit SHA. On deploy, the workflow runs:

```bash
git fetch origin "$DEPLOY_SHA"
git checkout --detach "$DEPLOY_SHA"
cd backend
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
pm2 restart "$BACKEND_PM2_PROCESS" --update-env
pm2 save
```

The workflow refuses root deployments and dirty checkouts, validates `.env` permissions, runs lint and migrations, then performs a local health check. If installation, restart, or health validation fails, it restores the previous application commit and restarts it. Database migrations are intentionally not reversed, so production migrations must remain backward-compatible (expand first, deploy code, contract only in a later release). Protect the GitHub `production` environment with required reviewers and keep a current Supabase backup before approving a migration deployment.

## Manual Deployment

To redeploy the current `main` branch without pushing a new commit:

1. Open GitHub Actions.
2. Select `CD`.
3. Choose `Run workflow`.

The same deploy enablement variables still apply.
