# Quest E-sports Project Audit and Remediation Status

Last reviewed: July 29, 2026

## Executive summary

The repository is release-candidate healthy: no unresolved Critical code defect was found, production dependency audits are clean, and the current backend/frontend automated checks pass. This remediation hardens transactional restore behavior, backup consistency and verification, MFA enrollment, session parsing/races, order-capability privacy, upload cleanup, storage readiness, public-data caching, performance budgets, and recovery operations.

Repository completion is not the same as live production completion. The latest changes still need to pass CI/CD, be deployed to the French VPS/Vercel, have the updated systemd units and protected backup settings installed, and be verified through the external actions below.

## Current local verification

| Check | Result |
| --- | --- |
| Backend lint | Passed |
| Backend unit/service tests | 181 passed; 2 real-database tests skip unless `RUN_DATABASE_INTEGRATION_TESTS=true` |
| Backend aggregate coverage | 66.60% lines; 60.07% branches; 69.37% functions; configured gates pass |
| Backend production dependency audit | 0 known vulnerabilities |
| Frontend lint | Passed |
| Frontend unit tests | 17 passed |
| Frontend Chromium E2E | 13 passed, including fragment/header order-capability privacy |
| Frontend production build and TypeScript | Passed on Next.js 16.2.11 |
| Frontend production dependency audit | 0 known vulnerabilities |
| Frontend full development audit | 9 High advisories in lint-only dependency metadata; patched `brace-expansion` releases are installed |
| Backup/restore regression tests | Passed, including restore ordering/transaction and backup lock/two-pass snapshot assertions |

The checked-in Node requirement and CI use Node 24. The current Windows shell uses Node 22.15.0, so engine warnings on the workstation are expected; release authority belongs to the Node 24 CI result.

## Remediated findings

### Backup and restore safety

- The backup refuses overlap with `flock`.
- Public/private immutable upload trees are copied before and after the PostgreSQL dump and the archive is built from that staging snapshot.
- `rclone check` verifies the uploaded archive and checksum content, not only the presence of object names.
- Restore validates commands, identity, checksum, archive paths, manifest, dump readability, target paths, and complete staged upload trees before changing the database.
- PostgreSQL restore uses `--single-transaction` with error-stop behavior.
- File trees are activated by same-filesystem directory renames under an exit guard before the single-transaction database restore. A restore failure rolls both file trees back; after success, previous trees are retained and printed for inspection/manual rollback.
- Guarded pair-aware remote retention, local-checksum/off-site freshness monitoring, backup-failure/staleness webhook notification, and separately encrypted secret/infrastructure packaging tools are included.

### Authentication and sessions

- Starting MFA enrollment is now a rate-limited `POST` that verifies the current password before revealing a raw authenticator secret.
- OAuth-created users without a known local password must use password reset before enrollment.
- Malformed percent-encoded cookies are ignored instead of producing a server error.
- Stale session `lastSeenAt` refresh uses a conditional `updateMany`, avoiding a `P2025` race when another request revokes the session.
- Expired-session cleanup failures are logged.

### Commerce privacy and cleanup

- Public order lookup finds the capability first and expires only that matching stale order; arbitrary traffic no longer invokes global cleanup.
- New order links keep the bearer capability in `/shop/order#token=...`; fragments are not sent in HTTP request lines. Order/payment reads carry it in `X-Order-Token` instead of paths or queries, while old path links remain redirect-only compatibility routes.
- Backend logging still redacts legacy capability segments. The order page uses `no-referrer`; Vercel Analytics and Speed Insights are not initialized on order routes, and analytics has a second URL-redaction layer.
- File cleanup failures use the durable cleanup queue. Schedule uploads are registered for rollback before spreadsheet parsing, eliminating a parse-failure orphan.
- Bank-proof retention keeps its database record when file removal fails, while logging/queueing the retry.

### Reliability and performance

- Readiness now proves that both durable roots can create and remove a file, with a short success cache to avoid unnecessary disk churn.
- Public tournament data revalidates every 15 seconds, product data every 60 seconds, and rulebooks every 300 seconds; private order reads remain uncached.
- The browser performance script has enforceable default budgets and returns failure when a median exceeds them.
- Playwright server ordering keeps the mock API alive while the Next process shuts down, avoiding teardown connection noise.
- Queued email retries use a stable RFC Message-ID derived from the job ID. SMTP remains an at-least-once boundary, but receiving systems can deduplicate retries consistently.

