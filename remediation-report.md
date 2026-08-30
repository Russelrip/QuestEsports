# Focused remediation report

Date: 2026-08-30

## Findings remediated

1. Scheduled backup TLS client material now lives at
   `/etc/quest-esports-backup`, a dedicated `root:deploy` `0750` directory.
   The certificate and key remain separate from the PostgreSQL server TLS tree
   and are required to be `root:deploy` `0640`. The backup script and host
   validator reject a missing, symlinked, incorrectly permissioned, or
   non-canonical production hierarchy. Fixtures use placeholder material only.
2. Rendered VALORANT Compose validation now requires the exact normalized alias
   set `valorant-platform`, `valorant-updater`, `valorant-discord-bot`, and
   `valorant-name-audit`, in addition to the existing private network, exact
   image, TLS environment, env-file, and CA-mount checks. The existing
   `--no-env-resolution`, mode-`0600` temporary files, and quiet command
   boundaries remain unchanged. Missing and altered alias fixtures are covered.

## Exact validation output

```text
backend focused: 23 tests, 23 passed, 0 failed
frontend unit: 46 test files passed, 294 tests passed
backend full (dummy disposable DATABASE_URL): 1136 tests, 1125 passed, 0 failed, 11 skipped
backend lint: passed; 1 pre-existing warning in tests/production-container-config.test.js:1222:13
frontend typecheck: passed
frontend lint: passed
shell syntax: passed
backup-multi-remote fixture: backup multi-remote fixture tests passed
media-backup-contract fixture: media backup contract fixture tests passed
git diff --check: passed
YAML parse: {'quest-shared': {'aliases': ['valorant-platform', 'valorant-updater', 'valorant-discord-bot', 'valorant-name-audit']}}
Compose check: unknown flag: --no-env-resolution
```

The full `ops/tests/deploy-release.test.sh` suite was attempted through Git
Bash but exceeded the Windows command timeout without a deterministic result.
The WSL `/bin/bash` entry point was unavailable; Git Bash was used for the
focused shell fixtures and syntax checks.

## Self-review

- Server PostgreSQL TLS paths and UID `999` ownership contracts were not
  changed.
- No secret values, production files, VPS state, remote state, or secret-bearing
  command arguments were introduced.
- The local Docker Compose binary does not support the required
  `--no-env-resolution` option, so no claim is made that a live rendered
  Compose check passed.
- Image checks remain exact digest-shape/fixture checks here; the pinned image
  was not pulled or registry-verified from this Windows environment.
