# Quest Admin Android App

Quest Admin is the private Android operations client for Quest E-sports. It uses the production API and supports dashboard monitoring, tournament registrations, payment review and reconciliation, event-ticket QR scanning, merchandise fulfilment, recruitment, contact messages, teams, users, tournaments, products, event series, game categories, rulebooks, and session revocation.

## Security model

- Admin username/password login issues a mobile session after the credentials and admin role are validated.
- Google and Discord login can issue a mobile session after the provider identity resolves to an existing admin account.
- Local social sign-in uses the custom-scheme redirect `questadmin://oauth`. Production social sign-in returns a two-minute, single-use grant through the verified `https://api.questesports.lk/mobile-admin-oauth` Android App Link. The grant is bound to an app-generated PKCE verifier, and the reusable bearer token is issued only through the follow-up API exchange.
- The APK stores that token with Expo SecureStore backed by Android Keystore.
- No password, GitHub token, signing key, or private API credential is bundled into the APK.

Production must set `MOBILE_ADMIN_OAUTH_REDIRECT_URL=https://api.questesports.lk/mobile-admin-oauth` and `MOBILE_ADMIN_ANDROID_CERT_SHA256` to the release certificate fingerprint. The backend serves that fingerprint from `/.well-known/assetlinks.json`; verify the URL from an unsigned browser before distributing an APK.
- Operational data stays in memory and is not persisted for offline use.
- Browser sessions continue using the existing `HttpOnly` cookie and CSRF protections.

Admins can sign in with a password or a linked Google or Discord account.

## Ticket scanner

Open the Tickets tab, select the event at the gate, and grant camera access. Each QR is checked live against the production database. A green result admits the attendee; red results identify already-used, invalid, cancelled, unpaid, or wrong-event tickets and must not be admitted. The scanner records all attempts and does not support offline admission.

## Local development

Requirements: Node.js 24 guidance, Android Studio/SDK, and a reachable backend. This package has no `engines` field; use the project Node 24 version used by the other packages and workflows.

```powershell
Copy-Item .env.example .env.local
npm ci
npm run typecheck
npm run android
```

Before local launch, set the local values in `mobile-admin/.env.local`:

```env
EXPO_PUBLIC_API_URL=http://localhost:5001
EXPO_PUBLIC_SITE_URL=http://localhost:3000
EXPO_PUBLIC_OAUTH_REDIRECT_URL=questadmin://oauth
```

Android `localhost` is device- or emulator-local; it does not automatically
refer to the development computer. For an Android emulator, forward the local
API and site ports where supported:

```powershell
adb reverse tcp:5001 tcp:5001
adb reverse tcp:3000 tcp:3000
```

With that forwarding, the local values above can use `localhost`. For a
physical device, replace `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_SITE_URL` with
reachable HTTPS development origins. Configure the backend `API_PUBLIC_URL`,
`APP_URL`, and `CORS_ORIGIN` to the matching origins, and register the exact
Google and Discord backend callback URLs from the setup guide with each
provider. Keep `MOBILE_ADMIN_OAUTH_REDIRECT_URL` and
`EXPO_PUBLIC_OAUTH_REDIRECT_URL` set to the local custom scheme
`questadmin://oauth`; the provider callback returns to the backend, which then
hands the one-time grant to that app scheme. Do not copy production API,
provider, certificate, or App Link values into local configuration.

Production uses the verified HTTPS App Link
`https://api.questesports.lk/mobile-admin-oauth`, not the custom scheme.

See the [Developer Guide](../docs/developer-guide.md) and [Environment Reference](../docs/environment-reference.md) for local configuration and release guidance.

## Private APK releases

The GitHub workflow runs for tags matching `admin-vMAJOR.MINOR.PATCH`:

```powershell
git tag admin-v1.0.0
git push origin admin-v1.0.0
```

Configure these secrets in the `android-release` GitHub Environment only when the repository plan supports private environment secrets and enforced owner review; otherwise build the signed release locally or from a separate owner-only repository:

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

The workflow generates the native Android project, signs the release APK, adds a SHA-256 checksum, and attaches both files to the private repository release. An environment name or workflow actor check alone does not protect secrets from someone who can edit the workflow. Keep an encrypted offline backup of the keystore: Android updates must always use the same signing certificate.

Private GitHub assets require GitHub authentication, so updates are intentionally installed manually. Never embed a GitHub personal access token in the app.

## Verification

```powershell
npm run typecheck
npm test
npm run doctor
$env:CI='1'; npm run prebuild:android
```

The generated `android/` directory is intentionally ignored. Release builds regenerate it from `app.json` and the local config plugin.


## Dependency and native validation

Keep Expo packages aligned to SDK 57; do not use `npm audit fix --force` or
replace Expo Router with an older incompatible major. `query-string@7.1.3`
expects a CommonJS decoder. A scoped local adapter in `vendor/decode-uri-component`
exports the default function from the pinned `decode-uri-component@0.5.0` npm
alias, preserving the parser contract while using the fixed upstream algorithm.
The adapter contains no copied decoding algorithm. Remove it when an Expo-compatible
Router graph natively consumes the fixed decoder. The
[upstream advisory](https://github.com/SamVerschueren/decode-uri-component/security/advisories/GHSA-vcc3-ghjq-m6fr)
recommends 0.5.0. Dependency tests exercise deep-link encoding, malformed input
with a process timeout, the lockfile and the Android CI job.

```bash
npm ci
npm run typecheck
npm test
npm run audit:ci
npm run doctor
CI=1 npm run prebuild:android -- --no-install
cd android
./gradlew --no-daemon --max-workers=1 :app:assembleDebug -PreactNativeArchitectures=arm64-v8a
```

Use Java 21 and Android SDK. Clean prebuild regenerates `android/`; preserve any
intentional local native changes first. On Windows use `$env:CI='1'` and
`gradlew.bat`. Debug compilation checks native integration without release credentials;
APK signing/distribution remains in the protected release workflow.

Android CI also runs `npx --no-install expo export --platform android` to validate
the production Metro/Hermes bundle; debug native compilation alone does not bundle JavaScript.
