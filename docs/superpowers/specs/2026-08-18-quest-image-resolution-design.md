# Quest Esports Image Resolution Design

## Root cause

Public upload files are stored under `UPLOAD_ROOT` and database image fields
store generated filenames. The API correctly maps those names to relative
`/api/uploads/<directory>/<filename>` URLs, and the live API returns existing
team, banner, and sponsor files with HTTP 200.

The broken Participants image is caused by the frontend passing a valid API
image URL to optimized `next/image`. The production Vercel optimizer request
returns HTTP 402 (`OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED`), so the browser
receives a failed image response and shows the alt text. Components that
already use `unoptimized` load the same API files successfully.

The current frontend also has duplicated URL helpers and direct concatenation.
Those helpers do not consistently normalize trailing/duplicate slashes or
legacy `/uploads`, `uploads/`, filesystem, filename-only, null, and non-string
values.

## Design

Create one frontend `resolveImageUrl(value, options?)` helper for uploaded and
remote image sources. It will preserve valid absolute HTTP(S), data, and blob
URLs; return `null` for empty/invalid values; normalize legacy public upload
forms to the repository's actual `/api/uploads` route; use the configured API
origin without string-concatenation errors; and accept an optional public
directory for filename-only legacy values. It will never expose a filesystem
path or private upload path.

Keep `buildApiUrl` for API request URLs, but route image consumers through the
image helper. Dynamic API-hosted images will use direct loading (`unoptimized`)
so they do not depend on the failing Vercel optimizer. Static local assets and
existing layout/styling remain unchanged.

Missing-image protection will be added only at the shared/high-traffic image
consumers and will switch once to existing visual placeholders or initials,
without retry loops. Upload validation, authentication, public-directory
allowlists, and private storage remain unchanged.

## Verification

- Unit-test null, empty, absolute, `/api/uploads`, `/uploads`, `uploads/`,
  filename-only with a directory, filesystem legacy, duplicate slash, and
  malformed values.
- Test the exact Participants data chain and assert the rendered source uses
  the API origin and direct-loading mode.
- Run frontend unit tests, typecheck, lint, and production build.
- Run backend upload/service tests unchanged and confirm public upload routes
  still return 200 for existing files while missing/private paths remain
  unavailable.
- Recheck live direct API image status and the prior optimizer status; report
  that no Nginx or backend route change is required.
