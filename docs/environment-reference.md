# Environment Reference

This is the safe variable inventory for `backend/.env.example`,
`frontend/.env.example`, `mobile-admin/.env.example`, checked-in test harnesses,
and checked-in deployment workflows. Values below are placeholders or safe
defaults. Never commit real credentials, tokens, private keys, production
database URLs, or private infrastructure values.

Applicability uses **L** = local development, **D** = shared development or
staging, **CI** = GitHub Actions or automated tests, and **P** = production.
The **Required?** column describes whether the value is required in the listed
applicability, not whether the variable must be present in every `.env` file.
Generated workflow values and script-set controls are explicitly marked as not
user-required. “Restart/redeploy impact” describes when a changed value takes
effect.

For provisioning and deployment, see [Setup and Deployment](./setup-and-deployment.md).
For runtime changes and incidents, see [Production Operations Runbook](./production-runbook.md).

## Backend — process, database, cache, and sessions

| Variable | Required? | Owner | Applies | Classification | Safe placeholder/default | Restart/redeploy impact |
| --- | --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | No — defaults to development | Backend | L/D/CI/P | Public/non-secret | `development` | Restart backend |
| `PORT` | No — defaults to `5001` | Backend | L/D/CI/P | Public/non-secret | `5001` | Restart backend |
| `TZ` | No | Backend | L/D/CI/P | Public/non-secret | `Asia/Colombo` | Restart backend |
| `CORS_ORIGIN` | Conditional — production must resolve to HTTPS origins | Backend/web owner | L/D/P | Public/non-secret | `http://localhost:3000` locally; `<approved origin>` otherwise | Restart backend |
| `DATABASE_URL` | Yes | Backend/database owner | L/D/CI/P | Secret | `postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require` | Restart backend; migration-sensitive |
| `DIRECT_URL` | Yes | Backend/database owner | L/D/CI/P | Secret | `postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require` | Restart backend; migration-sensitive |
| `CACHE_DRIVER` | No — defaults to memory; required `upstash` when `API_PROCESS_COUNT>1` | Backend | L/D/CI/P | Public/non-secret | `memory` for one process; `upstash` for a cluster | Restart backend |
| `CACHE_TTL_SECONDS` | No — defaults to `300` | Backend | L/D/CI/P | Public/non-secret | `300` | Restart backend |
| `CACHE_MAX_ENTRIES` | No — defaults to `1000` | Backend | L/D/CI/P | Public/non-secret | `1000` | Restart backend |
| `CACHE_CONNECTION_TIMEOUT_MS` | No — defaults to `2000` | Backend | L/D/CI/P | Public/non-secret | `2000` | Restart backend |
| `CACHE_KEY_PREFIX` | No — defaults to `quest-esports` | Backend | L/D/CI/P | Public/non-secret | `quest-esports` | Restart backend |
| `API_PROCESS_COUNT` | No — defaults to `1`; must equal the number of API workers | Backend/deployment owner | L/D/P | Public/non-secret | `1` | Restart backend |
| `UPSTASH_REDIS_REST_URL` | Required when `CACHE_DRIVER=upstash` | Backend/cache owner | D/P | Secret | `<Upstash REST URL>` | Restart backend |
| `UPSTASH_REDIS_REST_TOKEN` | Required when `CACHE_DRIVER=upstash` | Backend/cache owner | D/P | Secret | `<Upstash REST token>` | Restart backend |
| `LOG_LEVEL` | No — defaults to `info` | Backend | L/D/CI/P | Public/non-secret | `info` | Restart backend |
| `SESSION_COOKIE_NAME` | Yes | Backend | L/D/CI/P | Public/non-secret | `quest_session` | Restart backend; existing sessions may need logout |
| `SESSION_TTL_DAYS` | No — defaults to `1` | Backend | L/D/CI/P | Public/non-secret | `1` | Restart backend |
| `REMEMBER_ME_SESSION_TTL_DAYS` | No — defaults to `30` | Backend | L/D/CI/P | Public/non-secret | `30` | Restart backend |
| `AUTH_ENCRYPTION_KEY` | Yes for non-test backend | Backend/security owner | L/D/P; not required by automated test defaults | Secret | `<64 hexadecimal characters>` | Restart backend; changing an existing key requires an approved data migration plan |
| `TRUST_PROXY` | Conditional | Backend/deployment owner | D/P | Public/non-secret | `false` locally; `<proxy setting>` otherwise | Restart backend |
| `REQUIRE_API_ORIGIN` | Conditional | Backend/security owner | L/D/P | Public/non-secret | `false` locally; `true` in production | Restart backend |

## Backend — jobs and maintenance

