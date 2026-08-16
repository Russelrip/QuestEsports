# Automatic Main-to-Production Deployment Design

## Goal

After a commit reaches `main`, run the existing CI workflow first. If CI
passes, deploy the exact tested commit to the backend, wait for backend
health and compatibility checks, and then deploy the same commit to the
frontend. Preserve manual workflow dispatch for emergency redeploys.

## Current Behavior

- `CI` runs automatically for pushes and pull requests targeting `main`.
- `CD` is manual-only and deploys the backend over SSH.
- `Deploy frontend` is manual-only and deploys a Vercel artifact after
  checking backend compatibility.
- `Secret scan` runs automatically for pushes and pull requests targeting
  `main`.
- The backend deployment already applies migrations, performs health checks,
  and rolls back code on failure.
- Schema migrations require `BACKEND_MIGRATION_APPROVAL_SHA` to match the
  deployed commit; this safety gate remains in place.

## Decision

Use chained `workflow_run` triggers:

1. `CI` remains the source-of-truth validation workflow.
2. `CD` triggers when a `CI` run for `main` completes successfully. It uses
   `github.event.workflow_run.head_sha` as the immutable deployment SHA.
3. `Deploy frontend` triggers when the matching `CD` run completes
   successfully. It uses the backend workflow run's `head_sha`, preserving
   backend-before-frontend ordering.
4. Both workflows retain `workflow_dispatch` for manual redeployment.

Each production job continues to require its existing enablement variable,
repository-owner guard, production environment, credentials, and concurrency
group. The frontend compatibility probe sends the production site `Origin`
header because the API rejects originless requests.

## Migration Safety

Automatic deployment does not bypass migration approval. If the tested SHA
contains a pending schema migration, CD stops unless
`BACKEND_MIGRATION_APPROVAL_SHA` has been explicitly set to that full SHA.
Destructive migrations retain the separate destructive approval requirement.
This means ordinary commits deploy automatically, while schema changes still
require an explicit release approval.

## Failure Handling

- CI failure prevents both production deployments.
- Backend deployment failure prevents frontend deployment.
- Backend rollback behavior remains unchanged.
- Frontend failure leaves the already-healthy backend deployed and can be
  retried through `workflow_dispatch` with the same SHA.
- Workflow-run filters must require `conclusion == success`, `head_branch ==
  main`, and the expected upstream workflow name to prevent unrelated runs
  from promoting production.

## Verification

- Validate workflow YAML and GitHub expressions before commit.
- Confirm a successful main CI run dispatches CD with the same SHA.
- Confirm CD success dispatches frontend deployment with the same SHA.
- Confirm CI failure does not dispatch production deployment.
- Confirm migration approval still blocks an unapproved migration SHA.
- Confirm manual dispatch remains available for both deployment workflows.
