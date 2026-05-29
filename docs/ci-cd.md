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
npm test
```

Frontend:

```bash
cd frontend
npm ci
npm run lint
npm run build
```

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

The server must already have:

- Git access to this repository
- Node.js 20+
- npm
- PM2
- backend production environment variables configured
- PostgreSQL access from `DATABASE_URL` and `DIRECT_URL`
- persistent storage mounted for `backend/uploads/`

On deploy, the workflow runs:

```bash
git pull --ff-only origin main
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
