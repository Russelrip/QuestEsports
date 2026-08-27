# Production Operations Runbook

This is the operational source of truth for the current Quest Esports production deployment. It covers the Ubuntu VPS backend, Vercel frontend, Supabase PostgreSQL database, GitHub Actions deployment, persistent uploads, service recovery, and reboots. Use [Backup and Disaster Recovery](./backup-and-disaster-recovery.md) as the authoritative backup, restore-drill, key-custody, and full-disaster procedure. For contributor setup and variables, use the [Developer Guide](developer-guide.md) and [Environment Reference](environment-reference.md); the [VALORANT Local Development](valorant-local-development.md) guide is the local integration source.

## Current Topology

The values below are the repository-recorded production target/current-state
claims, not live monitoring evidence. The owner must verify the production
host, deployment region, database region, storage paths, backup destination,
and service state before each operational change; checked-in files alone cannot
prove those facts.

- Frontend: Vercel at `https://questesports.lk`, with the configured deployment region in Singapore and normal Vercel edge delivery
- Backend: Ubuntu 24.04 VPS in France at `https://api.questesports.lk`
- Backend checkout: `/var/www/QuestEsports`
- Backend service user: `deploy` (never `root`)
- Process manager: PM2 supervised by `pm2-deploy.service`
- Database: Supabase PostgreSQL in Paris (`eu-west-3`) through Supavisor session mode on port `5432` for both `DATABASE_URL` and `DIRECT_URL`
- Email: Amazon SES in Tokyo (`ap-northeast-1`) when `MAIL_PROVIDER=smtp`; SMTP credentials are region-specific
- Public uploads: `/srv/quest-esports/uploads`
- Private payment evidence: `/srv/quest-esports/private`
- CI/CD: GitHub Actions; the normal flow is `main` push -> CI -> backend CD -> frontend deployment

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
- `MOBILE_ADMIN_OAUTH_REDIRECT_URL=https://api.questesports.lk/mobile-admin-oauth` and `MOBILE_ADMIN_ANDROID_CERT_SHA256` matches the APK release certificate.
- every `CORS_ORIGIN` entry uses HTTPS.
- `TRUST_PROXY` is enabled for the Nginx hop.
- `REQUIRE_API_ORIGIN=true`.
- `UPLOAD_ROOT` and `PRIVATE_UPLOAD_ROOT` are configured.
- `MAIL_DELIVERY_REQUIRED=true` and the selected provider credentials plus `MAIL_FROM` are complete.
- PayHere values are either all blank or all configured; a configured notify URL must use HTTPS.
- `DATABASE_URL` and `DIRECT_URL` explicitly use an approved `sslmode` and the mobile App Link fingerprint is configured.

The PKCE migration intentionally leaves `mobile_oauth_grants.code_challenge` nullable for one release so migrations can run before the old API process is replaced. New code writes and requires the challenge and rejects any unbound grant. Enforce the database `NOT NULL` constraint only in a later release after all old API processes are retired.

Use [backend/.env.example](../backend/.env.example) for the full variable list and the [Setup and Deployment Guide](./setup-and-deployment.md) for production examples.

## Clustered Realtime Operations

For a multi-worker API, set `CACHE_DRIVER=upstash`, set
`API_PROCESS_COUNT` to the exact PM2 API worker count, and configure
`UPSTASH_REDIS_REST_URL` plus `UPSTASH_REDIS_REST_TOKEN` on every worker. All
workers in one environment must use the same explicit `REALTIME_CHANNEL`, and
staging and production must use different channel names when they share an
Upstash database. Startup rejects a missing channel in clustered/shared
Upstash mode; only one local memory process receives the safe
`quest-realtime-local` default. When
`REALTIME_WORKER_ID` is configured, use the same base on every worker; otherwise
config supplies a process-derived fallback. The implementation creates each
effective identity as `${REALTIME_WORKER_ID}:${process.pid}:${randomUUID()}`, so
a shared PM2 base still produces distinct runtime identities. The shared transport uses the exact
Upstash REST requests below. The publish request uses Upstash's single-command
protocol; the command array is the JSON body, not an object wrapper:

