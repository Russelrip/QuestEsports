# Production Operations Runbook

This is the operational source of truth for the current Quest Esports production deployment. It covers the Ubuntu VPS backend, Vercel frontend, Supabase PostgreSQL database, GitHub Actions deployment, persistent uploads, service recovery, and reboots.

## Current Topology

- Frontend: Vercel at `https://questesports.lk`, with the configured deployment region in Singapore and normal Vercel edge delivery
- Backend: Ubuntu 24.04 VPS in France at `https://api.questesports.lk`
- Backend checkout: `/var/www/QuestEsports`
- Backend service user: `deploy` (never `root`)
- Process manager: PM2 supervised by `pm2-deploy.service`
- Database: Supabase PostgreSQL in Paris (`eu-west-3`) through Supavisor session mode on port `5432` for both `DATABASE_URL` and `DIRECT_URL`
- Email: Amazon SES in Tokyo (`ap-northeast-1`) when `MAIL_PROVIDER=smtp`; SMTP credentials are region-specific
- Public uploads: `/srv/quest-esports/uploads`
- Private payment evidence: `/srv/quest-esports/private`
- CI/CD: GitHub Actions; CI gates CD on `main`

The Paris database became production on July 29, 2026. The previous Tokyo project is a temporary rollback copy, not a second writable production database. Keep it unchanged only until the Paris backup and restore drill succeeds, then delete it and rotate its database credentials.

## Required Ownership And Permissions

```bash
chown -R deploy:deploy /var/www/QuestEsports /srv/quest-esports
chmod 600 /var/www/QuestEsports/backend/.env
chmod 750 /srv/quest-esports/uploads
chmod 700 /srv/quest-esports/private
```

The backend creates the required child directories. Never expose `PRIVATE_UPLOAD_ROOT` through Nginx or `/api/uploads`.

## Production Environment Invariants

Production startup intentionally fails when any of these invariants is broken:

- `AUTH_ENCRYPTION_KEY` is exactly 64 hexadecimal characters.
- `APP_URL=https://questesports.lk`.
- `API_PUBLIC_URL=https://api.questesports.lk`.
- every `CORS_ORIGIN` entry uses HTTPS.
- `TRUST_PROXY` is enabled for the Nginx hop.
- `REQUIRE_API_ORIGIN=true`.
- `UPLOAD_ROOT` and `PRIVATE_UPLOAD_ROOT` are configured.
- `MAIL_DELIVERY_REQUIRED=true` and the selected provider credentials plus `MAIL_FROM` are complete.
- PayHere values are either all blank or all configured; a configured notify URL must use HTTPS.

Use [backend/.env.example](../backend/.env.example) for the full variable list and the [Setup and Deployment Guide](./setup-and-deployment.md) for production examples.

### Preserving existing encrypted data when normalizing the auth key

Older deployments accepted an arbitrary `AUTH_ENCRYPTION_KEY` and derived the AES key with SHA-256. Do not replace that value with a random key if encrypted MFA, recruitment NIC, or queued-token data already exists. Convert the existing value to its SHA-256 hexadecimal representation; the derived encryption bytes remain identical:

```bash
cd /var/www/QuestEsports/backend
node -e '
  const fs = require("fs");
  const crypto = require("crypto");
  const dotenv = require("dotenv");
  const env = dotenv.parse(fs.readFileSync(".env"));
  const current = env.AUTH_ENCRYPTION_KEY;
  if (!current) process.exit(2);
  process.stdout.write(
    /^[a-f0-9]{64}$/i.test(current)
      ? current
      : crypto.createHash("sha256").update(current).digest("hex")
  );
'
```

Store the output securely in `AUTH_ENCRYPTION_KEY`; never paste it into tickets, chat, logs, or GitHub Actions output.

## GitHub Actions Configuration

Repository variable:

```text
BACKEND_DEPLOY_ENABLED=true
```

Repository or `production` environment secrets:

```text
BACKEND_SSH_HOST=api.questesports.lk
BACKEND_SSH_PORT=22
BACKEND_SSH_USER=deploy
BACKEND_SSH_PRIVATE_KEY=<private key whose public key is authorized for deploy>
BACKEND_SSH_HOST_KEY=<pinned known_hosts line>
BACKEND_APP_DIR=/var/www/QuestEsports
BACKEND_PM2_PROCESS=quest-backend
BACKEND_HEALTHCHECK_URL=http://127.0.0.1:5001/api/health
```

Generate the pinned host line only from a trusted VPS session:

```bash
KEY="$(awk '{print $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub)"
printf 'api.questesports.lk %s\n' "$KEY"
```

For port 22, the known-hosts name must exactly match `BACKEND_SSH_HOST` and must not include brackets or `:22`. For a nonstandard port, use `[hostname]:port`.

Two different SSH directions are involved:

- `BACKEND_SSH_PRIVATE_KEY`: GitHub Actions runner to VPS.
- Repository deploy key: VPS `deploy` user to the private GitHub repository.

The repository deploy key remains read-only.

## PM2 And Automatic Boot

The process must belong to the `deploy` user's PM2 daemon:

