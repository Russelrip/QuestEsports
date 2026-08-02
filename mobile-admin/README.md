# Quest Admin Android app

Quest Admin is the private Android operations client for Quest E-sports. It uses the production API and supports dashboard monitoring, tournament registrations, payment review and reconciliation, merchandise fulfilment, recruitment, contact messages, teams, users, tournaments, products, event series, game categories, rulebooks, and session revocation.

## Security model

- Admin username/password login always continues through MFA.
- Google and Discord login can issue a mobile session without Quest MFA after the provider identity resolves to an existing admin account.
- Social sign-in returns a two-minute, single-use grant to the APK; the reusable bearer token is issued only through the follow-up API exchange.
- The APK stores that token with Expo SecureStore backed by Android Keystore.
- No password, GitHub token, signing key, or private API credential is bundled into the APK.
- Operational data stays in memory and is not persisted for offline use.
- Browser sessions continue using the existing `HttpOnly` cookie and CSRF protections.

An admin must enable MFA to use password login in the app. A linked Google or Discord account can be used instead without Quest MFA.

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
npx expo-doctor
$env:CI='1'; npm run prebuild:android
```

The generated `android/` directory is intentionally ignored. Release builds regenerate it from `app.json` and the local config plugin.