```text
POST {UPSTASH_REDIS_REST_URL}/subscribe/{channel}   # text/event-stream
POST {UPSTASH_REDIS_REST_URL}                       # application/json
Authorization: Bearer {UPSTASH_REDIS_REST_TOKEN}
["PUBLISH", "{channel}", "{serialized realtime envelope}"]
```

`REALTIME_PUBSUB_RECONNECT_BASE_MS` and
`REALTIME_PUBSUB_RECONNECT_MAX_MS` bound the subscriber's exponential
reconnect delay; they default to `250` ms and `10000` ms. Keep these values
consistent across workers when changing the deployment defaults. Readiness is
green only after the subscribe SSE stream provides the valid
`data: subscribe,{channel},{count}` acknowledgement.

### Verify PM2 worker count and transport configuration

Run these checks as `deploy` after every clustered deployment. The PM2 instance
count, `API_PROCESS_COUNT`, and shared channel must agree; never infer this
from the number of healthy HTTP responses alone. `pm2 env` verifies only the
configured base ID, not the effective ID:

```bash
sudo -u deploy -H pm2 list
sudo -u deploy -H pm2 describe quest-backend | grep -E 'instances|exec mode|status'
sudo -u deploy -H pm2 env 0 | grep -E '^(API_PROCESS_COUNT|CACHE_DRIVER|REALTIME_CHANNEL|REALTIME_WORKER_ID)='
sudo -u deploy -H pm2 env 1 | grep -E '^(API_PROCESS_COUNT|CACHE_DRIVER|REALTIME_CHANNEL|REALTIME_WORKER_ID)='
```

For the two-worker target, expect two `online` instances, `API_PROCESS_COUNT=2`,
`CACHE_DRIVER=upstash`, and the same channel and configured base on both
instances. `pm2 env` verifies only the configured base ID. Verify the actual
effective IDs exposed by each worker's live health endpoint instead:

```bash
WORKER_A_HEALTH_URL=https://api-a.example.com/api/health/live
WORKER_B_HEALTH_URL=https://api-b.example.com/api/health/live
A_ID="$(curl --fail --silent --show-error "$WORKER_A_HEALTH_URL" | node -e '
  const body = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const id = body?.realtime?.workerId;
  if (typeof id !== "string" || !id) process.exit(1);
  process.stdout.write(id);
')"
B_ID="$(curl --fail --silent --show-error "$WORKER_B_HEALTH_URL" | node -e '
  const body = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const id = body?.realtime?.workerId;
  if (typeof id !== "string" || !id) process.exit(1);
  process.stdout.write(id);
')"
test "$A_ID" != "$B_ID"
printf 'worker A effective realtime.workerId=%s (prefix=%s)\n' "$A_ID" "${A_ID%:*}"
printf 'worker B effective realtime.workerId=%s (prefix=%s)\n' "$B_ID" "${B_ID%:*}"
```

The health payload is the runtime source of truth for the complete effective
`REALTIME_WORKER_ID:process.pid:randomUUID()` value. The PM2 launch equivalent
is:

```bash
sudo -u deploy -H bash -lc '
  cd /var/www/QuestEsports/backend
  pm2 delete quest-backend || true
  pm2 start src/server.js --name quest-backend -i 2 --time --update-env
  pm2 save
'
```

### Verify SSE heartbeat and proxy timeouts

The API emits an SSE comment heartbeat every 25 seconds. Nginx (or the
equivalent load balancer) must disable response buffering and use read/send
timeouts longer than that heartbeat:

```nginx
proxy_buffering off;
proxy_read_timeout 60s;
proxy_send_timeout 60s;
```

Verify the effective proxy configuration and a live stream without waiting for
an application mutation:

