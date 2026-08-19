# OAuth E2E Fixture Bootstrap Design

## Goal

Make `npm run test:e2e:oauth` self-contained after the user supplies one
existing, dedicated disposable PostgreSQL database URL. The flow must create
its own accounts and session cookie, exercise the real Quest backend/frontend,
and remove all rows it created when the run ends.

Creating or dropping PostgreSQL databases is explicitly out of scope because
that requires administrator credentials and introduces a destructive lifecycle
outside the test runner.

## Boundaries

- The fixture bootstrap owns only test database migration, fixture row creation,
  generated credentials, and cleanup of rows identified by the current run ID.
- The existing fake OAuth provider remains the only external HTTP boundary
  simulated by the browser suite.
- Production application code and production environment behavior are
  unchanged. The bootstrap is invoked only by the dedicated OAuth E2E runner.
- The dedicated URL must be provided through `OAUTH_E2E_DATABASE_URL`; it must
  use a loopback host and a database name containing `test`, `e2e`, or `oauth`.
  Direct URL defaults to it unless `OAUTH_E2E_DIRECT_URL` is explicitly
  provided, and the same disposable safety check applies to both URLs.

## Fixture contract

The bootstrap generates a unique run ID, random passwords, usernames, emails,
and the Discord collision provider ID. It creates:

1. A Google-link target with a verified password and no linked providers.
2. A Discord collision target with a verified password and no linked providers.
3. A Discord collision owner with a verified password and no linked providers.
4. A safe-unlink account with a verified password and no linked providers.
5. A last-method account with one seeded Google `OAuthAccount` and a reusable
   session cookie. Its password is OAuth-only so unlinking Google must fail.

All normal accounts receive `passwordSetAt`, verified email state, and unique
run-scoped identifiers. The last-method account receives a random bcrypt hash
without `passwordSetAt`, matching the application’s OAuth-only semantics.

## Data flow

1. Runner validates `OAUTH_E2E_DATABASE_URL` and confirms the database is
   loopback and disposable according to the fixture safety check.
2. Runner invokes `node scripts/oauth-e2e-fixtures.js prepare --manifest <path>`
   with a generated run ID. The script runs `prisma migrate deploy`, inserts
   users and OAuth rows through Prisma, creates the last-method session through
   `sessionService.createSession`, writes the JSON fixture manifest with mode
   `0600`, and prints no manifest (a safe success marker is permitted).
3. Runner maps the manifest into the Playwright environment and starts the fake
   provider, real backend, and real frontend on dynamic loopback ports.
4. Playwright runs serial browser projects. The fake provider returns the
   generated run-specific Google identity and configured collision Discord
   identity.
5. Runner stops child processes, invokes fixture cleanup with the manifest, and
   removes only the run-scoped users, sessions, and OAuth accounts in a
   transaction-safe order.

## Failure and safety behavior

- Missing database URL fails before migration or fixture creation.
- Migration, preparation, service startup, Playwright, or cleanup errors are
  reported with the originating phase and preserve the first failure code.
- Cleanup runs in `finally` after child process termination. A cleanup failure
  is never silently discarded, and database cleanup is skipped if a child cannot
  be proven to have exited.
- The manifest is held in a unique temporary directory/file with mode `0600`
  and is never committed. Generated passwords and cookies are not logged or
  printed. Any post-insert prepare failure attempts deletion by generated user
  IDs before rethrowing the primary error; unverified rollback is a failure.
- The script refuses production mode and does not load the repository `.env`
  for the isolated backend child. `QUEST_DISABLE_DOTENV` is honored only when
  `NODE_ENV=test`; production dotenv loading remains active.

## Verification

- Unit-level checks cover manifest shape, run-scoped identifiers, password/OAuth
  semantics, and cleanup selection without requiring a live browser.
- Existing backend OAuth/OpenAPI tests, frontend typecheck/lint, and syntax
  checks remain green.
- With a disposable PostgreSQL database available, `npm run test:e2e:oauth`
  runs all configured browser projects and verifies the full link, collision,
  last-method, and safe-unlink flows.