| Variable | Required? | Owner | Applies | Classification | Safe placeholder/default | Restart/redeploy impact |
| --- | --- | --- | --- | --- | --- | --- |
| `JOB_WORKER_ENABLED` | Conditional | Backend/operations owner | L/D/P | Public/non-secret | `true`; production requires it while queued password email is enabled | Restart backend |
| `COMMERCE_MAINTENANCE_ENABLED` | No | Backend | L/D/P | Public/non-secret | `true` | Restart backend |
| `SITE_MAINTENANCE_MODE` | No — defaults to disabled | Backend and frontend release owner | L/D/P | Public/non-secret | `false` | Backend restart; frontend redeploy when its copy changes |
| `SITE_MAINTENANCE_MESSAGE` | No — has a built-in fallback | Backend and frontend release owner | L/D/P | Public/non-secret | `We’re carrying out scheduled maintenance. Please try again shortly.` | Backend restart; frontend redeploy when its copy changes |
| `SITE_MAINTENANCE_RETRY_AFTER_SECONDS` | No — defaults to `900` | Backend and frontend release owner | L/D/P | Public/non-secret | `900` | Backend restart; frontend redeploy when its copy changes |
| `JOB_WORKER_POLL_MS` | No — defaults to `15000` | Backend | L/D/P | Public/non-secret | `15000`; the worker polls whether or not there is work, so this is a floor on database traffic. Lower it only if job latency actually matters | Restart backend |
| `JOB_WORKER_MAX_ATTEMPTS` | No — defaults to `5` | Backend | L/D/P | Public/non-secret | `5` | Restart backend |
| `DATA_HYGIENE_MAINTENANCE_ENABLED` | No | Backend/operations owner | L/D/P | Public/non-secret | `true` | Restart backend |

## Backend — integrations and realtime

| Variable | Required? | Owner | Applies | Classification | Safe placeholder/default | Restart/redeploy impact |
| --- | --- | --- | --- | --- | --- | --- |
| `CHALLONGE_ENABLED` | No | Backend/integration owner | L/D/P | Public/non-secret | `false` | Restart backend |
| `CHALLONGE_AUTOMATIC_SYNC_ENABLED` | No | Backend/integration owner | L/D/P | Public/non-secret | `false` | Restart backend |
| `CHALLONGE_CLIENT_ID` | Conditional | Backend/integration owner | D/P | Secret | `<Challonge client ID>` when enabled | Restart backend |
| `CHALLONGE_CLIENT_SECRET` | Conditional | Backend/integration owner | D/P | Secret | `<Challonge client secret>` when enabled | Restart backend |
| `CHALLONGE_OAUTH_SCOPE` | No — defaults when enabled | Backend/integration owner | D/P | Public/non-secret | `application:manage` | Restart backend |
| `CHALLONGE_TOKEN_URL` | No — has a built-in default | Backend/integration owner | L/D/P | Public/non-secret | `https://api.challonge.com/oauth/token` | Restart backend |
| `CHALLONGE_BASE_URL` | No — has a built-in default | Backend/integration owner | L/D/P | Public/non-secret | `https://api.challonge.com/v2.1` | Restart backend |
| `CHALLONGE_BRACKET_CACHE_SECONDS` | No — defaults to `30` | Backend/integration owner | L/D/P | Public/non-secret | `30` | Restart backend |
| `CHALLONGE_REQUEST_TIMEOUT_MS` | No — defaults to `8000` | Backend/integration owner | L/D/P | Public/non-secret | `8000` | Restart backend |
| `CHALLONGE_DEFAULT_SYNC_MINUTES` | No — defaults to `5` | Backend/integration owner | L/D/P | Public/non-secret | `5` | Restart backend |
| `CHALLONGE_SYNC_LEASE_SECONDS` | No — defaults to `90` | Backend/integration owner | L/D/P | Public/non-secret | `90` | Restart backend |
| `REALTIME_SSE_ENABLED` | No | Backend | L/D/P | Public/non-secret | `false` | Restart backend |
| `REALTIME_SSE_MAX_CONNECTIONS` | No — defaults to `100` | Backend | L/D/P | Public/non-secret | `100` | Restart backend |
| `REALTIME_SSE_MAX_CONNECTIONS_PER_IP` | No — defaults to `5` | Backend | L/D/P | Public/non-secret | `5` | Restart backend |
| `REALTIME_CHANNEL` | Required and identical on every API worker in clustered/shared Upstash mode; must differ between environments sharing an Upstash database | Backend/deployment owner | D/P | Public/non-secret | `quest-realtime-local` only for one local memory process; `<deployment-unique channel>` for shared mode | Restart backend |
| `REALTIME_WORKER_ID` | No — defaults to a process-derived worker base; set a stable base when deployment identity requires it | Backend/deployment owner | D/P | Public/non-secret | blank; config fallback is `worker-${process.pid}` | Restart backend |
| `REALTIME_PUBSUB_MAX_MESSAGE_BYTES` | No — defaults to `65536` | Backend | L/D/P | Public/non-secret | `65536` | Restart backend |
| `REALTIME_PUBSUB_RECONNECT_BASE_MS` | No — defaults to `250` | Backend | L/D/P | Public/non-secret | `250` | Restart backend |
| `REALTIME_PUBSUB_RECONNECT_MAX_MS` | No — defaults to `10000` | Backend | L/D/P | Public/non-secret | `10000` | Restart backend |
| `LOG_DRAIN_URL` | No | Backend/operations owner | D/P | Secret | `<structured log drain URL>` | Restart backend |
| `LOG_DRAIN_TOKEN` | Conditional | Backend/operations owner | D/P | Secret | `<log drain token>` when a drain requires it | Restart backend |
| `MONITORING_WEBHOOK_URL` | No | Backend/operations owner | D/P | Secret | `<monitoring webhook URL>` | Restart backend |
| `MONITORING_WEBHOOK_TOKEN` | Conditional | Backend/operations owner | D/P | Secret | `<monitoring webhook token>` when required | Restart backend |
| `DISCORD_ALERT_WEBHOOK_URL` | No | Backend/operations owner | D/P | Secret | `<private Discord webhook URL>` | Restart backend |