```bash
sudo nginx -T | grep -E 'proxy_buffering|proxy_read_timeout|proxy_send_timeout'
curl --fail --silent --show-error -N --max-time 35 \
  -H 'Accept: text/event-stream' \
  -H 'Origin: https://questesports.lk' \
  'https://api.questesports.lk/api/v1/events?topics=matches'
```

The stream should return `event: ready` promptly and remain open long enough to
observe a `: heartbeat` comment. If it closes near 25 seconds, fix the proxy
before enabling more than one worker. The optional staging exercise is
`node scripts/realtime-cluster-smoke.js` from `backend/`; it requires all seven
`REALTIME_CLUSTER_*` variables documented in [backend/README.md](../backend/README.md).
The smoke requests intentionally omit synthetic `Origin` and `Referer` headers;
use an approved staging security posture or mutation endpoint that accepts the
cookie-bearing server-to-server check without browser-origin headers. It checks
both `user:__realtime_other_user__` and broad `user` denial on both workers.

### Realtime rollback

If the shared transport or proxy is unhealthy, first disable SSE and restart
the API workers. Clients receive the intentional `204` response and use their
bounded polling fallback:

```bash
sudo -u deploy -H sed -i 's/^REALTIME_SSE_ENABLED=.*/REALTIME_SSE_ENABLED=false/' /var/www/QuestEsports/backend/.env
sudo -u deploy -H pm2 restart quest-backend --update-env
```

If the cluster itself must be removed, scale to one worker and use the memory
cache. Set `API_PROCESS_COUNT=1`, `CACHE_DRIVER=memory`, and optionally leave
`REALTIME_SSE_ENABLED=true` for local-process SSE; then restart and verify one
online instance. Re-enable the shared transport only after the two-worker
count, Upstash routes, heartbeat, and smoke checks pass again.

### Preserving existing encrypted data when normalizing the auth key

Older deployments accepted an arbitrary `AUTH_ENCRYPTION_KEY` and derived the AES key with SHA-256. Do not replace that value with a random key if encrypted recruitment NIC or queued-token data already exists. Convert the existing value to its SHA-256 hexadecimal representation; the derived encryption bytes remain identical:

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
BACKEND_DESTRUCTIVE_MIGRATION_APPROVAL_SHA=<exact approved destructive migration commit SHA, when required>
```

Frontend deployment uses these repository/environment settings:

```text
FRONTEND_DEPLOY_ENABLED=true
PRODUCTION_API_URL=https://api.questesports.lk
VERCEL_TOKEN=<Vercel deployment token>
VERCEL_ORG_ID=<Vercel organization ID>
VERCEL_PROJECT_ID=<Vercel project ID>
```

The automatic workflows promote the exact successful upstream SHA: backend CD
uses the successful `CI` run's `main` commit, and frontend deployment uses the
successful backend CD run's same commit. A failed CI run prevents backend and
frontend deployment; a failed backend CD run prevents frontend deployment.
Both workflows retain manual dispatch for emergency/manual redeploys.

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

If a deployment reports that the production mobile OAuth redirect is stale or missing, manually dispatch `CD` with `repair_mobile_oauth_redirect=true`. The repair derives the required `/mobile-admin-oauth` App Link from the existing HTTPS `API_PUBLIC_URL`, adds or updates the entry while refusing duplicates, preserves `.env` permissions, and does not print environment values.

Store the SHA-256 fingerprint verified from a signed Quest Admin APK as the production environment secret `MOBILE_ADMIN_ANDROID_CERT_SHA256`. If the VPS value is stale or missing, manually dispatch `CD` with `repair_mobile_android_fingerprint=true`. The repair validates the secret format, adds or updates exactly one environment entry, preserves `.env` permissions, and never prints the fingerprint or environment contents.

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
    http://127.0.0.1:5001/api/health/live >/dev/null; then
    HEALTHY=true
    break
  fi
  sleep 2
done

[ "$HEALTHY" = true ] || rollback_to_root

READY=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent --show-error --max-time 5 \
    http://127.0.0.1:5001/api/health/ready >/dev/null; then
    READY=true
    break
  fi
  sleep 2
done

[ "$READY" = true ] || rollback_to_root
pm2 delete quest-backend
pm2 save --force
```

