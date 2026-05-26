# Database And Storage

This project uses PostgreSQL through Prisma for relational data, plus local filesystem storage for uploaded image files.

## Primary Persistence Layers

- PostgreSQL for application data and metadata
- Filesystem for uploaded images
- SMTP provider for transactional email delivery

The backend starts by ensuring its upload directories exist, so a missing `backend/uploads/` folder is created automatically on boot.

## Prisma Models

## Users And Auth

### `User`

Stores:

- identity and profile fields
- normalized email and username
- role
- verification state
- pending email change state
- last login timestamp

### `Session`

Stores hashed session tokens and expiration timestamps for browser sessions.

### `VerificationToken`

Single-use email verification tokens.

### `PasswordResetToken`

Single-use password reset tokens.

### `EmailChangeToken`

Single-use email change confirmation tokens.

## Tournaments And Registration

### `Tournament`

Stores tournament metadata, publication state, dates, registration window, manual display ordering, banner reference, parsed schedule data, and completed-showcase image references.

Fields of note:

- `displayPriority`
- `scheduleFileName`
- `scheduleData`
- `completedPosterImageName`
- `firstPlaceImageName`
- `secondPlaceImageName`
- `thirdPlaceImageName`

### `TeamRegistration`

Stores the submitted team and captain details for a tournament.

Also tracks:

- registration status
- payment status
- verification status
- agreement acceptance flags
- optional team logo filename

### `RegistrationMember`

Stores roster members linked to a team registration.

Roles:

- `CAPTAIN`
- `PLAYER`
- `SUBSTITUTE`
- `COACH`

## Saved Teams And Invites

### `SavedTeam`

Represents a reusable team roster owned by a captain user.

### `SavedTeamMember`

Stores the current saved roster and invite state for each member.

Invite states:

- `pending`
- `accepted`
- `declined`

This layer is synchronized from tournament registration submissions so captains can reuse rosters and teammates can confirm membership by email invite.

## Contact

### `ContactSubmission`

Stores contact form messages and read/unread state for the admin inbox.

## Media

### `ImageAsset`

Stores image metadata and, for older records, can also store binary data directly in PostgreSQL.

Fields of note:

- `storedFilename`
- `contentType`
- `byteSize`
- `data`

### `Poster`

Stores poster presentation metadata linked to an `ImageAsset`.

Fields of note:

- headline/subheadline
- overlay alignment
- accent and text colors
- optional tournament link

## Filesystem Storage

Upload directories are created under `backend/uploads/`:

- `team-logos/`
- `tournament-banners/`
- `poster-images/`
- `tournament-schedules/`

## What Lives Where

### Team logos

- File bytes: filesystem
- DB reference: `TeamRegistration.teamLogoName`, `SavedTeam.logoName`
- Access: admin-only file serving route

### Tournament banners

- File bytes: filesystem
- DB reference: `Tournament.bannerImageName`
- Access: public file serving route

### Tournament schedules

- File bytes: filesystem
- DB reference: `Tournament.scheduleFileName`
- Parsed display data: `Tournament.scheduleData`
- Access: the stored file supports admin workflow, while the public site renders the parsed JSON data returned by the API

### Completed tournament showcase images

- File bytes: filesystem
- DB reference: `Tournament.completedPosterImageName`, `Tournament.firstPlaceImageName`, `Tournament.secondPlaceImageName`, `Tournament.thirdPlaceImageName`
- Access: public file serving route

### Poster images

- Preferred storage: filesystem via `ImageAsset.storedFilename`
- Legacy fallback: `ImageAsset.data`
- Access: public poster-image route, admin binary image route

### Sessions

- Session records: PostgreSQL `sessions` table
- Browser state: `HttpOnly` cookie whose name comes from `SESSION_COOKIE_NAME`
- Access pattern: the browser sends the cookie, and the backend looks up a SHA-256 token hash in the database

## Why Poster Images Have Two Storage Modes

The schema and migration history show an evolution from database-backed image binaries to filesystem-backed poster assets.

Current behavior:

- New uploaded image assets are persisted to the filesystem.
- Metadata is stored in `image_assets`.
- Existing assets that still contain `data` can be migrated out with `npm run media:migrate-image-assets`.
- Runtime image reads prefer the filesystem and fall back to database binary data if necessary.

## Upload Validation

Uploads are validated by signature and extension, not only by MIME type.

Allowed types:

- JPEG
- PNG
- WebP

Maximum file size:

- 5 MB per file

## Data Integrity Rules

Key protections implemented in the schema and services:

- unique normalized email and username for users
- one team name per captain in saved teams
- unique roster position per registration/team
- unique member email per saved team
- unique team name and captain email per tournament registration
- transaction-level protection for tournament registration creation

## Important Relationships

- A `User` has many `Session`, `VerificationToken`, `PasswordResetToken`, and `EmailChangeToken` records.
- A `Tournament` has many `TeamRegistration` and `Poster` records.
- A `TeamRegistration` has many `RegistrationMember` records.
- A `SavedTeam` belongs to a captain `User` and has many `SavedTeamMember` records.
- A `Poster` belongs to an `ImageAsset` and may belong to a `Tournament`.

## Migration History Highlights

From the migration names, the schema evolved through:

- initial schema creation
- admin management
- expanded tournament management
- image assets and posters
- email verification and password reset
- email change flow
- saved teams and invites
- file-backed poster assets
- background jobs
- tournament schedule and completed-showcase asset support

## Backup And Operations Guidance

- Back up PostgreSQL and `backend/uploads/` together.
- Restoring the database without the uploads directory will break tournament banner, logo, and poster file references.
- Restoring the database without the uploads directory will also break tournament schedule file references and completed-showcase images.
- Restoring uploads without the database will orphan files because metadata and filenames live in PostgreSQL.
- Treat `backend/uploads/` as persistent application data in production.

## Production Improvement Opportunities

- Move uploads to object storage such as S3, R2, or GCS for horizontal scaling.
- Move background-job processing to a dedicated worker process or external queue if email/media volume grows beyond the built-in database-backed worker.
- Add scheduled cleanup for expired tokens and stale uploads.
- Add a seed/bootstrap workflow for the first admin user.
