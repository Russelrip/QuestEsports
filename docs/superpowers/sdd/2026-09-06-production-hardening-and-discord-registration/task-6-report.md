# Task 6 mobile dependency and native validation report

## Decision

PASS. Expo remains aligned to SDK 57. `expo-router@57.0.19` retains
`query-string@7.1.3`, while the vulnerable URI decoder is replaced by a scoped
CommonJS adapter backed by the exact patched upstream
`decode-uri-component@0.5.0` package.

A direct override to 0.5.0 is incompatible because that package exports ESM while
query-string 7 calls `require()` as a function. Upgrading query-string changes the
module shape expected by Expo Router. `mobile-admin/vendor/decode-uri-component`
contains only the compatibility export; it delegates the algorithm to the npm
alias `decode-uri-component-upstream@npm:decode-uri-component@0.5.0`.

The lockfile test proves the Expo/query-string versions, fixed upstream version,
normal parse/stringify behavior, bounded hostile malformed input, and the CI
native-build contract. The new dependent CI job performs a locked install, clean
prebuild without another install, Metro/Hermes Android export, and unsigned
arm64 debug compilation under Java 21. It has no signing secrets.

## Verification

- Clean Node 24 `npm ci`: passed; audit reported zero vulnerabilities.
- Vitest: 2 files, 6 tests passed.
- TypeScript: passed.
- Expo Doctor: 20/20 checks passed.
- Clean Android prebuild: passed.
- Android Metro/Hermes export: passed; emitted a 3.9 MB `.hbc` bundle.
- Native Gradle build in the initial long Windows audit path reached C++ build but
  failed with Ninja's dirty-manifest loop after CMake warned that object paths
  exceeded its safe length. A clean short-path retry initially exhausted native
  compiler resources with default concurrency; with the CI-pinned single Gradle
  worker it passed: 249 tasks, `assembleDebug`, 4m 9s.

No force audit fix, Expo Router downgrade, production secret, commit, or push was
used.