Only after both liveness and a `200` readiness response (database and storage
available, plus clustered realtime when enabled) pass should the old root entry
be removed. During maintenance,
readiness intentionally returns `503`; this procedure therefore rolls back to
the root-owned process instead of claiming a safe handover. Then install the
`deploy` systemd unit, stop the manually started deploy daemon once, and let
systemd resurrect the saved list:

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
3. After CI succeeds, automatic backend CD deploys the exact successful CI commit SHA.
4. CD pauses for approval before its first step. Open `Actions -> the CD run -> Review deployments`, tick **Production**, and approve. This is the `Production` environment's required-reviewer rule, so it applies to every backend deployment, not only migrations, and needs nothing set up per release. A pending deployment shows as `Waiting`.

   Destructive or backward-incompatible migrations additionally require the `BACKEND_DESTRUCTIVE_MIGRATION_APPROVAL_SHA` secret to equal the exact 40-character deploying commit SHA. One click approves a deployment; dropping a column deserves a second, deliberate act that names the commit. Set it on the **`Production` environment**, not repository secrets — the `backend-deploy` job declares `environment: production`, and an environment secret of the same name overrides the repository one, so with both present the repository value is never read and editing it appears to do nothing. A populated value logs as `***`; an empty one logs as blank, which is the quickest way to tell whether CD received it. That SHA must match the commit being deployed, so any push to `main` between setting it and deploying invalidates it.

   When migrations are pending, CD creates an encrypted off-site backup before applying them.
5. CD installs backend dependencies, generates Prisma, lints, applies production migrations, verifies RLS/Data API privileges, restarts PM2, checks health plus public tournament/product/capability reads, and saves the process list.
6. After backend CD succeeds, automatic frontend deployment promotes that same exact SHA after validating the successful CI run and live API compatibility.

Emergency/manual redeploy: GitHub `Actions -> CD -> Run workflow` or `Actions -> Deploy frontend -> Run workflow`. Each manual job redeploys the exact supplied commit and refuses to continue unless the required successful upstream checks pass. The CD workflow does not enforce that a manually dispatched ref is `main`; dispatch from `main` to preserve the documented main-only promotion intent.

The `repair_database_ssl` input is a narrowly scoped recovery option for an older VPS `.env` whose `DATABASE_URL` or `DIRECT_URL` predates the explicit TLS requirement. It updates only those two URL entries to `sslmode=require`, preserves `.env` permissions, and never prints credentials. Leave it disabled during normal deployments. After a successful repair deployment, future deployments validate the stored values without changing them.

For a confirmed missing-file incident affecting packaged legacy posters, enable
the `repair_legacy_media` workflow input. The deployment then runs the idempotent
legacy import after creating and verifying an encrypted off-site backup and
checking database security. It restores missing packaged files, links posters to
the oldest matching image records, removes importer-created duplicate image
records, and leaves healthy files alone.

The deployment refuses root SSH users, dirty tracked worktrees, insecure `.env` permissions, and unpinned SSH hosts.

## Rollback Semantics

If install, restart, or health validation fails, CD checks out the previous application commit, reinstalls its dependencies, regenerates Prisma, and restarts PM2. Database migrations are not reversed. Every production migration must therefore remain backward-compatible with the previous application release (expand first; contract later).

Never rely on a Free-plan Supabase dashboard backup. Confirm that the encrypted database-and-upload archive exists off-site before approving a migration. Clear `BACKEND_DESTRUCTIVE_MIGRATION_APPROVAL_SHA` from the `Production` environment after the deployment; while it still equals a commit SHA, the destructive gate is disarmed for that commit. The ordinary migration approval needs no cleanup — the required reviewer applies to every run.

