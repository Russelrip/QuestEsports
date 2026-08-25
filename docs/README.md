# Quest Esports Documentation

Use the guide that matches the work being performed. The root [README](../README.md) is the project entry point; this directory holds focused architecture, product, security, and operations material.

## Production and Recovery

- [Production Operations Runbook](./production-runbook.md) — production topology, maintenance mode, VPS operations, deployment verification, and incidents.
- [Backup and Disaster Recovery](./backup-and-disaster-recovery.md) — encrypted backups, key custody, validation, restore drills, and recovery.
- [Secret and Infrastructure Recovery](./secret-and-infrastructure-recovery.md) — separately encrypted application secrets, infrastructure configuration, custody, and recovery testing.
- [Deployment and Migration Safety](./DEPLOYMENT_SAFETY.md) — forward-only migration rules, approval gates, backup requirements, and rollback limits.
- [Pre-deployment Checklist](./pre-deployment-checklist.md) — current release security and reliability gate.
- [Full Site Audit Checklist](./full-site-audit-checklist.md) — comprehensive manual and automated QA inventory.

## Setup and Architecture

- [Developer Guide](developer-guide.md) — supported contributor workflow, package commands, and verification.
- [Environment Reference](environment-reference.md) — environment variable ownership, applicability, and safe placeholders.
- [VALORANT Local Development](valorant-local-development.md) — dedicated-test topology and two-service integration workflow.
- [Setup and Deployment](./setup-and-deployment.md) — local setup, environment configuration, VPS deployment, and reverse proxy guidance.
- [Collaboration and Staging](./collaboration-and-staging.md) — contributor workflow, staging isolation, and credential boundaries.
- [CI/CD](./ci-cd.md) — GitHub Actions, manual production deployment, migration approval, and troubleshooting.
- [Database and Storage](./database-and-storage.md) — Prisma models, upload roots, storage behavior, and data handling.
- [Authentication Flow](./authentication-flow.md) — sessions, OAuth, password recovery, and authorization.
- [Email System](./email-system.md) — providers, templates, triggers, queue behavior, and verification.
- [API Documentation](./api-documentation.md) — implemented endpoints and response behavior.
- [Private Android Admin App](../mobile-admin/README.md) — local development, security model, signing, and private APK releases.
- [Future Technical Improvements](./future-technical-improvements.md) — feasible candidates that are not committed or scheduled.
- [Platform Integration Roadmap](./platform-integration-roadmap.md) — remaining work to unify the website, database, Discord, and the VALORANT SL leaderboard, and the decisions each item is waiting on.
- [VALORANT Match Data Plan](./valorant-match-data-plan.md) — what exists for VALORANT match ingestion, what the upstream already returns, and the plan for public VLR-style match pages.

## Product and Administration

- [Admin Operations](./admin-operations.md) — administrative workflows and safeguards.
- [Commerce and Tournament Operations](./commerce-and-tournament-operations.md) — registration, payment, shop, and ticket operations.
- [Google Search Console and Sitemap Operations](./search-console-and-sitemap.md) — crawler, sitemap, canonical, and Search Console procedures.

## Documentation Rules

Documentation may name services, regions, non-secret paths, and public endpoints. It must never contain database passwords, filled `.env` values, OAuth secrets/tokens, payment secrets, webhook tokens, signing keys, rclone configuration contents, or private recovery identities.

Update the relevant focused guide and this index whenever behavior or operational ownership changes. Avoid release snapshots and duplicated setup instructions; Git history already preserves obsolete release state.
