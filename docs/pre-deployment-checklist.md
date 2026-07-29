# Pre-deployment security and reliability checklist

Use this as a release gate. A code control marked implemented still requires the production
configuration and smoke check in the final column.

| Control | Repository evidence | Release sign-off |
| --- | --- | --- |
| Authentication and authorization | Session hashes and expiry are enforced in `session.service.js`; protected routes use `requireAuth`, `requireVerifiedEmail`, or `requireAdmin`; ownership checks remain in services. | Test anonymous, ordinary-user, verified-user, and admin access against production-like data. |
| Input validation and sanitization | API services normalize and validate fields, uploads are decoded and constrained, Prisma parameterizes database queries, and frontend forms use Zod where appropriate. | Run direct malformed API requests as well as browser validation tests. Never rely on frontend validation alone. |
| CORS and request origin | Production environment validation requires exact HTTPS origins; CORS uses the allowlist and state-changing/authenticated requests enforce Origin/Referer. | Set only the live frontend origin(s) in `CORS_ORIGIN`; keep `REQUIRE_API_ORIGIN=true`. |
| Rate limiting | Login, signup, password reset, verification, contact, recruitment, checkout, registration, proof upload, and payment notification routes use database-backed atomic limits. | Confirm `TRUST_PROXY` matches the reverse-proxy hop count so client IPs are trustworthy. |
| Password reset expiry | Reset tokens are random, hashed at rest, expire after 20 minutes, are consumed once, and revoke existing sessions after use. | Trigger a real reset email; verify valid, reused, and expired-token behavior. |
| Frontend error handling | API requests have timeouts and safe response parsing; route and root error boundaries render retryable fallback states. | Exercise an API outage and a forced render error in the preview deployment. |
| Database indexes | Prisma defines indexes for public listings, user/session/token lookup, registrations, payments, jobs, expiry cleanup, and rate-limit buckets. | Apply migrations, run representative `EXPLAIN ANALYZE` checks with production-scale data, and inspect slow-query metrics. |
| Logging | Structured JSON request/error/security logs include request IDs and redact credentials, cookies, secrets, and token-like query parameters. | Configure `LOG_DRAIN_URL` and verify delivery without exposing its token. Define retention and access ownership. |
| Alerts | Unhandled exceptions can be shipped through `MONITORING_WEBHOOK_URL` or directly to Discord with `DISCORD_ALERT_WEBHOOK_URL`; readiness reports database/storage state. | **Deployment blocker:** configure an alert destination and run `npm run alerts:test:discord` when using Discord. Add uptime monitoring for `/api/health/ready` and teach it that the documented maintenance `503` is intentional only during an approved window. |
| Rollback | CD deploys an exact CI-passed SHA, rejects destructive migrations, health-checks the restart, and restores the prior application SHA/dependencies on failure. | Confirm the production environment approval, current database backup, PM2 ownership, and a rehearsed rollback. Migrations must remain backward-compatible. |
| Maintenance mode | The frontend serves a branded non-cacheable `503` page; the backend protects ordinary API routes while preserving liveness and PayHere notifications; CD recognizes intentional maintenance readiness. | Test enable/disable ordering in preview or locally. Keep frontend and backend values identical, and use a PM2 stop—not maintenance mode—for any true write freeze. |
| Migration approval and backup | A migration-changing deploy requires `BACKEND_MIGRATION_APPROVAL_SHA` to equal the exact tested commit and creates an overlap-safe, remotely content-verified encrypted database/upload backup before migration. | Confirm `/etc/quest-esports-backup.env`, the offline `age` recipient, the project-owned Google OAuth client and least-privilege `rclone` destination, a tested `OnFailure` alert, approved/dry-run retention, and a recent restore drill before setting the one-release approval SHA. |
| Disaster credentials | The archive deliberately excludes the backend `.env`, OAuth/rclone material, platform keys, and infrastructure configuration. | Confirm a separate encrypted, access-controlled recovery copy exists and can be retrieved by the approved custodian without using Git, chat, tickets, or ordinary cloud storage. |
| Database API exposure | The hardening migration enables RLS and revokes Data API table grants; `npm run prisma:security:verify` fails if exposure returns. | Disable the unused Data API in the Paris Supabase dashboard and run the verifier against production after migration. |
| Search discovery | Next.js generates `/sitemap.xml`; `/robots.txt` advertises it; canonical public and dynamic routes are covered by sitemap unit tests. | Confirm both production endpoints return `200`, parse the sitemap XML, verify only canonical/indexable URLs are present, and review the Search Console Sitemaps report. |

## Required final commands

```powershell
cd backend
npm ci
npm run lint
npm test
npm run prisma:migrate:status
npm run prisma:security:verify

cd ../frontend
npm ci
npm run lint
npm test
npm run build
npm run test:e2e
```

Do not approve production deployment until remote logging/alert delivery, database backup recency,
mail delivery, payment callbacks (when enabled), persistent upload mounts, and the database-backed
readiness endpoint have been verified in the target environment.

For the crawler and Search Console release gate, follow [Google Search Console and Sitemap Operations](./search-console-and-sitemap.md).

For backup recency, key custody, restore-drill evidence, and disaster recovery, follow [Backup and Disaster Recovery](./backup-and-disaster-recovery.md).