Confirm the backup in the deployment log before the migration applies. A successful run prints `Encrypted production backup uploaded successfully: quest-production-<timestamp>.tar.gz.enc` immediately before the first `Applying migration` line. The backup and the approval check share one condition, so a deployment with nothing pending performs neither — `No pending database migrations` means the run changed no schema, not that it backed up and found nothing to do.

## Site Maintenance Mode

Use maintenance mode when visitors should temporarily see a branded maintenance page and normal API traffic should be refused. The frontend responds with `503`, `Retry-After`, `Cache-Control: no-store`, and crawler `noindex` headers. The backend returns a structured `SITE_MAINTENANCE` `503` response. `/api/health/live` remains available, readiness returns the intentional `503`, and the exact `POST /api/payments/payhere/notify` callback remains available so a payment already started before the window can settle.

The three values must match in the Vercel Production environment and `/var/www/QuestEsports/backend/.env`:

```env
SITE_MAINTENANCE_MODE=false
SITE_MAINTENANCE_MESSAGE=We’re carrying out scheduled maintenance. Please try again shortly.
SITE_MAINTENANCE_RETRY_AFTER_SECONDS=900
```

The message is limited to 240 characters. The retry window is an integer from 1 to 86400 seconds. Invalid values fail frontend builds or backend startup instead of silently choosing an unsafe state. `COMMERCE_MAINTENANCE_ENABLED` is unrelated: it controls scheduled commerce cleanup jobs, not visitor maintenance mode.

### Enable maintenance safely

1. Announce the window. Confirm the latest scheduled backup succeeded; create a manual full backup first if the work can change data.
2. In Vercel, set the three variables for the **Production** environment with `SITE_MAINTENANCE_MODE=true`, then redeploy the current approved `main` commit. Enable the frontend first so visitors see the maintenance page before API access is restricted.
3. On the VPS, edit the backend environment without printing it:

   ```bash
   sudo -u deploy -H nano /var/www/QuestEsports/backend/.env
   sudo -u deploy -H pm2 restart quest-backend --update-env
   sudo -u deploy -H pm2 save
   ```

4. Verify the expected behavior:

   ```bash
   curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://questesports.lk/
   curl --fail --silent --show-error https://api.questesports.lk/api/health/live
   curl --silent --show-error --dump-header - https://api.questesports.lk/api/health/ready
   curl --silent --show-error --dump-header - https://api.questesports.lk/api/tournaments
   ```

   Expected: frontend `503`; liveness `200` with `maintenance.enabled=true`; readiness and ordinary API requests `503` with `X-Maintenance-Mode: active` and `Retry-After`.

CD uses liveness to confirm that PM2 restarted and recognizes the explicit maintenance header on readiness, so an intentional maintenance window does not trigger a false rollback.

### Disable maintenance safely

1. Finish and verify the backend work while the page remains in maintenance.
2. Set `SITE_MAINTENANCE_MODE=false` in the VPS backend `.env`, restart with `--update-env`, and confirm readiness is `200`.
3. Set `SITE_MAINTENANCE_MODE=false` in Vercel Production and redeploy the same approved commit. Disable the frontend last so users cannot return before the API is ready.
4. Run the normal production smoke checks and watch PM2 logs.

### Coordinated write-freeze validation mode

`SITE_MAINTENANCE_MODE` is not a database write freeze. For a migration or
other operation that requires zero application writers, set the backend
`WRITE_FREEZE_MODE=validation` and restart the API. In this mode the API still
initializes its database connection and HTTP server, but rejects all mutation
methods and inbound callbacks with `503`, `Retry-After`, and
`X-Write-Freeze: validation`. All Quest workers and schedulers are disabled.

Verify the acknowledgement before running read-only migration validation:

