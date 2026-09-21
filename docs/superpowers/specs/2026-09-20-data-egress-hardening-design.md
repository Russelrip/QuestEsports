# Data Egress Hardening

## Status

Approved for implementation after repository audit and user selection of the
full containment option.

## Goal

Reduce the chance that untrusted or misconfigured URLs can redirect users,
send authenticated browser requests to unintended hosts, or expose sensitive
backend error data through observability integrations.

This work does not claim that an actual data theft occurred. The audit found no
hidden telemetry or confirmed repository-based exfiltration path; the only
credential requiring immediate operational action is the local
`HENRIK_API_KEY`, which must be rotated outside the repository if active.

## Decisions

- Browser notification links accept same-origin relative paths only.
- Service-worker notification clicks accept same-origin relative paths only.
- Authenticated API URL construction rejects absolute, `data:`, and `blob:`
  destinations. Public media URL handling remains separate and compatible.
- Payment checkout submission accepts only the configured PayHere origin and
  preserves the existing server-generated checkout fields.
- Observability endpoints must be explicit HTTPS destinations from an approved
  host allowlist; invalid destinations are disabled rather than requested.
- Observability payloads contain request metadata and sanitized error summaries,
  not raw upstream response bodies or unrestricted error stacks.
- Tests cover malicious schemes, external origins, payload redaction, and
  valid existing integrations.
- No new dependency is introduced, and no secret value is written to source or
  documentation.

## Data-flow boundaries

### Browser navigation

The backend owns notification action URLs today, but the frontend treats API
values as untrusted. A shared same-origin path validator will normalize valid
relative paths and fall back to a safe local destination for invalid values.
The service worker will apply the same rule before calling `clients.openWindow`.

### API requests

`buildApiUrl` is used by authenticated API helpers and must not preserve an
arbitrary absolute URL. Absolute external resources need an explicit public
resource helper or the caller's own provider-specific validation, not a bypass
in the authenticated API builder.

### Payments

PayHere is an intentional cross-origin POST boundary. The server remains the
source of checkout configuration; the browser additionally checks the action
URL origin against the known live/sandbox PayHere origins before constructing
the form. Invalid responses fail closed without submitting fields.

### Observability

Monitoring and log-drain URLs are deployment-controlled configuration, not
request input. The transport will validate destinations before queueing work,
requiring HTTPS and an explicit configured host allowlist. Error serialization
will retain diagnostic names/messages/codes after redaction while excluding
raw stack traces and nested upstream response data from remote payloads.

## Error handling

- Invalid browser destinations fall back to `/profile` or are ignored by the
  service worker.
- Invalid payment destinations throw a user-safe checkout error and do not
  submit a form.
- Invalid observability destinations are skipped and reported through local
  logging without recursive remote shipping.
- Existing valid same-origin navigation, PayHere modes, and configured
  observability integrations remain functional.

## Verification

- Unit tests prove URL validators reject `javascript:`, protocol-relative,
  `data:`, `blob:`, and foreign-origin URLs while accepting valid local paths.
- Frontend tests prove notification rendering and payment submission fail closed.
- Service-worker tests or a deterministic extracted helper prove external push
  URLs are not opened.
- Backend tests prove invalid observability configuration never invokes fetch,
  valid allowlisted HTTPS destinations do, and remote error payloads contain no
  stack or raw upstream body.
- Repository checks include targeted tests, lint/typecheck where configured,
  and secret scanning without printing the local `.env` value.

## Operational follow-up

If `HENRIK_API_KEY` is active, revoke and replace it in the secret manager and
deployment environment. Review deployment logs, shell history, editor backup,
and sync locations for accidental exposure. This code change cannot determine
whether a verbal claim corresponds to a real external copy of data.