### Clustered realtime requirements

For two or more API workers, set `CACHE_DRIVER=upstash` and provide both
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. `API_PROCESS_COUNT`
must match the PM2/API worker count. Every worker uses the same
explicit `REALTIME_CHANNEL` within its environment, but staging and production
must use different channels when they share an Upstash database. Clustered or
shared Upstash mode fails startup when `REALTIME_CHANNEL` is omitted; only a
single-process memory deployment receives the safe `quest-realtime-local`
default.
If `REALTIME_WORKER_ID` is configured,
use the same base on every worker; otherwise the configuration supplies a
process-derived fallback. The implementation creates the effective identity as
`${REALTIME_WORKER_ID}:${process.pid}:${randomUUID()}`; therefore a shared PM2
base is safe because process PID and startup UUID distinguish workers. Do not
run a multi-worker deployment with the memory cache or with a missing shared
transport credential.

`GET /api/health/live` returns the non-secret effective value at
`realtime.workerId`. `pm2 env` verifies only the configured base; deployment
verification must compare the live health values from both workers.

The shared transport uses these exact Upstash REST requests:

```text
POST {UPSTASH_REDIS_REST_URL}/subscribe/{channel}   # SSE subscription
POST {UPSTASH_REDIS_REST_URL}                       # single-command publish
Content-Type: application/json
["PUBLISH", "{channel}", "{serialized realtime envelope}"]
```

Both requests require `Authorization: Bearer {UPSTASH_REDIS_REST_TOKEN}`; the
subscribe response is `text/event-stream` and readiness is reported only after
its valid `data: subscribe,{channel},{count}` acknowledgement. The reconnect
base/max variables bound the subscriber's exponential reconnect delay.

The optional cluster smoke test is server-to-server and intentionally omits
synthetic `Origin` and `Referer` headers. It must target a staging security
posture or approved mutation endpoint that accepts the supplied cookie without
browser-origin headers; it must not invent an API origin as a frontend CORS
origin. The smoke test uses the concrete foreign private topic
`user:__realtime_other_user__` and the broad `user` topic when checking 403
isolation.

## Backend — mail and web push

| Variable | Required? | Owner | Applies | Classification | Safe placeholder/default | Restart/redeploy impact |
| --- | --- | --- | --- | --- | --- | --- |
| `MAIL_PROVIDER` | No — defaults to SMTP in implementation | Backend/mail owner | L/D/P | Public/non-secret | `resend` in the example; implementation fallback is `smtp` | Restart backend |
| `RESEND_API_KEY` | Conditional | Backend/mail owner | D/P | Secret | `<Resend API key>` when using Resend | Restart backend |
| `MAIL_FROM` | Conditional | Backend/mail owner | L/D/P | Public/non-secret | `<approved sender address>`; required in production | Restart backend |
| `MAIL_DELIVERY_REQUIRED` | Conditional | Backend/mail owner | L/D/P | Public/non-secret | blank locally; `true` in production | Restart backend |
| `SMTP_HOST` | Conditional | Backend/mail owner | D/P | Public/non-secret | `<SMTP host>` when `MAIL_PROVIDER=smtp` | Restart backend |
| `SMTP_PORT` | No — defaults to `587` | Backend/mail owner | D/P | Public/non-secret | `587` when using SMTP | Restart backend |
| `SMTP_USER` | Conditional | Backend/mail owner | D/P | Secret | `<SMTP username>` when using SMTP | Restart backend |
| `SMTP_PASS` | Conditional | Backend/mail owner | D/P | Secret | `<SMTP password>` when using SMTP | Restart backend |
| `WEB_PUSH_PUBLIC_KEY` | No | Backend/web-push owner | D/P | Public/non-secret | `<web-push public key>` | Restart backend; clients may need a new subscription |
| `WEB_PUSH_PRIVATE_KEY` | Conditional | Backend/web-push owner | D/P | Secret | `<web-push private key>` when push is enabled | Restart backend |
| `WEB_PUSH_SUBJECT` | No — has a built-in default | Backend/web-push owner | L/D/P | Public/non-secret | `mailto:owner@example.invalid` | Restart backend |

