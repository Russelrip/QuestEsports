# Quest Admin Android App

Quest Admin is the private Android operations client for Quest E-sports. It uses the production API and supports dashboard monitoring, tournament registrations, payment review and reconciliation, event-ticket QR scanning, merchandise fulfilment, recruitment, contact messages, teams, users, tournaments, products, event series, game categories, rulebooks, and session revocation.

## Security model

- Admin username/password login issues a mobile session after the credentials and admin role are validated.
- Google and Discord login can issue a mobile session after the provider identity resolves to an existing admin account.
- Social sign-in returns a two-minute, single-use grant to the APK; the reusable bearer token is issued only through the follow-up API exchange.
- The APK stores that token with Expo SecureStore backed by Android Keystore.
- No password, GitHub token, signing key, or private API credential is bundled into the APK.
- Operational data stays in memory and is not persisted for offline use.
- Browser sessions continue using the existing `HttpOnly` cookie and CSRF protections.

Admins can sign in with a password or a linked Google or Discord account.

## Ticket scanner

Open the Tickets tab, select the event at the gate, and grant camera access. Each QR is checked live against the production database. A green result admits the attendee; red results identify already-used, invalid, cancelled, unpaid, or wrong-event tickets and must not be admitted. The scanner records all attempts and does not support offline admission.

## Local development

Requirements: Node.js 24, Android Studio/SDK, and a reachable backend.

```powershell
Copy-Item .env.example .env.local
npm ci
npm run typecheck
npm run android
```

For a physical device using a local API, set `EXPO_PUBLIC_API_URL` to the computer's LAN HTTPS address. Production defaults to `https://api.questesports.lk`.

## Private APK releases

The GitHub workflow runs for tags matching `admin-vMAJOR.MINOR.PATCH`:

```powershell
git tag admin-v1.0.0
git push origin admin-v1.0.0
```

Configure these repository Actions secrets first:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Create the long-lived signing keystore once. Let `keytool` prompt for the passwords so they do not appear in shell history:

```powershell
New-Item -ItemType Directory -Force 'C:\secure'
keytool -genkeypair -v -storetype JKS -keystore 'C:\secure\quest-admin-release.jks' -alias quest-admin -keyalg RSA -keysize 2048 -validity 10000
```

Create the base64 value on Windows without printing it to the terminal:

```powershell
$bytes = [IO.File]::ReadAllBytes('C:\secure\quest-admin-release.jks')
$encoded = [Convert]::ToBase64String($bytes)
$encoded | Set-Clipboard
```

The workflow generates the native Android project, signs the release APK, adds a SHA-256 checksum, and attaches both files to the private repository release. Keep an encrypted offline backup of the keystore: Android updates must always use the same signing certificate.

Private GitHub assets require GitHub authentication, so updates are intentionally installed manually. Never embed a GitHub personal access token in the app.

## Verification

```powershell
npm run typecheck
npm test
npm run doctor
$env:CI='1'; npm run prebuild:android
```

The generated `android/` directory is intentionally ignored. Release builds regenerate it from `app.json` and the local config plugin.
