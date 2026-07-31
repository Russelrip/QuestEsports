# Quest Esports Documentation

This directory contains the operational, architecture, security, and product documentation for Quest Esports. Start with the guide that matches the work being performed.

## Production and recovery

- [Secret and Infrastructure Recovery](./secret-and-infrastructure-recovery.md) - separately encrypted application secrets, infrastructure configuration, custody, and recovery testing.

- [Production Operations Runbook](./production-runbook.md) — current production topology, full-site maintenance mode, VPS operations, deploy verification, PM2, Nginx, and incident commands.
- [Backup and Disaster Recovery](./backup-and-disaster-recovery.md) — encrypted backups, key custody, routine validation, isolated restore drills, and production recovery.
- [Deployment and Migration Safety](./DEPLOYMENT_SAFETY.md) — forward-only migration rules, approval gates, backup requirements, and rollback limits.
- [Pre-deployment Checklist](./pre-deployment-checklist.md) — release security and reliability gate.
- [Foundation Release Operations](./foundation-release.md) — migration order, Challonge enablement, verification, monitoring, rollback, and favicon recrawl steps.
- [Project Audit Status](./project-audit-status.md) — completed remediation, verified production state, and remaining manual checks.
- [Full Site Audit Checklist](./full-site-audit-checklist.md) — comprehensive manual and automated QA inventory.

## Setup and architecture

- [Setup and Deployment](./setup-and-deployment.md) — local setup, environment configuration, VPS deployment, and reverse proxy guidance.
- [CI/CD](./ci-cd.md) — GitHub Actions, protected deployment, migration approval, and troubleshooting.
- [Database and Storage](./database-and-storage.md) — Prisma models, persistent upload roots, storage behavior, and data handling.
- [Future Technical Improvements](./future-technical-improvements.md) — feasible architecture and infrastructure candidates that are not committed or scheduled.
- [Authentication Flow](./authentication-flow.md) — sessions, OAuth, MFA, password recovery, and authorization.
- [Email System](./email-system.md) — providers, templates, triggers, queue behavior, and operational verification.
- [API Documentation](./api-documentation.md) — implemented endpoints and response behavior.

## Product and administration

- [Admin Operations](./admin-operations.md) — administrative workflows and safeguards.
- [Commerce and Tournament Rollout](./commerce-and-tournament-rollout.md) — rollout checks for registration, payment, products, and tournament features.
- [Google Search Console and Sitemap Operations](./search-console-and-sitemap.md) — crawler, sitemap, canonical, and Search Console procedures.

## Documentation safety

Documentation may name services, regions, non-secret paths, and public endpoints. It must never contain database passwords, `.env` contents, OAuth client secrets, OAuth tokens, rclone configuration contents, payment secrets, webhook tokens, or the private `age` recovery identity.

When production behavior changes, update the relevant focused guide, this index if discovery changes, the root [README](../README.md), and the audit/runbook records in the same pull or commit.