```bash
curl --fail --silent --show-error https://api.questesports.lk/api/health/write-freeze
curl --silent --show-error --dump-header - \
  -X POST https://api.questesports.lk/api/v1/example-mutation
```

The status response must be exactly equivalent to
`{"mode":"validation","writersEnabled":false}` (JSON key order may vary),
and mutation attempts must return `503` with the freeze header. Keep this mode
active until validation is complete and the migration operator is ready to
resume writers. Set `WRITE_FREEZE_MODE=off`, restart the API, and verify the
status response reports `writersEnabled: true` before resuming normal traffic.

### Full stop and write-freeze warning

The coordinated validation mode blocks Quest HTTP and callback writers and
stops Quest workers, but it does not replace the full-stop procedure when the
database itself must be isolated. For a database restore, suspected
compromise, or any operation requiring the backend to be unavailable, follow
the disaster-recovery procedure and stop the backend:

```bash
sudo -u deploy -H pm2 stop quest-backend
```

Do not run `pm2 save` while it is stopped, or the stopped state can survive a reboot. For an emergency frontend-only notice, enable and redeploy the Vercel switch first. For an immediate API shutdown, stop PM2; the API will be unavailable rather than returning the branded maintenance response.

## Verification

Health endpoint semantics are fixed: `/api/health/live` is liveness only;
`/api/health` and `/api/health/ready` are readiness aliases that check the
database and storage, plus clustered realtime when enabled, and may return
`503` during maintenance or dependency failure. `/api/openapi.json` is the API
schema endpoint. During maintenance,
liveness remains available while both readiness aliases intentionally return
the maintenance `503`.

Run Linux commands from the VPS, not Windows PowerShell:

