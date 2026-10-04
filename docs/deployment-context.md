# Deployment Context Handoff

This is a concise operator handoff for VPS access and GitHub production deployment. Values are intentionally omitted.

## Authoritative deployment chain

The only production path is:

```text
main CI + secret scan
  -> immutable image build, Cosign signing, and BuildKit/SBOM attestation
  -> Deploy immutable Compose release workflow
  -> protected production-compose approval
  -> pinned SSH to the restricted deploy user
  -> root-owned /usr/local/sbin/quest-esports-release
  -> host health, security, backup, and migration checks
```

The release is an exact full 40-character commit SHA. The VPS does not check out source, build images, or run npm. The controller stages the verified digest-pinned manifest, runs the configured checks, applies pending migrations when its approval and backup gates pass, and switches the release only after readiness succeeds.

## Read these repository paths

| Need | Paths |
| --- | --- |
| VPS access and host contract | `docs/production-runbook.md`, `docs/setup-and-deployment.md`, `ops/deploy/release.env.example` |
| Deployment and CI authority | `docs/ci-cd.md`, `.github/workflows/ci.yml`, `.github/workflows/secret-scan.yml`, `.github/workflows/build-container-images.yml`, `.github/workflows/deploy-compose.yml` |
| Release verification and host hooks | `ops/deploy/release.sh`, `ops/deploy/validate-host.sh`, `ops/deploy/verify-release.sh`, `ops/deploy/host-hooks.sh`, `ops/deploy/host-hooks.aliases` |
| Rollback | `ops/deploy/rollback.sh`, `docs/production-runbook.md` (rollback semantics), `docs/backup-and-disaster-recovery.md` (post-first-write recovery) |
| Backup and recovery | `docs/backup-and-disaster-recovery.md`, `docs/secret-and-infrastructure-recovery.md`, `ops/quest-esports-backup.env.example`, `ops/backup-production.sh`, `ops/check-backup-freshness.sh`, `ops/restore-production-backup.sh` |
| Backup service installation | `ops/systemd/quest-esports-backup.service`, `ops/systemd/quest-esports-backup.timer`, `ops/systemd/quest-esports-backup-freshness.service`, `ops/systemd/quest-esports-backup-freshness.timer` |
| Environment classification | `docs/environment-reference.md` |

On the VPS, the operator should expect the fixed release controller at `/usr/local/sbin/quest-esports-release`, a root-owned `/etc/quest-esports/release.env`, release directories below `/opt/quest-esports`, and protected runtime/backup environment files outside Git. Confirm live ownership, permissions, host identity, service state, and installed script versions; checked-in paths alone are not live evidence.

## GitHub Actions production configuration

Names only are listed here; never record their values in this document.

### Protected `production-compose` environment secrets

- `BACKEND_SSH_HOST`
- `BACKEND_SSH_PORT`
- `BACKEND_SSH_USER`
- `BACKEND_SSH_PRIVATE_KEY`
- `BACKEND_SSH_HOST_KEY`

The user must be the restricted deployment account, not root. The private key is used only by the runner; the host key is the pinned `known_hosts` entry. `GITHUB_TOKEN` is an automatically provided Actions token, not an operator-managed production secret.

### Repository variables

- `PRODUCTION_DEPLOYMENT_MODE`
- `COMPOSE_DEPLOY_ENABLED`

Production Compose is enabled only when these are `compose` and `true`, respectively. The deployment actor must be the repository owner.

### Environment variables

The `container-image-build` environment supplies:

- `PRODUCTION_API_URL`
- `PRODUCTION_SITE_URL`
- `POSTGRES_17_BOOKWORM_DIGEST`
- `POSTGRES_IMAGE_APPROVED_REF`

The protected `production-compose` environment must also supply `POSTGRES_IMAGE_APPROVED_REF` with the same exact approved PostgreSQL reference used by the manifest. `rollback_sha` is a workflow-dispatch input, not a secret or variable; when used, it must be a successful full SHA from `main` with a valid unexpired manifest.

## Where configuration belongs

| Location | Put there | Do not put there |
| --- | --- | --- |
| GitHub Actions secrets | The five `production-compose` SSH names above; only other workflow-specific secrets when that workflow explicitly requires them | VPS runtime `.env` contents, database passwords, TLS keys, age identities, rclone configs, or private keys in notes/logs |
| GitHub repository/environment variables | Deployment mode gates and non-secret build/deployment inputs listed above | Credentials or secret-bearing URLs |
| VPS | Root-controlled `/etc/quest-esports/release.env`; runtime env files; protected database/migrator/recovery files; TLS and backup client material; installed root-owned wrappers; backup/rclone configuration with documented ownership and modes | Source checkout changes as a deployment mechanism, ad hoc root SSH releases, or public database exposure |
| Local ignored `.env` files | Development/test values in ignored files such as `backend/.env`, `frontend/.env.local`, and `mobile-admin/.env.local` | Committing them, uploading them, or treating them as the VPS production source of truth |
| Offline/recovery custody | The private age identity (at least two controlled offline copies), recovery package/checksum, provider recovery inventory/codes, and approved recovery credentials | The private age identity on the VPS, in Git, chat, email, ordinary cloud sync, or the normal backup archive |

Repository reconnaissance found no private-key files or credential values. Local ignored environment files may still contain secrets and must be handled separately.

## Safe operator snippets

Replace every angle-bracket placeholder before use. These commands list names only and do not request or print secret values.

### List GitHub secret and variable names — PowerShell

```powershell
$repo = '<OWNER>/<REPO>'

gh secret list --repo $repo --env production-compose --json name --jq '.[].name'
gh variable list --repo $repo --json name --jq '.[].name'
gh variable list --repo $repo --env container-image-build --json name --jq '.[].name'
gh variable list --repo $repo --env production-compose --json name --jq '.[].name'
```