```bash
sudo -u deploy -H bash -lc '
  cd /var/www/QuestEsports/backend
  pm2 start src/server.js --name quest-backend --time
  pm2 save
'
pm2 startup systemd -u deploy --hp /home/deploy
systemctl enable pm2-deploy
```

### Migrating an existing root-owned PM2 process

Confirm the `deploy` user owns the checkout/storage, can read the mode-`600` `.env`, can fetch the repository, and can run `pm2 list` before starting. Then perform a controlled handover:

```bash
rollback_to_root() {
  sudo -u deploy -H pm2 delete quest-backend >/dev/null 2>&1 || true
  pm2 restart quest-backend --update-env
  exit 1
}

pm2 stop quest-backend || exit 1

sudo -u deploy -H bash -lc '
  cd /var/www/QuestEsports/backend
  pm2 start src/server.js --name quest-backend --time
  pm2 save
' || rollback_to_root

HEALTHY=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent --show-error --max-time 5 \
    http://127.0.0.1:5001/api/health >/dev/null; then
    HEALTHY=true
    break
  fi
  sleep 2
done

[ "$HEALTHY" = true ] || rollback_to_root
pm2 delete quest-backend
pm2 save --force
```

Only after the health check passes should the old root entry be removed. Then install the `deploy` systemd unit, stop the manually started deploy daemon once, and let systemd resurrect the saved list:

```bash
pm2 startup systemd -u deploy --hp /home/deploy
systemctl enable pm2-deploy
systemctl stop pm2-deploy || true
sudo -u deploy -H pm2 kill || true
systemctl reset-failed pm2-deploy
systemctl start pm2-deploy
```

If PM2 was started manually before the systemd unit, `systemctl start pm2-deploy` can fail with `Result: protocol`. Stop the existing daemon once, then let systemd resurrect the saved list:

```bash
systemctl stop pm2-deploy || true
sudo -u deploy -H pm2 kill || true
systemctl reset-failed pm2-deploy
systemctl start pm2-deploy
```

Verify ownership and supervision:

```bash
systemctl is-enabled pm2-deploy
systemctl is-active pm2-deploy
sudo -u deploy -H pm2 list
ps -eo user,pid,args | grep '[n]ode.*server.js'
```

Expected: `enabled`, `active`, `quest-backend` online, and the Node process owned by `deploy`.

## Normal Deployment

1. Push to `main`.
2. CI runs backend audit, migrations against PostgreSQL 16, migration/schema verification, coverage, lint, frontend audit/lint/unit tests/build, and Playwright.
3. After CI succeeds, CD deploys the exact CI commit SHA.
4. If migrations changed, set the protected `BACKEND_MIGRATION_APPROVAL_SHA` secret to that exact 40-character commit SHA. CD refuses any other value and creates an encrypted off-site backup before applying the migration.
5. CD installs backend dependencies, generates Prisma, lints, applies production migrations, verifies RLS/Data API privileges, restarts PM2, checks health plus public tournament/product/capability reads, and saves the process list.

Manual redeploy: GitHub `Actions -> CD -> Run workflow`. The manual job redeploys the current `main` commit and refuses to continue unless that exact commit has a successful `CI` run.

The deployment refuses root SSH users, dirty tracked worktrees, insecure `.env` permissions, and unpinned SSH hosts.

## Rollback Semantics

If install, restart, or health validation fails, CD checks out the previous application commit, reinstalls its dependencies, regenerates Prisma, and restarts PM2. Database migrations are not reversed. Every production migration must therefore remain backward-compatible with the previous application release (expand first; contract later).

Never rely on a Free-plan Supabase dashboard backup. Confirm that the encrypted database-and-upload archive exists off-site before approving a migration. Clear `BACKEND_MIGRATION_APPROVAL_SHA` after the deployment.

## Verification

Run Linux commands from the VPS, not Windows PowerShell:

```bash
sudo -u deploy -H git -C /var/www/QuestEsports rev-parse --short HEAD
systemctl is-active pm2-deploy
sudo -u deploy -H pm2 list
curl --fail --silent --show-error http://127.0.0.1:5001/api/health
curl --fail --silent --show-error https://api.questesports.lk/api/health
curl --fail --silent --show-error https://questesports.lk/sitemap.xml > /dev/null
curl --fail --silent --show-error https://questesports.lk/robots.txt
```

From Windows PowerShell, use:

```powershell
Invoke-RestMethod https://api.questesports.lk/api/health
$sitemap = Invoke-WebRequest https://questesports.lk/sitemap.xml -UseBasicParsing
[xml]$sitemap.Content | Out-Null
Invoke-WebRequest https://questesports.lk/robots.txt -UseBasicParsing
```

PowerShell aliases `curl` to `Invoke-WebRequest`, and Windows `sudo.exe` is not Linux `sudo`.

## Troubleshooting

### Configure SSH exits on `test -n`

A required Actions secret resolved to an empty value. Confirm the exact secret names in `.github/workflows/cd.yml`. Repository secrets are available to the workflow; `production` environment secrets may be used for tighter scoping.

### `No ED25519 host key is known`