```bash
sudo -u deploy -H git -C /var/www/QuestEsports rev-parse --short HEAD
systemctl is-active pm2-deploy
sudo -u deploy -H pm2 list
curl --fail --silent --show-error http://127.0.0.1:5001/api/health/live
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

The complete backup and recovery procedure, including restore warnings, disaster scenarios, key loss, credential recovery, retention limitations, and the drill record template, is maintained in [Backup and Disaster Recovery](./backup-and-disaster-recovery.md). This section is the production quick reference.

The repository provides:

- `ops/backup-production.sh`
- `ops/restore-production-backup.sh`
- `ops/prune-production-backups.sh`
- `ops/notify-backup-failure.sh`
- `ops/check-backup-freshness.sh`
- `ops/create-secret-recovery-package.sh`
- `ops/systemd/quest-esports-backup.service`
- `ops/systemd/quest-esports-backup.timer`
- `ops/systemd/quest-esports-backup-failure@.service`
- `ops/systemd/quest-esports-backup-freshness.service`
- `ops/systemd/quest-esports-backup-freshness.timer`

The backup includes a portable custom-format dump of the application-owned PostgreSQL `public` and `valorant` schemas, public uploads, private payment evidence, and a manifest (which records `valorant_schema_included`). Supabase-managed schemas and extensions are intentionally excluded because they are provisioned by Supabase and prevent portable restores on ordinary PostgreSQL. The archive is encrypted with an offline `age` recipient before upload through `rclone`. Keep the `age` private identity off the production VPS.

Install the prerequisites and configuration:

```bash
sudo apt install -y postgresql-common rclone age rsync
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt install -y postgresql-client-17
sudo install -d -o deploy -g deploy -m 700 /srv/quest-esports/backups
sudo install -d -o deploy -g deploy -m 700 /srv/quest-esports/rclone
sudo install -o root -g deploy -m 640 ops/quest-esports-backup.env.example /etc/quest-esports-backup.env
sudo install -o deploy -g deploy -m 600 /path/to/verified-rclone.conf /srv/quest-esports/rclone/quest-esports.conf
sudo install -o root -g root -m 644 ops/systemd/quest-esports-backup.service /etc/systemd/system/
sudo install -o root -g root -m 644 ops/systemd/quest-esports-backup.timer /etc/systemd/system/
sudo install -o root -g root -m 644 ops/systemd/quest-esports-backup-failure@.service /etc/systemd/system/
sudo install -o root -g root -m 644 ops/systemd/quest-esports-backup-freshness.service /etc/systemd/system/
sudo install -o root -g root -m 644 ops/systemd/quest-esports-backup-freshness.timer /etc/systemd/system/
```

The PostgreSQL repository helper is provided by the PostgreSQL project and prompts before adding `apt.postgresql.org`. Confirm `/usr/lib/postgresql/17/bin/pg_dump --version` reports major version 17. Keep the mutable OAuth configuration under `/srv/quest-esports/rclone`: the systemd unit deliberately hides home directories and permits writes only under `/srv/quest-esports`, allowing rclone to persist token refreshes without broadening the service sandbox.

Use a dedicated Google Cloud project and OAuth desktop client for the Drive remote. Enable the Google Drive API, configure an External consent screen, add only the `drive.file` scope, create a Desktop client, and move the app to **In production** so refresh tokens do not inherit the seven-day Testing limit. Enter the client ID, client secret, and authorization token only through interactive `rclone config`; never print, commit, or copy the rclone configuration into documentation. Create and validate a second remote before changing `BACKUP_RCLONE_REMOTE`, so the existing remote remains an immediate rollback path.

Edit `/etc/quest-esports-backup.env` without printing its values. Set the Paris session-pooler `DIRECT_URL`, both upload roots, the offline `age` public recipient, `RCLONE_CONFIG=/srv/quest-esports/rclone/quest-esports.conf`, the active off-site `rclone` remote, `BACKUP_MAX_AGE_MINUTES=2160`, approved remote retention values, and the approved backup-failure webhook. Run the manual backup from an accessible working directory; launching `sudo -u deploy` while still in `/root` makes GNU `find` fail when it tries to restore that inaccessible working directory. Then verify the systemd service, test one failure notification, and enable both timers:

```bash
cd /var/www/QuestEsports
sudo -u deploy -H env BACKUP_ENV_FILE=/etc/quest-esports-backup.env bash ops/backup-production.sh
sudo systemctl daemon-reload
sudo systemctl start quest-esports-backup.service
systemctl show quest-esports-backup.service --property=Result,ExecMainStatus,ActiveState --no-pager
sudo -u deploy -H env BACKUP_ENV_FILE=/etc/quest-esports-backup.env bash ops/notify-backup-failure.sh operator-test
sudo -u deploy -H env BACKUP_ENV_FILE=/etc/quest-esports-backup.env bash ops/check-backup-freshness.sh
sudo systemctl start quest-esports-backup-freshness.service
sudo systemctl enable --now quest-esports-backup.timer quest-esports-backup-freshness.timer
systemctl list-timers quest-esports-backup.timer quest-esports-backup-freshness.timer --no-pager
journalctl -u quest-esports-backup.service --since today --no-pager
```

The backup is not considered successful until rclone content verification succeeds for both the encrypted archive and checksum on the off-site remote. Review retention first in dry-run mode with `ops/prune-production-backups.sh`; actual deletion additionally requires `RETENTION_CONFIRMATION=PRUNE_QUEST_PRODUCTION` and refuses to cross the configured minimum recovery-point floor. Follow [Secret and Infrastructure Recovery](./secret-and-infrastructure-recovery.md) for the separate environment/rclone/infrastructure package that the normal archive intentionally excludes.

The repository contains a historical record dated 2026-07-29 describing a
manual encrypted full backup, a restricted systemd service run, and the daily
timer as enabled. That record is not current runtime proof; the owner must
verify the archive, destination, and timer state before relying on them. The
record names `quest-production-20260729T133147Z.tar.gz.enc` on the historical
`quest-backups:quest-esports/production` destination.

The active destination was then documented as moved to the dedicated-client remote `quest-backups-custom:quest-esports-v2/production`. Manual archive `quest-production-20260729T154756Z.tar.gz.enc` and its checksum were documented as confirmed off-site, and a subsequent `quest-esports-backup.service` run was documented as returning `Result=success`, `ExecMainStatus=0`, and `ActiveState=inactive`. The daily timer was documented as enabled. These are historical records, not proof of current remote contents or timer state; the owner must verify them before relying on the destination.

### Local Paris database snapshot on Windows

For an immediate database-only snapshot from the secured development PC, run:

```powershell
cd D:\Work\Projects\QuestEsports
.\ops\backup-paris-database-windows.ps1
.\ops\test-paris-database-backup-windows.ps1
```

The first command reads the Paris `DIRECT_URL` without printing it, dumps only the application `public` schema, encrypts the result with the offline recovery recipient, writes a checksum, and removes plaintext staging data. The second command verifies the checksum and restores the latest archive into a disposable PostgreSQL 17 container. Files are stored under `D:\Work\QuestEsports-backups\paris-database` with restricted ACLs.

This Windows snapshot does not contain production VPS uploads and is not a substitute for the scheduled full VPS backup or its off-site copy.

### Restore drill

Download one encrypted archive and its checksum to an isolated recovery host that has the offline `age` identity. Restore into a disposable PostgreSQL instance and empty temporary upload directories first. The restore script requires the explicit `RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION` value because its database cleanup and file synchronization are destructive.

Run the restore script through Bash so it does not depend on a checkout retaining executable file modes:

```bash
RESTORE_CONFIRMATION=RESTORE_QUEST_PRODUCTION \
  BACKUP_ENV_FILE=/secure/recovery/quest-esports-recovery.env \
  bash ops/restore-production-backup.sh /absolute/path/to/quest-production-YYYYMMDDTHHMMSSZ.tar.gz.enc
