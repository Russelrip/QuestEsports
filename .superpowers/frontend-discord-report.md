# Frontend Discord requirement report

Implemented the tournament admin setting `discordRequired`.

- Added the setting to `TournamentFormValues`, new-tournament defaults, the `Tournament` type, and tournament-to-editor mapping.
- Added an accessible checkbox in Tournament Editor’s Registration & Payment section with explicit helper text covering every roster member, including coaches.
- Added focused tests for the false default, true/false multipart serialization, and edit-form mapping.
- Updated the existing typed tournament test fixture to keep the frontend type contract complete.

Validation:

- Focused test command could not run because frontend dependencies are not installed (`vitest` was not recognized).
- Frontend typecheck could not run because `tsc` was not recognized.
- Changed-file lint could not run because `eslint` was not recognized.
- `git diff --check` passed.