`BACKEND_SSH_HOST_KEY` does not match the exact hostname/IP or port format in `BACKEND_SSH_HOST`. Regenerate the line from the trusted VPS session and update the pair together.

### Deployment refuses root

Set `BACKEND_SSH_USER=deploy`. The checkout, `.env`, uploads, repository deploy key, and PM2 daemon must be accessible to that user.

### New code repeatedly restarts

```bash
sudo -u deploy -H pm2 logs quest-backend --err --lines 100 --nostream
```

Configuration validation errors appear before the server listens on port 5001. Fix the production `.env` without printing secret values, then rerun CD; do not hide the validation in code.

### `dubious ownership` from Git

Run repository commands as the owner:

```bash
sudo -u deploy -H git -C /var/www/QuestEsports status --short
```

Do not add a global safe-directory exception for root merely to bypass correct ownership.

## Updates And Reboots

Take a VPS snapshot before broad package upgrades. Apply standard upgrades during a maintenance window:

```bash
apt update
apt list --upgradable
apt upgrade
```

If `/var/run/reboot-required` exists:

```bash
sudo -u deploy -H pm2 save
systemctl is-enabled pm2-deploy
reboot
```

After reconnecting, repeat the verification commands. PM2/systemd should restore the backend automatically.

## Backup Set

Back up and restore these together:

- Supabase PostgreSQL database.
- `/srv/quest-esports/uploads`.
- `/srv/quest-esports/private`.
- production `.env` through a secure secret-management process.

Do not treat admin Excel exports as backups. Payment-proof backups contain sensitive records and require restricted access, retention enforcement, and secure deletion.

### Automated encrypted off-site backups

The repository provides:

- `ops/backup-production.sh`
- `ops/restore-production-backup.sh`
- `ops/systemd/quest-esports-backup.service`
- `ops/systemd/quest-esports-backup.timer`

The backup includes a custom-format PostgreSQL dump, public uploads, private payment evidence, and a manifest. It is encrypted with an offline `age` recipient before upload through `rclone`. Keep the `age` private identity off the production VPS.

Install the prerequisites and configuration:

```bash
sudo apt install postgresql-client rclone age rsync
sudo install -d -o deploy -g deploy -m 700 /srv/quest-esports/backups
sudo install -o root -g deploy -m 640 ops/quest-esports-backup.env.example /etc/quest-esports-backup.env
sudo install -d -o root -g root -m 755 /etc/rclone
sudo install -o root -g deploy -m 640 /path/to/verified-rclone.conf /etc/rclone/quest-esports.conf
sudo install -o root -g root -m 644 ops/systemd/quest-esports-backup.service /etc/systemd/system/
sudo install -o root -g root -m 644 ops/systemd/quest-esports-backup.timer /etc/systemd/system/
```

Edit `/etc/quest-esports-backup.env` without printing its values. Set the Paris session-pooler `DIRECT_URL`, both upload roots, the offline `age` public recipient, and an off-site `rclone` remote. Then verify a manual run and enable the timer:

```bash
sudo -u deploy -H env BACKUP_ENV_FILE=/etc/quest-esports-backup.env bash /var/www/QuestEsports/ops/backup-production.sh
sudo systemctl daemon-reload
sudo systemctl enable --now quest-esports-backup.timer
systemctl list-timers quest-esports-backup.timer
journalctl -u quest-esports-backup.service --since today
```

The backup is not considered successful until both the encrypted archive and checksum are visible on the off-site remote.

### Restore drill

Download one encrypted archive and its checksum to an isolated recovery host that has the offline `age` identity. Restore into a disposable PostgreSQL instance and empty temporary upload directories first. The restore script requires the explicit `RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION` value because its database cleanup and file synchronization are destructive.

Run the restore script through Bash so it does not depend on a checkout retaining executable file modes:

```bash
RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
  BACKUP_ENV_FILE=/path/to/recovery.env \
  bash ops/restore-production-backup.sh /absolute/path/to/quest-production-YYYYMMDDTHHMMSSZ.tar.gz.enc
```

Do not point a restore drill at Paris production. Record the archive timestamp, restored table counts, sample asset checks, and elapsed recovery time. Run a drill after setup and at least quarterly.

### Supabase Data API

The application uses Prisma, not the Supabase Data API. Disable Data API for the Paris project in Supabase Dashboard. The database migration also enables RLS and revokes table privileges from `anon`, `authenticated`, and `service_role`; `npm run prisma:security:verify` enforces that state during CI and deployment.

## External-Service Readiness

- Resend requires a verified sending domain for normal application recipients. If switching back, Amazon SES sandbox delivery remains restricted to verified recipients. Production startup always requires complete configuration for the selected provider while password authentication is enabled.
- PayHere may remain completely unconfigured. Free registrations and bank-transfer tournaments continue to work; PayHere tournament checkout and merchandise checkout remain unavailable until all PayHere values are configured.
- The frontend deploy is managed by Vercel's Git integration and is not restarted by the backend CD workflow.
- The sitemap and crawler configuration are managed by the frontend deploy. After public-route or metadata changes, follow [Google Search Console and Sitemap Operations](./search-console-and-sitemap.md) and confirm the existing Search Console submission remains healthy.