## Backend — URLs, mobile admin, storage, and OAuth

| Variable | Required? | Owner | Applies | Classification | Safe placeholder/default | Restart/redeploy impact |
| --- | --- | --- | --- | --- | --- | --- |
| `APP_URL` | Conditional — required in production | Backend/web owner | L/D/P | Public/non-secret | `http://localhost:3000` locally; `<frontend origin>` otherwise | Restart backend |
| `API_PUBLIC_URL` | Conditional — required in production | Backend/deployment owner | L/D/P | Public/non-secret | `http://localhost:5001` locally; `<API origin>` otherwise | Restart backend |
| `MOBILE_ADMIN_OAUTH_REDIRECT_URL` | Conditional — required as an HTTPS App Link in production | Backend/mobile owner | L/D/P | Public/non-secret | `questadmin://oauth` for development builds; `<verified HTTPS App Link>` for release/production | Restart backend; release configuration must match |
| `MOBILE_ADMIN_ANDROID_CERT_SHA256` | Conditional | Mobile release owner | D/CI/P | Public/non-secret | `<colon-separated release certificate SHA-256>` | Restart backend; release verification must match |
| `UPLOAD_ROOT` | Conditional | Backend/storage owner | L/D/P | Secret/path-sensitive | `<durable public upload root>`; required for production readiness | Restart backend; storage migration may be required |
| `PRIVATE_UPLOAD_ROOT` | Conditional | Backend/storage owner | L/D/P | Secret/path-sensitive | `<durable private upload root>`; required for production readiness | Restart backend; storage migration may be required |
| `BANK_TRANSFER_PROOF_RETENTION_DAYS` | No — defaults to `365` | Backend/operations owner | L/D/P | Public/non-secret | `365` | Restart backend |
| `GOOGLE_CLIENT_ID` | No | Backend/auth owner | L/D/P | Public/non-secret | `<Google OAuth client ID>` | Restart backend and update provider registration |
| `GOOGLE_CLIENT_SECRET` | Conditional | Backend/auth owner | D/P | Secret | `<Google OAuth client secret>` when Google login is enabled | Restart backend and update provider registration |
| `GOOGLE_CALLBACK_URL` | Conditional | Backend/auth owner | L/D/P | Public/non-secret | `http://localhost:5001/api/auth/google/callback` locally; `<API origin>/api/auth/google/callback` otherwise | Restart backend and update provider registration |
| `DISCORD_CLIENT_ID` | No | Backend/auth owner | L/D/P | Public/non-secret | `<Discord OAuth client ID>` | Restart backend and update provider registration |
| `DISCORD_CLIENT_SECRET` | Conditional | Backend/auth owner | D/P | Secret | `<Discord OAuth client secret>` when Discord login is enabled | Restart backend and update provider registration |
| `DISCORD_CALLBACK_URL` | Conditional | Backend/auth owner | L/D/P | Public/non-secret | `http://localhost:5001/api/auth/discord/callback` locally; `<API origin>/api/auth/discord/callback` otherwise | Restart backend and update provider registration |

## Backend — payments and commerce

| Variable | Required? | Owner | Applies | Classification | Safe placeholder/default | Restart/redeploy impact |
| --- | --- | --- | --- | --- | --- | --- |
| `PAYHERE_MODE` | No — defaults to sandbox | Backend/payments owner | L/D/P | Public/non-secret | `sandbox` | Restart backend |
| `PAYHERE_ALLOW_SANDBOX_IN_PRODUCTION` | No | Backend/payments owner | P | Public/non-secret | `false` | Restart backend |
| `PAYHERE_MERCHANT_ID` | Conditional | Backend/payments owner | D/P | Secret | `<PayHere merchant ID>`; configure all PayHere values together | Restart backend |
| `PAYHERE_MERCHANT_SECRET` | Conditional | Backend/payments owner | D/P | Secret | `<PayHere merchant secret>`; configure all PayHere values together | Restart backend |
| `PAYHERE_NOTIFY_URL` | Conditional | Backend/payments owner | D/P | Public/non-secret | `<HTTPS PayHere notify URL>` | Restart backend and update provider configuration |
| `SHOP_DELIVERY_FEE_LKR` | No — defaults to `500` | Backend/commerce owner | L/D/P | Public/non-secret | `500` | Restart backend |
| `SHOP_ORDER_RESERVATION_MINUTES` | No — defaults to `30` | Backend/commerce owner | L/D/P | Public/non-secret | `30` | Restart backend |
| `TICKET_ORDER_RESERVATION_MINUTES` | No — defaults to `30` | Backend/commerce owner | L/D/P | Public/non-secret | `30` | Restart backend |

