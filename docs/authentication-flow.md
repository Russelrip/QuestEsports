# Authentication Flow

This project uses cookie-based session authentication with server-side session storage in PostgreSQL. The browser never stores a bearer token for API access.

## Components

- `User`
- `Session`
- `VerificationToken`
- `PasswordResetToken`
- `EmailChangeToken`

## Session Model

- On successful login, the backend generates a random session token.
- Only the SHA-256 hash of that token is stored in the `sessions` table.
- The raw token is sent to the browser in an `HttpOnly` cookie.
- Cookie attributes:
  - `HttpOnly`
  - `Path=/`
  - `SameSite=Lax`
  - `Secure` in production
  - explicit `Expires`

The cookie name comes from `SESSION_COOKIE_NAME`.

## Login Flow

1. The user submits `emailOrUsername` and `password` to `POST /api/login`.
2. The backend looks up the user by normalized email or username.
3. The password is validated with bcrypt.
4. Failed-login counters are reset on success, or incremented on failure.
5. If the account has MFA enabled, the backend returns a short-lived login challenge instead of creating the session immediately.
6. Otherwise, a session record is created in the database.
7. The backend sends the session cookie.
8. The frontend stores the returned user object in `AuthProvider`.

## Account Lockout

- Failed password attempts increment `failedLoginCount`.
- After `LOGIN_LOCKOUT_THRESHOLD` consecutive failures, the account is locked for `LOGIN_LOCKOUT_MINUTES`.
- Successful login clears the failure counters and lockout timestamp.

## MFA Challenge Login

1. The user submits credentials to `POST /api/login`.
2. If `mfaEnabled` is true, the backend creates a `LoginChallenge` that expires after `LOGIN_CHALLENGE_MINUTES`.
3. The frontend renders the MFA challenge step and posts to `POST /api/login/mfa`.
4. The user can complete the challenge with either:
   - a TOTP authenticator code
   - a one-time backup code
5. On success, the challenge is marked used, a normal session is created, and the login continues as usual.

Important notes:

- Backup codes are single-use.
- MFA login does not set the session cookie until the challenge is completed.

## Session Rehydration

1. On frontend boot, `AuthProvider` calls `GET /api/me`.
2. The backend reads the session cookie.
3. The backend hashes the cookie token and looks up the session record.
4. Expired sessions are removed.
5. If valid, the request is decorated with `req.user` and `req.session`.
6. The frontend updates local auth state.

## Logout Flow

1. The frontend posts to `POST /api/logout`.
2. The backend deletes the session by token hash.
3. The backend writes an expired session cookie.
4. The frontend clears its local auth state.

## Signup And Email Verification

1. The user signs up through `POST /api/signup`.
2. The backend validates fields, hashes the password, and creates the user.
3. The backend generates a 24-hour verification token.
4. Only the token hash is stored in `verification_tokens`.
5. The raw token is sent in an email link pointing to the frontend `APP_URL`.
6. The user opens the link, which lands on the frontend verification page.
7. The frontend calls `GET /api/email-verification/verify?token=...`.
8. The backend verifies the token, marks the user as verified, sets `emailVerifiedAt`, and consumes the token.

Important note:

- Signup does not log the user in automatically.
- If SMTP is not configured, account creation still succeeds but the verification email is skipped.

## Resend Verification

1. The user submits their email to `POST /api/email-verification/resend`.
2. If the account exists and is still unverified, the backend issues a new verification token.
3. Older unused verification tokens for that user are marked used.

## Password Reset

1. The user submits `POST /api/forgot-password`.
2. If the email exists, the backend creates a 20-minute reset token.
3. Only the hash is stored in `password_reset_tokens`.
4. The user opens the email link on the frontend reset-password page.
5. The frontend posts `token` and `newPassword` to `POST /api/reset-password`.
6. The backend validates the token, hashes the new password, consumes the token, and deletes all active sessions for that user.

Important note:

- If SMTP is not configured, forgot-password requests do not fail the API, but no email is delivered.

## Email Change Flow

1. An authenticated user requests an email change through `POST /api/email-change/request`.
2. The backend verifies the current password.
3. The new email is checked for conflicts against both active and pending emails on other users.
4. The user record is updated with `pendingEmail` and `pendingEmailNormalized`.
5. A 24-hour email change token is created.
6. A confirmation link is sent to the new address.
7. The user opens the frontend confirmation page.
8. The frontend calls `GET /api/email-change/confirm?token=...`.
9. The backend promotes `pendingEmail` to the primary email, clears pending values, marks the email verified, and consumes outstanding related tokens.

