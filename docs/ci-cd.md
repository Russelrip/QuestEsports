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
BACKEND_APP_DIR=/var/www/QuestEsports
BACKEND_PM2_PROCESS=quest-backend
```

`BACKEND_SSH_PRIVATE_KEY` authenticates the GitHub Actions runner **to the VPS**. It does not give the VPS permission to pull a private GitHub repository.

The server must already have:

- read-only GitHub deploy-key access to this repository
- Node.js 20+
- npm
- PM2
- backend production environment variables configured
- PostgreSQL access from `DATABASE_URL` and `DIRECT_URL`
- persistent storage mounted for `backend/uploads/`

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
ssh-keyscan github.com >> ~/.ssh/known_hosts
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

## Manual Deployment

To redeploy the current `main` branch without pushing a new commit:

1. Open GitHub Actions.
2. Select `CD`.
3. Choose `Run workflow`.

The same deploy enablement variables still apply.