## Backend — VALORANT integration

| Variable | Required? | Owner | Applies | Classification | Safe placeholder/default | Restart/redeploy impact |
| --- | --- | --- | --- | --- | --- | --- |
| `VALORANT_INTERNAL_BASE_URL` | Conditional | Backend/VALORANT owner | L/D/CI/P | Public/non-secret | blank when disabled; `<private HTTPS platform origin>` when enabled | Restart backend |
| `VALORANT_SERVICE_SECRET` | Conditional | Backend/VALORANT owner | L/D/CI/P | Secret | `<VALORANT service secret>` | Restart backend |
| `VALORANT_SERVICE_KEY_ID` | Conditional | Backend/VALORANT owner | L/D/CI/P | Public/non-secret | `<VALORANT service key ID>` | Restart backend |
| `VALORANT_SERVICE_ISSUER` | No — defaults when integration is enabled | Backend/VALORANT owner | L/D/CI/P | Public/non-secret | `quest-esports` | Restart backend |
| `VALORANT_SERVICE_AUDIENCE` | No — defaults when integration is enabled | Backend/VALORANT owner | L/D/CI/P | Public/non-secret | `valorant-platform` | Restart backend |
| `VALORANT_TIMEOUT_MS` | No — defaults to `60000` | Backend/VALORANT owner | L/D/CI/P | Public/non-secret | `60000` | Restart backend |
| `VALORANT_READ_RETRIES` | No — defaults to `2` | Backend/VALORANT owner | L/D/CI/P | Public/non-secret | `2` | Restart backend |
| `VALORANT_SL_API_URL` | No | Backend/VALORANT owner | L/D/CI/P | Public/non-secret | blank when disabled; `<public leaderboard API URL>` when enabled | Restart backend |
| `QUEST_LEADERBOARD_SYSTEM_ACTOR` | No | Backend/VALORANT owner | L/D/CI/P | Public/non-secret | blank when disabled; `<approved system actor>` when enabled | Restart backend |

## Frontend

| Variable | Required? | Owner | Applies | Classification | Safe placeholder/default | Restart/redeploy impact |
| --- | --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Conditional — required for production builds and CI/mock builds | Frontend/web owner | L/D/CI/P | Public/non-secret | `http://localhost:5001` locally; CI mock is `http://127.0.0.1:5011`; `<API origin>` otherwise | Restart dev server; redeploy built frontend |
| `NEXT_PUBLIC_SITE_URL` | Conditional — required for production builds and CI/mock builds | Frontend/web owner | L/D/CI/P | Public/non-secret | `http://localhost:3000` locally; `<frontend origin>` otherwise | Restart dev server; redeploy built frontend |
| `SITE_MAINTENANCE_MODE` | No — defaults to disabled | Frontend/release owner | L/D/P | Public/non-secret | `false` | Restart dev server; redeploy frontend |
| `SITE_MAINTENANCE_MESSAGE` | No — has a built-in fallback | Frontend/release owner | L/D/P | Public/non-secret | `We’re carrying out scheduled maintenance. Please try again shortly.` | Restart dev server; redeploy frontend |
| `SITE_MAINTENANCE_RETRY_AFTER_SECONDS` | No — defaults to `900` | Frontend/release owner | L/D/P | Public/non-secret | `900` | Restart dev server; redeploy frontend |
| `NEXT_PUBLIC_VALORANT_SL_REGISTER_URL` | No | Frontend/VALORANT owner | D/P | Public/non-secret | `<public VALORANT registration URL>` | Restart dev server; redeploy frontend |

## Mobile-admin

| Variable | Required? | Owner | Applies | Classification | Safe placeholder/default | Restart/redeploy impact |
| --- | --- | --- | --- | --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | No — runtime falls back to the production API; explicit for local/device and CI intent | Mobile-admin owner | L/D/CI/P | Public/non-secret | `http://localhost:5001` for an emulator-forwarded API; `<reachable HTTPS API origin>` for a physical device | Restart Expo; rebuild/re-release the app |
| `EXPO_PUBLIC_SITE_URL` | No — runtime falls back to the production site; explicit for local/device and CI intent | Mobile-admin owner | L/D/CI/P | Public/non-secret | `http://localhost:3000` locally; `<frontend origin>` otherwise | Restart Expo; rebuild/re-release the app |
| `EXPO_PUBLIC_OAUTH_REDIRECT_URL` | No — runtime falls back to an Expo-created redirect; explicit for local/release alignment | Mobile-admin/release owner | L/D/CI/P | Public/non-secret | `questadmin://oauth` for development builds; `<verified HTTPS App Link>` for release/production | Restart Expo; rebuild/re-release the app and align backend configuration |

