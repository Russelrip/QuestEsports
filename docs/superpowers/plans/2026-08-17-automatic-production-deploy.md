# Automatic Main-to-Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically promote a successful `main` commit through CI, backend CD, and frontend production deployment in order, while preserving manual redeploys and migration safety.

**Architecture:** Keep CI and Secret scan on push/PR events. Add successful `workflow_run` triggers to CD and Deploy frontend; each workflow uses the upstream run's immutable `head_sha`, and frontend promotion only follows successful backend CD. Keep `workflow_dispatch` for manual redeploys.

**Tech Stack:** GitHub Actions YAML, `workflow_run`, existing SSH/PM2 backend deployment, existing Vercel CLI deployment, GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-08-17-automatic-production-deploy-design.md`

## Global Constraints

- Automatic deployment uses the exact successful upstream SHA, never the default branch tip.
- Backend CD completes before frontend deployment begins.
- Keep owner guards, enablement variables, production environments, credentials, concurrency groups, health checks, rollback behavior, and migration approval gates.
- Keep `workflow_dispatch` available for both deployment workflows.
- Do not add runtime dependencies.

---

### Task 1: Chain CI to Backend CD

**Files:** `.github/workflows/cd.yml`

- [ ] Add a `workflow_run` trigger for workflow `CI`, type `completed`, branch `main`, while retaining `workflow_dispatch`.
- [ ] Require automatic events to have `workflow_run.name == 'CI'`, `workflow_run.conclusion == 'success'`, and `workflow_run.head_branch == 'main'`; preserve the existing owner and enablement checks.
- [ ] Set automatic `DEPLOY_SHA` from `github.event.workflow_run.head_sha`; preserve the current manual SHA behavior.
- [ ] Leave migration approval, rollback, PM2, health-check, and SSH logic unchanged.
- [ ] Validate with `git diff --check` and `actionlint .github/workflows/cd.yml`.

### Task 2: Chain Backend CD to Frontend Deployment

**Files:** `.github/workflows/deploy-frontend.yml`

- [ ] Add a `workflow_run` trigger for workflow `CD`, type `completed`, branch `main`, while retaining `workflow_dispatch`.
- [ ] Require automatic events to have `workflow_run.name == 'CD'`, `workflow_run.conclusion == 'success'`, and `workflow_run.head_branch == 'main'`; preserve the existing owner and enablement checks.
- [ ] Set automatic `DEPLOY_SHA` from `github.event.workflow_run.head_sha`; preserve manual `inputs.deploy_sha` behavior.
- [ ] Keep the production `Origin` header on `/api/capabilities`, Vercel steps, credentials, and concurrency group unchanged.
- [ ] Validate with `git diff --check` and `actionlint .github/workflows/deploy-frontend.yml`.

### Task 3: Update Deployment Documentation

**Files:** `docs/ci-cd.md`, `docs/production-runbook.md`

- [ ] Document `main push -> CI -> backend CD -> frontend deployment` and exact-SHA promotion.
- [ ] Document that CI or backend failure stops downstream deployment.
- [ ] Preserve documentation for migration approval, deployment enablement variables, Vercel credentials, and manual dispatch.
- [ ] Remove only stale claims that production deployment is manual-only.

### Task 4: Commit, Push, and Verify

- [ ] Review `git status --short`, `git diff --check`, `git diff --stat`, and the final workflow/documentation diff.
- [ ] Commit with `ci: automatically promote successful main builds`.
- [ ] Push `main`; verify CI and Secret scan pass for the new SHA.
- [ ] Verify CD runs from `workflow_run`, uses the same SHA as CI, and succeeds when migration approval is satisfied.
- [ ] Verify frontend runs only after successful CD and uses the same SHA.
- [ ] Verify both deployment workflows still expose `workflow_dispatch`.
