# Secret and Infrastructure Recovery

Last reviewed: July 29, 2026

The normal production backup contains the application database and both upload trees. It intentionally does not contain the credentials and control-plane configuration needed to rebuild the complete service. This runbook covers that separate recovery set without placing any secret in Git, chat, tickets, email, or ordinary cloud-synced storage.

## Recovery set

The guarded `ops/create-secret-recovery-package.sh` script allowlists these required files from the VPS:

- `/var/www/QuestEsports/backend/.env`
- `/srv/quest-esports/rclone/quest-esports.conf`
- `/etc/quest-esports-backup.env`

The scheduled backup TLS client CA, certificate, and key are provisioned
separately at `/etc/quest-esports-backup/backup-client-ca.crt` and
`backup-client.{crt,key}` as `root:deploy` mode `0640`; they are not the
PostgreSQL server TLS files under `/etc/quest-esports/tls`. Reissue or transfer
these files through the approved infrastructure-secret channel rather than
putting them in the encrypted package or repository.

It also includes the recognized Nginx site, installed QuestEsports backup systemd units, and the `deploy` user's PM2 dump when present. The private `age` identity is deliberately excluded.

The package does not export configuration held only by Supabase, Vercel, GitHub, the DNS registrar, Google Cloud, the mail provider, PayHere, the VPS provider, or a firewall control panel. Maintain a non-secret recovery inventory that names each owner/account, MFA method, recovery-code custodian, project identifier, region, DNS zone, domain, and support route. Store provider recovery codes separately from the package.

## Create the encrypted package

Use an offline `age` identity dedicated to infrastructure recovery. Keep at least two controlled copies of its private key. Only its public `age1...` recipient may be present in the VPS shell.

Run as root from the repository. The output path must be a temporary, access-controlled staging directory and must not be a public/private upload directory:

```bash
cd /var/www/QuestEsports

read -r -p "Paste the public infrastructure-recovery age recipient: " RECOVERY_AGE_RECIPIENT
export RECOVERY_AGE_RECIPIENT

RECOVERY_PACKAGE_CONFIRMATION=PACKAGE_QUEST_SECRETS \
  bash ops/create-secret-recovery-package.sh \
  /srv/quest-esports/recovery-staging

unset RECOVERY_AGE_RECIPIENT
```

Copy the resulting `.tar.gz.age` file and its `.sha256` sibling to the approved recovery vault. The vault must be separate from the production VPS and normal Google Drive backup destination. After verifying the copy, securely remove the staging files from the VPS according to the host's storage capabilities and record the package timestamp and custodian.

## Verify recovery without exposing values

At least quarterly and after credential or infrastructure changes, use an isolated recovery machine:

1. Retrieve one encrypted package, checksum, and the offline private identity through their separately controlled paths.
2. Verify the SHA-256 checksum before decryption.
3. Decrypt only into an encrypted temporary workspace with restrictive permissions.
4. List archive paths and confirm all three required files and `recovery-manifest.txt` exist. Do not print file contents into a terminal recording or support log.
5. Confirm the backend environment contains every required variable name using a key-name-only script. Confirm rclone can authenticate only on a disposable/recovery host if the drill authorizes a live read.
6. Compare the control-plane inventory with Supabase, Vercel, GitHub, DNS, Google Cloud, mail, PayHere, and VPS ownership. Never paste credentials into the drill record.
7. Destroy the plaintext extraction, recovery-only tokens, and temporary host. Keep a record of date, package timestamp, checksum result, missing key names, operator, elapsed time, and corrective actions.

A package is not considered verified merely because it exists or decrypts. The drill must establish that authorized operators can retrieve it without depending on the failed VPS or the normal backup Drive account.

## Restore order after total environment loss

1. Secure the incident, provider accounts, domain, and source repository.
2. Recover the offline identities and the newest verified database/upload archive plus checksum.
3. Build a replacement Paris-compatible database and French VPS without admitting public writes.
4. Restore the application database and upload trees using [Backup and Disaster Recovery](./backup-and-disaster-recovery.md).
5. Retrieve and decrypt the secret recovery package on the controlled recovery host, then transfer only the required files over an authenticated channel with restrictive ownership and modes.
6. Recreate Nginx/TLS, the separate PostgreSQL server TLS hierarchy, the
   deploy-traversable backup client TLS hierarchy, PM2, systemd, firewall, DNS,
   GitHub/Vercel, Supabase, mail, payment, and monitoring settings from the
   inventory. Reissue TLS rather than preserving old private certificate keys.
7. Rotate database passwords, API keys, OAuth tokens, webhook secrets, session/encryption material where data compatibility permits, and any credential suspected of exposure. Follow the documented compatibility procedure before changing `AUTH_ENCRYPTION_KEY` because it protects stored encrypted data.
8. Run migrations, the database security verifier, readiness checks, public smoke checks, authentication, mail/payment tests, backup, failure-notification test, and an immediate new recovery package.

## Credential exposure response

- OAuth refresh/access tokens shown in chat, logs, screenshots, or terminals must be revoked at the provider and the rclone remote re-authorized. Editing a message is not a revocation.
- A downloaded Google OAuth client JSON is a secret-bearing artifact. After rclone is configured and tested, move it into the approved vault or securely delete it; rotate the client secret if it was exposed.
- Never use `rclone config show` in captured output. The protected rclone configuration contains reusable OAuth material.
- Never store either private `age` identity on the production VPS or inside the package it decrypts.

## Drill record

```text
Date/time:
Operator and approver:
Encrypted package timestamp:
Checksum verified:
Required paths present:
Required environment key names present:
Control-plane inventory checked:
Recovery independent of VPS/backup Drive account:
Plaintext cleanup completed:
Credential rotations required:
Elapsed time:
Findings and owner:
Next drill due:
```