## Database integration and frontend E2E controls

| Variable | Required? | Owner | Applies | Classification | Safe placeholder/default | Restart/redeploy impact |
| --- | --- | --- | --- | --- | --- | --- |
| `RUN_DATABASE_INTEGRATION_TESTS` | No — owning script or CI sets it | Backend test script / GitHub Actions | CI/test | Generated control | Automatically set to `true` by `npm run test:integration` and by CI; do not set before invoking the script | Per test process |
| `CI` | No — workflow sets it | GitHub Actions | CI | Generated control | `true` in workflows; local direct runs may omit it | Per process |
| `NODE_VERSION` | No — workflow sets it | GitHub Actions | CI | Generated control | `24` | Per workflow |
| `ALLOW_INSECURE_LOOPBACK_URLS` | No — CI-only workflow setting | Frontend CI | CI | Generated control | `true` for loopback mock URLs only | Per build |
| `PLAYWRIGHT_BASE_URL` | No | Frontend test owner | L/CI | Public/non-secret | `http://127.0.0.1:3010` | Per test run |
| `PLAYWRIGHT_MOCK_API_PORT` | Conditional | Frontend test owner | L/CI | Public/non-secret | `5011` for the deterministic mock; `test:e2e:local` sets it | Per build/test run |
| `PLAYWRIGHT_REUSE_SERVER` | No | Frontend test owner | L/CI | Public/non-secret | `false` | Per test run |
| `PLAYWRIGHT_SKIP_WEBSERVER` | No | Frontend test owner | L/CI | Public/non-secret | blank; set only when servers are already managed | Per test run |

The normal local frontend E2E command sets the mock variables, builds with
them, and runs Playwright. Direct `npm run test:e2e` requires the existing build
to have been created with the same `NEXT_PUBLIC_API_URL` and
`PLAYWRIGHT_MOCK_API_PORT` values.

## VALORANT two-service E2E contract

The CI job skips this E2E when `VALORANT_PLATFORM_ACCESS_TOKEN` is unset. When
enabled, it checks out the sibling repository and passes the following contract
to `npm run test:valorant:e2e`. All values are owner-maintained dedicated-test
values; none are repository facts.

| Variable | Required? | Owner | Applies | Classification | Safe placeholder/default | Restart/redeploy impact |
| --- | --- | --- | --- | --- | --- | --- |
| `VALORANT_PLATFORM_ACCESS_TOKEN` | Conditional; required to enable CI job | CI/repository owner | CI | Secret | `<read-only checkout token>` | Per workflow |
| `VALORANT_PLATFORM_REPO` | Yes for E2E | E2E owner/script | L/CI | Public/path-sensitive | `<absolute path to valorant-platform-backend>` | Per test run |
| `E2E_VAL_DATABASE_URL` | Yes for E2E | E2E owner | L/CI | Secret | `<dedicated valorant-schema PostgreSQL URL>` | Per test run |
| `E2E_QUEST_DATABASE_URL` | Yes for E2E | E2E owner | L/CI | Secret | `<dedicated public-schema PostgreSQL URL>` | Per test run |
| `E2E_ADMIN_EMAIL` | Yes for E2E | E2E owner | L/CI | Test credential | `<dedicated test admin email>` | Per test run |
| `E2E_ADMIN_PASSWORD` | Yes for E2E | E2E owner | L/CI | Secret/test credential | `<dedicated test admin password>` | Per test run |
| `E2E_SAVED_TEAM_A_ID` | Yes for E2E | E2E owner | L/CI | Test data identifier | `<SavedTeam UUID>` | Per test run |
| `E2E_SAVED_TEAM_B_ID` | Yes for E2E | E2E owner | L/CI | Test data identifier | `<SavedTeam UUID>` | Per test run |
| `E2E_PLAYER_A` | Yes for E2E | E2E owner | L/CI | Test data | `{\"name\":\"PlayerA\",\"tag\":\"TAG\"}` as a JSON-encoded value | Per test run |
| `E2E_PLAYER_B` | Yes for E2E | E2E owner | L/CI | Test data | `{\"name\":\"PlayerB\",\"tag\":\"TAG\"}` as a JSON-encoded value | Per test run |
| `E2E_MATCH_HENRIK_ID` | Yes for E2E | E2E owner | L/CI | Test data identifier | `<Henrik fixture match ID>` | Per test run |
| `E2E_MATCH_UUIDS` | Yes for E2E | E2E owner | L/CI | Test data identifiers | `<comma-separated fixture match UUIDs>` | Per test run |
| `E2E_ANCHOR_MISMATCH_SERIES` | Yes for E2E | E2E owner | L/CI | Test data identifier | `<pre-seeded draft series ID>` | Per test run |