### List GitHub secret and variable names — POSIX shell

```sh
repo='<OWNER>/<REPO>'

gh secret list --repo "$repo" --env production-compose --json name --jq '.[].name'
gh variable list --repo "$repo" --json name --jq '.[].name'
gh variable list --repo "$repo" --env container-image-build --json name --jq '.[].name'
gh variable list --repo "$repo" --env production-compose --json name --jq '.[].name'
```

### Set/update GitHub secrets from local files — PowerShell

Each local file below must contain only the intended value. The pipeline sends it to GitHub Actions and does not display it.

```powershell
$repo = '<OWNER>/<REPO>'
$environment = 'production-compose'

Get-Content -Raw -LiteralPath '<PATH_TO_VPS_HOST_FILE>' |
  gh secret set BACKEND_SSH_HOST --repo $repo --env $environment
Get-Content -Raw -LiteralPath '<PATH_TO_SSH_PORT_FILE>' |
  gh secret set BACKEND_SSH_PORT --repo $repo --env $environment
Get-Content -Raw -LiteralPath '<PATH_TO_SSH_USER_FILE>' |
  gh secret set BACKEND_SSH_USER --repo $repo --env $environment
Get-Content -Raw -LiteralPath '<PATH_TO_PRIVATE_KEY>' |
  gh secret set BACKEND_SSH_PRIVATE_KEY --repo $repo --env $environment
Get-Content -Raw -LiteralPath '<PATH_TO_KNOWN_HOSTS>' |
  gh secret set BACKEND_SSH_HOST_KEY --repo $repo --env $environment
```

### Set/update GitHub secrets from local files — POSIX shell

```sh
repo='<OWNER>/<REPO>'
environment='production-compose'

gh secret set BACKEND_SSH_HOST --repo "$repo" --env "$environment" < '<PATH_TO_VPS_HOST_FILE>'
gh secret set BACKEND_SSH_PORT --repo "$repo" --env "$environment" < '<PATH_TO_SSH_PORT_FILE>'
gh secret set BACKEND_SSH_USER --repo "$repo" --env "$environment" < '<PATH_TO_SSH_USER_FILE>'
gh secret set BACKEND_SSH_PRIVATE_KEY --repo "$repo" --env "$environment" < '<PATH_TO_PRIVATE_KEY>'
gh secret set BACKEND_SSH_HOST_KEY --repo "$repo" --env "$environment" < '<PATH_TO_KNOWN_HOSTS>'
```

For variables, use the same file-fed form with `gh variable set`, omitting `--env` for repository variables and using `--env container-image-build` or `--env production-compose` for environment variables. Do not use `gh secret list`, shell tracing, `cat`, or diagnostic output to expose values.

### Test SSH with placeholders

These tests print only a fixed success marker. Use the pinned known-hosts file; do not disable host-key checking.

PowerShell:

```powershell
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile='<PATH_TO_KNOWN_HOSTS>' -o GlobalKnownHostsFile=NUL -i '<PATH_TO_PRIVATE_KEY>' -p '<SSH_PORT>' '<SSH_USER>@<VPS_HOST>' 'printf "ssh-ok\n"'
```

POSIX shell:

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile='<PATH_TO_KNOWN_HOSTS>' -o GlobalKnownHostsFile=/dev/null -i '<PATH_TO_PRIVATE_KEY>' -p '<SSH_PORT>' '<SSH_USER>@<VPS_HOST>' 'printf "ssh-ok\n"'
```

## Known from the deployment chat

Historical chat context only; verify all items against current GitHub Actions and VPS evidence:

- Last reported deployed SHA: `5d196a40` (historical identifier; verify the current full 40-character release SHA).
- Migration ledger moved from `82` to `83`, including `support_message_attachments`.
- Deployment approvals were reported cleared.
- The age identity was reported shredded from the host.

No backup archive names, credential values, host values, fingerprints, webhook URLs, or private-key contents belong in this handoff.

## Preflight checklist

- [ ] Confirm the intended full 40-character SHA, successful `main` CI, secret scan, image build, signature, provenance, SBOM, and unexpired manifest.
- [ ] Confirm the workflow is the active `.github/workflows/deploy-compose.yml`; do not use retired PM2, Vercel, or Supabase deployment paths.
- [ ] Confirm `PRODUCTION_DEPLOYMENT_MODE`, `COMPOSE_DEPLOY_ENABLED`, and the PostgreSQL pins exist in the correct repository/environment scopes.
- [ ] Confirm the `production-compose` reviewer approval is required and has been deliberately granted for this exact release.
- [ ] Confirm pinned SSH host verification, the restricted SSH user, the narrow sudo rule, and matching root-owned controller/host-hook installations on the VPS.
- [ ] Confirm backup freshness, a complete encrypted archive plus matching checksum, remote verification, and recovery custody before a migration or destructive change.
- [ ] Confirm pending migrations have the required release-bound approval and backup evidence. Migration rollback is not automatic; application rollback does not reverse database migrations.
- [ ] After release, confirm database readiness, application liveness/readiness, security verification, migration status, Compose state, and release evidence without printing protected environment contents.

## Warnings

- Never commit `.env` files, SSH keys, age material, rclone configuration, database credentials, or TLS material.
- Do not paste private keys, secret values, credential-bearing URLs, webhook URLs, or archive names into chat, issues, logs, or documents.
- Deployments are exact-SHA and gated; do not deploy mutable tags or bypass the protected approval.
- Do not use retired PM2/Vercel/Supabase paths as current production deployment or rollback mechanisms.
- A failed application release may select an already-built exact-SHA release, but database migrations are one-way unless a separately approved recovery restores data.
