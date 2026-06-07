# Email System

This document is the source of truth for transactional email in Quest Esports. It covers which emails exist, who receives them, what triggers them, how links and tokens work, and how delivery is processed.

## Delivery Architecture

Email is asynchronous and database-backed:

1. A backend service handles an action such as signup, password reset, or tournament registration.
2. The service creates any required token and updates the related business data.
3. A mail helper enqueues an `email.send` record in the `background_jobs` table.
4. The API process polls the queue when `JOB_WORKER_ENABLED=true`.
5. The worker builds the HTML and plain-text email and sends it through Nodemailer using SMTP.
6. The job is marked `succeeded`, retried after a failure, or marked `failed` after its maximum attempts.

The API response does not wait for SMTP delivery. Email enqueueing is best effort and callers log enqueue failures without rolling back the completed account or registration action. This means a successful API response does not confirm that a job was queued or that the recipient received the email.

### Main implementation files

- Queue and retry behavior: `backend/src/lib/jobs.js`
- Mail job types and subjects: `backend/src/lib/mail/mail-job-definitions.js`
- Shared HTML and plain-text templates: `backend/src/lib/mail/templates.js`
- SMTP sending and action URL generation: `backend/src/lib/mail/sendMail.js`
- Nodemailer transport configuration: `backend/src/lib/mail/transporter.js`
- Individual enqueue helpers: `backend/src/lib/mail/send*Email.js`

## Email Inventory

| Email | Recipient | Trigger | Subject | Link or action | Lifetime |
| --- | --- | --- | --- | --- | --- |
| Account verification | The signup email address | Successful `POST /api/signup` | `Verify your Quest Esports account` | `${APP_URL}/verify-email?token=...` | 24 hours |
| Resent account verification | The existing unverified account email | Eligible `POST /api/email-verification/resend` | `Verify your Quest Esports account` | `${APP_URL}/verify-email?token=...` | 24 hours |
| Password reset request | The existing account email | Eligible `POST /api/forgot-password` | `Reset your Quest Esports password` | `${APP_URL}/reset-password?token=...` | 20 minutes |
| Email change confirmation | The requested new email address | Successful authenticated `POST /api/email-change/request` | `Confirm your new Quest Esports email` | `${APP_URL}/confirm-email-change?token=...` | 24 hours |
| Team invitation | Every non-captain roster member who is not already accepted | Successful tournament registration | `Quest Esports team invitation` | `${APP_URL}/team-invite?token=...` | 72 hours |
| Security alert | The account's current primary email | A supported account-security event | Event-specific | Profile link by default | No token |

All templates include HTML and plain-text versions. User-provided values are escaped before being inserted into HTML.

## Trigger Details

### Account verification

Initial verification is triggered after signup creates the user and a verification token. Signup does not sign the user in.

Resend verification is triggered only when the submitted email is valid, belongs to an existing account, and that account is still unverified. The endpoint always returns a generic success message so callers cannot use it to discover whether an account exists.

Creating a new verification token marks all older unused verification tokens for that user as used.

The frontend verification page calls:

```text
GET /api/email-verification/verify?token=...
```

Successful verification marks the email as verified and consumes the token.

### Password reset

A reset email is queued only when the submitted email is valid and belongs to an existing account. The endpoint returns the same generic success response for unknown addresses.

Creating a new reset token marks older unused password reset tokens for that user as used. After a successful reset:

- the reset token is consumed
- all active sessions are deleted
- a `Password reset completed` security alert is queued

### Email change confirmation

An authenticated user requests the change using their current password. The new address must not already be another user's active or pending email.

The confirmation email goes to the **new address**, while the old address remains the account's primary email until confirmation. A new request invalidates older unused email-change tokens for that user.

After confirmation:

- the pending email becomes the primary email
- the new email is marked verified
- outstanding verification tokens are invalidated
- all active sessions are deleted
- an `Email address changed` security alert is queued to the new primary email

The current implementation does not send a separate email-change warning to the old address.

### Team invitations

Team invitations are created as part of a successful tournament registration. The registration synchronizes the captain's saved team roster and queues invitations for non-captain members who are not already accepted.

The captain is linked to their account, recorded as accepted, and does not receive an invite. Existing accepted roster members with linked accounts also do not receive another invite. Pending invite links expire after 72 hours.

The invite page previews the invitation through:

```text
GET /api/team-invite?token=...
```

The recipient accepts or declines through:

```text
POST /api/team-invite/respond
```

Responding requires a logged-in, verified account whose email matches the invited address. Acceptance links the account to both the actual tournament-registration member and the reusable saved-team member. Registration verification becomes `verified` when every member accepts, `flagged` if anyone declines, and remains `pending` while responses are outstanding.