The E2E test automatically supplies its local child-process values, including
the Henrik mock on `18000`, FastAPI on `8000`, Quest on `5001`, the fixture
shared secret, and the test-process Quest/ FastAPI integration settings. The
authoritative detailed contract is
[backend/tests/valorant-e2e/README.md](../backend/tests/valorant-e2e/README.md)
and the [E2E test](../backend/tests/valorant-e2e/valorant-e2e.test.js).

## Deployment and release controls

These controls are workflow inputs, repository variables, environment values,
or secrets rather than application `.env` settings. They are listed here so
operators can distinguish required enablement from generated workflow values.

| Variable/control | Required? | Owner | Applies | Classification | Safe placeholder/default | Restart/redeploy impact |
| --- | --- | --- | --- | --- | --- | --- |
| `BACKEND_DEPLOY_ENABLED` | Conditional; required to enable CD | Repository owner | CI/P | Public control | `false` | Per deployment workflow |
| `DEPLOY_SHA` | No — generated from `github.sha` by backend CD | GitHub Actions | CI | Generated control | `<full 40-character commit SHA>` | Per deployment workflow |
| `deploy_sha` | Yes for a frontend deploy dispatch | Repository owner | CI/P | Public workflow input | `<full 40-character main commit SHA>` | Per deployment workflow |
| `BACKEND_SSH_HOST` | Yes when backend CD enabled | Repository owner | CI/P | Secret/environment value | `<pinned backend host>` | Per deployment |
| `BACKEND_SSH_PORT` | No — workflow defaults to `22` | Repository owner | CI/P | Secret/environment value | `22` | Per deployment |
| `BACKEND_SSH_USER` | Yes when backend CD enabled | Repository owner | CI/P | Secret/environment value | `deploy` | Per deployment |
| `BACKEND_SSH_PRIVATE_KEY` | Yes when backend CD enabled | Repository owner | CI/P | Secret | `<deploy SSH private key>` | Per deployment |
| `BACKEND_SSH_HOST_KEY` | Yes when backend CD enabled | Repository owner | CI/P | Secret | `<pinned known_hosts line>` | Per deployment |
| `BACKEND_APP_DIR` | Yes when backend CD enabled | Repository owner | CI/P | Secret/environment value | `<backend checkout path>` | Per deployment |
| `BACKEND_PM2_PROCESS` | No — workflow defaults to `quest-backend` | Repository owner | CI/P | Secret/environment value | `quest-backend` | Per deployment |
| `BACKEND_HEALTHCHECK_URL` | No — workflow defaults to `http://127.0.0.1:5001/api/health` | Repository owner | CI/P | Secret/environment value | `http://127.0.0.1:5001/api/health` | Per deployment |
| `BACKEND_DESTRUCTIVE_MIGRATION_APPROVAL_SHA` | Conditional; required for destructive migrations | Repository owner | CI/P | Secret | `<40-character approved commit SHA>` | Per deployment |
| `FRONTEND_DEPLOY_ENABLED` | Conditional; required to enable frontend deploy | Repository owner | CI/P | Public control | `false` | Per deployment workflow |
| `PRODUCTION_API_URL` | Yes when frontend deploy enabled | Repository owner | CI/P | Public/environment value | `<production API origin>` | Per deployment |
| `VERCEL_TOKEN` | Yes when frontend deploy enabled | Repository owner | CI/P | Secret | `<Vercel token>` | Per deployment |
| `VERCEL_ORG_ID` | Yes when frontend deploy enabled | Repository owner | CI/P | Secret | `<Vercel organization ID>` | Per deployment |
| `VERCEL_PROJECT_ID` | Yes when frontend deploy enabled | Repository owner | CI/P | Secret | `<Vercel project ID>` | Per deployment |
| `MOBILE_ADMIN_ANDROID_CERT_SHA256` | Conditional; required for certificate repair/release verification | Repository owner | CI/P | Public/non-secret fingerprint | `<colon-separated release certificate SHA-256>` | Per deployment |
| `repair_mobile_android_fingerprint` | No | Repository owner | CI | Workflow input | `false` | Per workflow |
| `repair_mobile_oauth_redirect` | No | Repository owner | CI | Workflow input | `false` | Per workflow |
| `repair_database_ssl` | No | Repository owner | CI | Workflow input | `false` | Per workflow |
| `repair_legacy_media` | No | Repository owner | CI | Workflow input | `false` | Per workflow |
| `optimize_tournament_banners` | No | Repository owner | CI | Workflow input | `false` | Per workflow |
| `optimize_event_album_photos` | No | Repository owner | CI | Workflow input | `false` | Per workflow |
| `initialize_match_rooms` | No | Repository owner | CI | Workflow input | `false` | Per workflow |
| `ANDROID_KEYSTORE_BASE64` | Yes for automated APK signing | Mobile release owner | CI/P | Secret | `<base64-encoded release keystore>` | Per release |
| `ANDROID_KEYSTORE_PASSWORD` | Yes for automated APK signing | Mobile release owner | CI/P | Secret | `<keystore password>` | Per release |
| `ANDROID_KEY_ALIAS` | Yes for automated APK signing | Mobile release owner | CI/P | Secret | `<signing key alias>` | Per release |
| `ANDROID_KEY_PASSWORD` | Yes for automated APK signing | Mobile release owner | CI/P | Secret | `<signing key password>` | Per release |