```

Do not point a restore drill at Paris production. Record the archive timestamp, restored table counts, sample asset checks, and elapsed recovery time. Run a drill after setup and at least quarterly.

The repository contains a historical record describing a full drill dated
2026-07-29 using `quest-production-20260729T133809Z.tar.gz.enc`. It records a
matching checksum, PostgreSQL 17 restoring 35 public tables and 33 completed
migration records, and SHA-256 matches for 41 public and 10 private restored
files. The record also describes a corrected `pg_restore --dbname` option.
This is not current recovery proof; the owner must verify the record and repeat
an isolated drill before treating recovery as proven.

The repository contains a historical record dated 2026-07-29 describing the
retiring shared-client risk as closed and the active remote as using the
QuestEsports-owned Google OAuth desktop client, `drive.file`, and an app
publishing status of **In production**. It also records a manual
archive/checksum upload and restricted systemd service run after the switch.
These records are not current proof of remote, token, or service state; the
owner must verify them before relying on the destination.

### Supabase Data API

The application uses Prisma, not the Supabase Data API. Disable Data API for the Paris project in Supabase Dashboard. The database migration also enables RLS and revokes table privileges from `anon`, `authenticated`, and `service_role`; `npm run prisma:security:verify` enforces that state during CI and deployment.

## External-Service Readiness

- Resend requires a verified sending domain for normal application recipients. If switching back, Amazon SES sandbox delivery remains restricted to verified recipients. Production startup always requires complete configuration for the selected provider while password authentication is enabled.
- PayHere may remain completely unconfigured. Free registrations and bank-transfer tournaments continue to work; PayHere tournament checkout and merchandise checkout remain unavailable until all PayHere values are configured.
- Vercel automatic production deployment is disabled. The protected `Deploy frontend` workflow promotes an exact CI-passed `main` SHA only after `/api/capabilities` confirms the compatible backend is live.
- The sitemap and crawler configuration are managed by the frontend deploy. After public-route or metadata changes, follow [Google Search Console and Sitemap Operations](./search-console-and-sitemap.md) and confirm the existing Search Console submission remains healthy.