### Security alerts

Security alerts use one shared template with event-specific subjects and messages. They are queued for:

| Event | Trigger | Subject |
| --- | --- | --- |
| New sign-in | A successful password, MFA, Google, or Discord login from an IP address and user-agent pair not found in active sessions | `Quest Esports new sign-in detected` |
| MFA enabled | Successful MFA setup confirmation | `Quest Esports MFA enabled` |
| MFA disabled | Successful MFA removal | `Quest Esports MFA disabled` |
| Backup codes regenerated | Successful backup-code regeneration | `Quest Esports backup codes regenerated` |
| Email address changed | Successful email-change confirmation | `Quest Esports email address changed` |
| Password reset completed | Successful password reset using an emailed reset token | `Quest Esports password reset completed` |
| Password changed | Successful authenticated password change | `Quest Esports password changed` |

Security alerts default to a `Review Account` button linking to `${APP_URL}/profile`. If `APP_URL` is blank, the helper omits the button and URL, but mail delivery is also considered unconfigured and will be skipped.

## Actions That Do Not Send Email

The following areas collect or display email addresses but do not currently send transactional email:

- contact-form submissions are stored for the admin contact inbox
- recruitment applications are stored for admin review
- tournament registration does not send a captain confirmation email
- tournament registration status changes do not notify the captain
- admin user, tournament, registration, contact, and media actions do not send email
- the platform does not send marketing or newsletter email

## Tokens And Links

Action tokens are cryptographically random 32-byte values represented as hexadecimal strings. The raw token is placed in the email link, while only its SHA-256 hash is stored in PostgreSQL.

Verification, password-reset, and email-change tokens are single-use. Issuing a replacement marks older unused tokens of the same type as used. Team invite token hashes are stored on pending tournament-registration member records and mirrored on the current saved-team member record.

`APP_URL` must be the public frontend origin because email links land on frontend pages. For example:

```env
APP_URL=https://questesports.lk
```

Do not set `APP_URL` to the backend API origin.

## SMTP And Worker Configuration

Required for real delivery:

```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_your_resend_api_key
MAIL_FROM="Quest Esports <no-reply@mail.questesports.lk>"
APP_URL=https://questesports.lk
JOB_WORKER_ENABLED=true
JOB_WORKER_POLL_MS=5000
JOB_WORKER_MAX_ATTEMPTS=5
```

Mail is considered configured only when `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, and `APP_URL` all have values.

- Port `465` enables a secure SMTP connection.
- Other ports, including `587`, use `secure: false`; STARTTLS behavior then depends on the SMTP server.
- `MAIL_FROM` controls the sender shown to recipients.
- `JOB_WORKER_POLL_MS` controls how often the built-in worker polls.
- `JOB_WORKER_MAX_ATTEMPTS` controls the maximum delivery attempts for newly queued jobs.

If SMTP is incomplete, the worker logs a warning, skips delivery, and marks the job as succeeded. This supports local development, but it also means misconfigured production SMTP will not leave failed jobs for retry.

If `JOB_WORKER_ENABLED=false`, email jobs remain queued until a worker-enabled API instance processes them.

## Retry And Queue Behavior

- The worker processes up to 10 jobs per tick.
- Failed SMTP sends are retried until `JOB_WORKER_MAX_ATTEMPTS` is reached.
- Retry delay is linear: 30 seconds multiplied by the completed attempt count.
- Jobs locked in `processing` for more than five minutes can be reclaimed.
- Multiple API instances can poll safely through serializable claim transactions.
- Final failures remain in `background_jobs` with `status=failed` and `lastError`.

The job payload contains the recipient address and, for action emails, the raw action token. Protect database access and avoid exposing queue payloads in logs or admin tools.

## Operational Checks

After deploying email-related changes:

1. Confirm `APP_URL` generates the expected public frontend links.
2. Trigger each action email and confirm both HTML and plain-text content.
3. Confirm security alerts reach the account's current primary email.
4. Check `background_jobs` for queued or failed jobs and application logs for skipped deliveries.
5. Confirm the SMTP provider accepts `MAIL_FROM` for the configured sending domain.
6. Confirm replacement verification, reset, and email-change links invalidate older links.
7. Confirm expired team invitations can no longer be accepted or declined.

## Current Limitations

- There is no admin UI for inspecting or replaying email jobs.
- Missing SMTP configuration is treated as a successful skipped job.
- There is no separate warning sent to the old address after an email change.
- Email delivery has queue unit coverage, but the repository does not include an end-to-end SMTP delivery test.
- The built-in database worker is intended for low-volume transactional email. Move delivery to a dedicated worker or external queue if volume grows substantially.