The APK workflow derives internal `QUEST_ANDROID_*` variables from the release
secrets and sets `QUEST_ANDROID_KEYSTORE_PATH` for the runner; those are not
user-maintained configuration values.

## Backup and recovery controls

These values are configured in the protected backup environment, not in the
tracked application examples.

| Variable | Required? | Owner | Applies | Classification | Safe placeholder/default | Restart/redeploy impact |
| --- | --- | --- | --- | --- | --- | --- |
| `BACKUP_ENV_FILE` | No — script default exists | Operations owner | D/P | Path-sensitive | `/etc/quest-esports-backup.env` | Per command |
| `BACKUP_ROOT` | Yes for backup | Operations owner | D/P | Path-sensitive | `<absolute backup staging path>` | Per backup service |
| `BACKUP_AGE_RECIPIENT` | Yes for backup | Operations owner | D/P | Public encryption key | `<age public recipient>` | Per backup service |
| `BACKUP_RCLONE_REMOTE` | Yes for backup | Operations owner | D/P | Secret/path-sensitive | `<approved rclone remote:path>` | Per backup service |
| `RCLONE_CONFIG` | Yes for backup | Operations owner | D/P | Secret/path-sensitive | `<protected rclone config path>` | Per backup service |
| `BACKUP_LOCAL_RETENTION_DAYS` | No | Operations owner | D/P | Public/non-secret | `7` | Per backup run |
| `BACKUP_MAX_AGE_MINUTES` | No — script defaults to `2160` | Operations owner | D/P | Public/non-secret | `<approved maximum age in minutes>`; implementation default is `2160` | Per freshness run |
| `BACKUP_FAILURE_WEBHOOK_URL` | No | Operations owner | D/P | Secret | `<approved HTTPS alert webhook>` | Per notifier run |
| `BACKUP_REMOTE_RETENTION_DAYS` | Conditional; required for retention | Operations owner | D/P | Public/non-secret | `<owner-approved retention days>` | Per prune run |
| `BACKUP_REMOTE_MINIMUM_RECOVERY_POINTS` | Conditional; required for retention | Operations owner | D/P | Public/non-secret | `<minimum recovery-point count>` | Per prune run |
| `RETENTION_CONFIRMATION` | Conditional; required to delete | Operations owner | D/P | Destructive control | `PRUNE_QUEST_PRODUCTION` only for an approved deletion | Per prune run |
| `BACKUP_AGE_IDENTITY_FILE` | Yes for restore | Recovery owner | D/P | Secret/path-sensitive | `<offline age identity path>` | Per restore run |
| `RESTORE_CONFIRMATION` | Yes for restore | Recovery owner | D/P | Destructive control | `RESTORE_QUEST_PRODUCTION` only for an approved restore | Per restore run |
| `RESTORE_COUNTDOWN_SECONDS` | No | Recovery owner | D/P | Public/non-secret | `10` | Per restore run |

## Handling changes

Use package-owned environment files copied from the tracked examples:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
Copy-Item mobile-admin/.env.example mobile-admin/.env.local
```

The tracked mobile-admin example contains deployment-oriented URLs. Copying it
is **not** a safe launch configuration by itself. Before starting Expo, use the
local emulator-forwarded or physical-device HTTPS values and
`EXPO_PUBLIC_OAUTH_REDIRECT_URL=questadmin://oauth`. Expo public values are
bundled into the app, so restart Expo after editing them and rebuild/re-release
when producing an installable app.

Backend values are read at process startup, so restart the backend after
changing them. Frontend `NEXT_PUBLIC_*` values are build-time inputs, so
rebuild/redeploy after changing them. Frontend server-only maintenance values
also require a redeploy in hosted environments.