## Historical production verification

On July 29, 2026, the Paris database migration, protected deployment, public smoke checks, active PM2 process, manual full backup, restricted systemd backup, daily timer, dedicated Google Drive OAuth remote, Windows Paris snapshot, and one isolated full database/upload restore drill were verified. The drill restored 35 public tables, 33 completed migrations, 41 public files, and 10 private files without targeting production.

That historical drill predates the new two-pass backup and staged/transactional restore implementation. It proves the archive/key/data path, but the newly hardened workflow requires a fresh isolated drill before being marked end-to-end verified.

## Remaining external gates

### High - revoke the exposed Google OAuth token

A Google Drive OAuth access/refresh token was pasted into the conversation during setup. Treat it as compromised even if the message is no longer visible.

Required action: revoke the authorization in the Google account/Google Cloud security controls, re-authorize `quest-backups-custom` with the dedicated desktop client, and run both a manual and systemd backup plus remote content verification. Never print the replacement rclone configuration or token.

### High - create and independently verify secret recovery

The repository now provides `ops/create-secret-recovery-package.sh` and [Secret and Infrastructure Recovery](./secret-and-infrastructure-recovery.md), but no newly created package, separate vault copy, or isolated retrieval/decryption drill has been verified in this change.

Required action: approve a separate offline recovery identity/vault, create the encrypted allowlisted package, move it off the VPS, remove staging, and complete the documented independent drill. Provider-account recovery inventory and MFA recovery codes remain separate.

### High - repeat the isolated full restore drill

Required action: after deployment, create a new archive with the two-pass backup, download its checksum pair, and run the hardened restore against disposable PostgreSQL 17 and empty disposable upload targets. Record transactional database success, tree activation/previous-tree behavior, counts, checksums, elapsed time, and plaintext cleanup.

### Medium - deploy and test backup alerting/freshness/retention

The new failure/freshness units and guarded retention script are not active merely because they exist in Git.

Required action: install the updated backup, failure, and freshness service/timer units; add the approved webhook privately; reload systemd; test exactly one alert and a passing freshness check; add owner-approved remote retention/minimum values; run a dry run; and only then approve a confirmation-gated prune. Do not schedule deletion until the new restore drill passes.

### Medium - finish control-plane checks

- Disable the unused Supabase Data API in the Paris dashboard, then rerun the database security verifier.
- Verify Tokyo mail-provider credentials, sending status, domain identity, and an actual delivery path.
- Verify monitoring/Discord alert delivery, PayHere paths if enabled, Supabase capacity/health, persistent storage mounts, Vercel deployment, DNS, TLS, and public readiness.
- In the PayHere sandbox, verify that both return and cancel redirects preserve the `/shop/order#token=...` fragment and that the order page reads status only through the `X-Order-Token` header.
- Decide the approved retirement date for the historical Drive remote and the old Tokyo Supabase project; rotate credentials before deletion.

### Low - development dependency audit and coverage depth

`npm audit --omit=dev` is clean. The full frontend audit still attributes nine High findings to ESLint/Next lint packages through `minimatch`, although `npm ls` shows the vulnerable `brace-expansion` versions replaced by 1.1.17/5.0.8. Do not force an incompatible lint downgrade/major solely to silence metadata; re-evaluate when the supported dependency chain updates.

The aggregate coverage gate passes, but auth/TOTP, mail, commerce, production error mapping, upload failures, recovery scripts, and real-database concurrency deserve additional behavior/integration coverage as those areas change.

## Safest rollout order

1. Revoke and re-authorize the exposed Google Drive OAuth grant.
2. Run the complete local/CI release suite on Node 24 and review this diff.
3. Deploy through protected CI/CD; verify frontend, liveness, readiness, public reads, authentication, uploads, and enabled integrations.
4. Install/reload the updated backup, failure, and freshness systemd units; test manual/systemd backup, freshness, and one alert.
5. Create and independently test the secret recovery package.
6. Run the new isolated full restore drill.
7. Approve retention values, inspect the dry run, and only then prune old remote recovery points.
8. Complete Supabase/mail/payment/monitoring/control-plane checks and retire obsolete Tokyo/historical resources after rollback retention expires.

Operational commands are in [Production Operations Runbook](./production-runbook.md), [Backup and Disaster Recovery](./backup-and-disaster-recovery.md), and [Secret and Infrastructure Recovery](./secret-and-infrastructure-recovery.md).