Important note:

- The old email stays active until the new email is confirmed.
- If SMTP is not configured, the request can be accepted but the confirmation email is skipped.

## OAuth Login Flow

Supported providers:

- Google
- Discord

Flow:

1. The frontend starts auth through `/api/auth/google/start` or `/api/auth/discord/start`.
2. The backend signs a short-lived OAuth `state` payload that contains the provider and optional redirect path.
3. The provider redirects back to `/api/auth/:provider/callback`.
4. The backend exchanges the authorization code for an access token.
5. The backend loads the provider profile, finds or creates a linked local user, creates a session, and redirects the browser to the frontend.

Important notes:

- OAuth account links are stored in `oauth_accounts`.
- New OAuth-only users still receive a local `User` record and random password hash.
- `APP_URL` must be configured correctly for the final redirect to the frontend.
- The provider redirect URI must match the backend callback URL exactly.
- If OAuth is not configured, leave the provider client ID and secret blank; placeholder strings are treated as invalid configuration.

## MFA Management

Authenticated users can manage MFA from the profile security area.

### Setup

1. The frontend calls `GET /api/mfa/setup`.
2. The backend generates a TOTP secret, encrypts it, and stores it in `mfa_credentials`.
3. The backend returns the raw secret and an `otpauth://` URL for QR-code setup.
4. The frontend confirms setup through `POST /api/mfa/verify-setup`.
5. The backend validates the code, enables MFA, and issues backup codes.

### Disable

1. The frontend posts to `POST /api/mfa/disable`.
2. The backend verifies the current password.
3. If MFA is enabled, the user must also provide an authenticator code or backup code.
4. The backend deletes backup codes, login challenges, and MFA credentials, then disables MFA.

### Regenerate backup codes

1. The frontend posts to `POST /api/mfa/backup-codes/regenerate`.
2. The backend verifies the current password and a second factor.
3. Existing backup codes are replaced with a new one-time set.

## Session Management

Authenticated users can review and revoke sessions:

- `GET /api/sessions`
- `DELETE /api/sessions/:sessionId`
- `POST /api/sessions/revoke-others`

Each session stores:

- creation time
- last seen time
- expiry
- remember-me flag
- user agent
- IP address

The backend also uses the stored user-agent and IP fingerprint to send a security alert email on sign-in from a new device or location.

## Authorization Layers

### `attachSession`

- Runs on routes that need optional or required auth.
- Loads `req.user` from the session cookie if possible.

### `requireAuth`

- Rejects unauthenticated requests with `401`.

### `requireAdmin`

- Rejects non-admin users with `403`.

### `requireVerifiedEmail`

- Rejects logged-in users whose email is not verified.
- Currently used on tournament registration submission.

## Frontend Protection

- `AuthProvider` manages user state in the client.
- `AdminGuard` redirects:
  - unauthenticated users to `/login`
  - non-admin users to `/`
- Profile and admin experiences rely on the session returned by `/api/me`.

## CSRF And Cookie Safety

Unsafe methods are guarded by backend origin checks:

- Safe methods: `GET`, `HEAD`, `OPTIONS`
- Unsafe methods require an allowed `Origin` or `Referer`
- If a session cookie is present and no trusted origin is supplied, the request is blocked

This is especially important because authentication is cookie-based.

## Session Lifetimes

- Standard session lifetime: `SESSION_TTL_DAYS`
- Remember-me lifetime: `REMEMBER_ME_SESSION_TTL_DAYS`

## Production Considerations

- Use HTTPS so the `Secure` cookie flag is active.
- Set `TRUST_PROXY` correctly when the backend runs behind Nginx, a load balancer, or a platform proxy.
- Keep frontend and backend origins aligned with `CORS_ORIGIN`, `APP_URL`, and `NEXT_PUBLIC_API_URL`.
- `SESSION_COOKIE_NAME` is required at boot because the backend does not fall back to a default cookie name.
- Set `AUTH_ENCRYPTION_KEY` in production so MFA secrets and OAuth state signing do not depend on fallback material.
- OAuth providers require their client IDs, secrets, callback URLs, and a valid `APP_URL`.
- Replace the placeholder monitoring adapter if you need auth/security observability in production.
