# Focused remediation report

Date: 2026-08-30

## Findings remediated

1. Scheduled backup TLS client material now lives at
   `/etc/quest-esports-backup`, a dedicated `root:deploy` `0750` directory.
   The backup client CA, certificate, and key remain separate from the
   PostgreSQL server TLS tree and are required to be `root:deploy` `0640`.
   `POSTGRES_CA_FILE` now points to `backup-client-ca.crt`; the backup script
   and host validator reject missing, symlinked, incorrectly permissioned, or
   non-canonical production material. Fixtures use placeholder material only
   and keep recovery/server CA material separate.
2. PostgreSQL server documentation, Compose, host validation, and the
   readability fixture now agree on the pinned image's `999:999` contract:
   password, server certificate, and server key are `root:999` mode `0640`,
   while the server CA remains `root:root` mode `0644`. The disposable fixture
   runs the exact image as UID/GID `999:999` and checks readability and modes
   without exposing contents.
3. Rendered VALORANT Compose validation now requires the exact normalized alias
   set `valorant-platform`, `valorant-updater`, `valorant-discord-bot`, and
   `valorant-name-audit`, in addition to the existing private network, exact
   image, TLS environment, env-file, and CA-mount checks. The existing
   `--no-env-resolution`, mode-`0600` temporary files, and quiet command
   boundaries remain unchanged. Missing and altered alias fixtures are covered.

## Exact validation output

```text
backend backup/config: 10 tests, 10 passed, 0 failed
backend full: 1137 tests, 1126 passed, 0 failed, 11 skipped
frontend unit: 46 test files passed, 294 tests passed
backend lint: passed; 1 warning in tests/production-container-config.test.js:1222:13
frontend typecheck: passed
frontend lint: passed
shell syntax: passed (23 files; explicit Git Bash)
backup-multi-remote fixture: backup multi-remote fixture tests passed
media-backup-contract fixture: media backup contract fixture tests passed
backup/config/documentation contracts: passed
deploy-release fixture: timed out after 90 seconds under Windows Git Bash
PostgreSQL UID/GID 999 readability fixture: SKIP: pinned PostgreSQL 17 image is not available locally; readability fixture not run.
git diff --check: passed
YAML parse: passed: 3 Compose files
Compose version: Docker Compose v2.34.0-desktop.1
Compose no-env-resolution check: unknown flag: --no-env-resolution
Compose render: failed on Windows because `/etc/quest-esports/quest.production.env` was resolved as a project-relative path and is absent
```

The default WSL `/bin/bash` entry point was unavailable; explicit Git Bash was
used for the focused shell fixtures and syntax checks. The pinned PostgreSQL
image was not pulled or registry-verified from this Windows environment.

## Self-review

- Server PostgreSQL TLS paths and UID `999` ownership contracts remain
  unchanged in Compose and host validation; only the contradictory README
  installation contract was corrected.
- The scheduled backup CA is now explicitly client-side material under the
  deploy-traversable hierarchy; it is not a server CA bind mount.
- No secret values, production files, VPS state, remote state, or secret-bearing
  command arguments were introduced.
- Docker Desktop is available, but Windows Compose cannot render the Linux
  absolute production env-file mount from this checkout; no live stack was
  started.
- Image checks remain exact digest-shape/fixture checks here; the pinned image
  was not pulled or registry-verified from this Windows environment.
