# Database And Storage

## Game and Sponsor Assets

Category artwork and game logos are stored below `UPLOAD_ROOT/game-assets/`; sponsor logos are stored below `UPLOAD_ROOT/sponsor-logos/`. Both routes accept only signature-validated JPEG, PNG, or WebP data, generate safe filenames, normalize images while preserving aspect ratio, and serve immutable public files. Back up and restore these directories with PostgreSQL and the other upload roots.

This project uses PostgreSQL through Prisma for relational data, plus public and private filesystem storage for uploaded files.

For how token records and `BackgroundJob` records are used to deliver transactional mail, see [Email System](./email-system.md).

## Primary Persistence Layers

- PostgreSQL for application data and metadata
- Public filesystem root (`UPLOAD_ROOT`) for images and schedule files
- Private filesystem root (`PRIVATE_UPLOAD_ROOT`) for payment evidence
- Resend or generic SMTP provider for transactional email delivery

The backend ensures required child directories exist at boot. Locally, public files default to `backend/uploads/`; production must point both roots at durable paths outside the Git checkout.

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
- avatar filename

### `Session`

Stores hashed session tokens and expiration timestamps for browser sessions.

### `VerificationToken`

Single-use email verification tokens.

### `PasswordResetToken`

Single-use password reset tokens.

### `EmailChangeToken`

Single-use email change confirmation tokens.

## Tournaments And Registration

### `EventSeries`

Stores published event groupings with a slug, description, hero image, display order, and ordered child tournaments.

### `Tournament`

Stores tournament metadata, publication state, scheduled/TBA/TBD date states, event-series ordering, configurable entry/roster fields, free/PayHere/bank-transfer payment configuration, fee tiers, bank instructions, display ordering, assets, parsed schedule data, and completed-showcase references.

Fields of note:

- `displayPriority`
- `registrationOpenAt`
- `scheduleFileName`
- `scheduleData`
- `completedPosterImageName`
- `firstPlaceImageName`
- `secondPlaceImageName`
- `thirdPlaceImageName`
- `entryType`, `minRosterSize`, `maxRosterSize`, `maxSubstitutes`
- `registrationFields`
- `paymentMethod`, `registrationFeeAmount`, `registrationFeeCurrency`
- `registrationFeeTiers`, `reservationMinutes`, `bankTransferReviewMinutes`
- `startDateStatus`, `endDateStatus`, `registrationDeadlineStatus`

### `TournamentBracket`

Stores the native bracket generated for a tournament.

Fields of note:

- `tournamentId`
- `format`
- `status`
- `seedData`
- `bracketData`
- `generatedAt`
- `publishedAt`
- `lastUpdatedAt`

`seedData` stores the approved registration seed list used for generation. `bracketData` stores the exported `brackets-manager` database shape, including participants, stages, groups, rounds, matches, and match games. Public API responses include this bracket only when `status` is `published`.

### `TeamRegistration`

Stores the submitted team and captain details for a tournament.

Also tracks:

- registration status
- payment status
- verification status
- agreement acceptance flags
- optional team logo filename
- authenticated account and saved-team links
- solo/team entry type and configurable field values
- assigned slot, quoted tier fee/currency, and reservation expiry
- linked payment transactions

### `RegistrationMember`

Stores roster members linked to a team registration.

Also stores:

- the linked player account after acceptance
- invite status and response time
- the single-use invite token hash and expiry

Roles:

- `CAPTAIN`
- `PLAYER`
- `SUBSTITUTE`
- `COACH`

### Registration deletion

Admin deletion removes a `TeamRegistration`. Its `RegistrationMember` records are deleted by cascade. The linked `SavedTeam` is not deleted because it is a reusable profile roster.

## Saved Teams And Invites

### `SavedTeam`

Represents a reusable team roster owned by a captain user. Tournament registrations link back to the saved team they synchronized.

### `SavedTeamMember`

Stores the current saved roster, linked player account, and invite state for each member.

Invite states:

- `pending`
- `accepted`
- `declined`

This layer is synchronized from tournament registration submissions so captains can reuse rosters and teammates can confirm membership through verified site accounts. Accepted members can view the team on their own profiles.

The actual `RegistrationMember` records remain the source of truth for each tournament invitation. Registration verification is `verified` when all members accept, `flagged` when any member declines, and `pending` otherwise.

## Recruitment

### `RecruitmentApplication`

Stores Join Quest applications submitted by verified users.

Fields of note:

- `applicationType`
- `fullName`
- `email`
- `phone`
- `discord`
- `game`
- `applicantIdNumberCiphertext`
- `teamName`
- `currentRosterSize`
- `members`
- `details`
- `notes`
- `womensLeagueInterest`
- `status`

Application types:

- `solo_player`
- `existing_team`
- `incomplete_team`

Statuses:

- `pending`
- `reviewed`
- `accepted`
- `rejected`

NIC values are encrypted at write time and decrypted only for admin review/export responses.

## Contact

### `ContactSubmission`

Stores contact form messages and read/unread state for the admin inbox.

## Commerce And Payments

### `Product`, `ProductVariant`, and `ProductImage`

Store product publication state, currency, made-to-order behavior, ordered image references, SKU/size/color variants, prices, optional inventory, and active state.

### `MerchandiseOrder` and `MerchandiseOrderItem`

Store guest or account-linked delivery details, immutable line-item snapshots, totals, reservation expiry, inventory release state, and fulfilment status. Checkout currently accepts one currency per cart and requires LKR products.

### `PaymentTransaction`

Links a provider order to either a tournament registration or merchandise order. It stores purpose, provider, verified status, amount/currency, provider references, reconciliation metadata, and timestamps without card data.

### `PaymentNotificationAudit`

Stores idempotent PayHere callback audit information after merchant, signature, order, amount, currency, and status validation.

### `BankTransferProof`

Stores private receipt metadata, a unique SHA-256 digest, review state, reviewer, and rejection reason. The file bytes remain in `PRIVATE_UPLOAD_ROOT`; this table never stores card credentials or online-banking secrets.

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

Public upload directories are created under `UPLOAD_ROOT` (locally `backend/uploads/`):

- `team-logos/`
- `tournament-banners/`
- `poster-images/`
- `tournament-schedules/`
- `avatars/`

Private storage is created under `PRIVATE_UPLOAD_ROOT`:

- `bank-transfer-proofs/`

## What Lives Where

### Team logos

- File bytes: filesystem
- DB reference: `TeamRegistration.teamLogoName`, `SavedTeam.logoName`
- Access: upload route is public; tournament detail responses expose logo URLs only for approved registrations

### Tournament banners

- File bytes: filesystem
- DB reference: `Tournament.bannerImageName`
- Access: public file serving route

### Tournament schedules

- File bytes: filesystem
- DB reference: `Tournament.scheduleFileName`
- Parsed display data: `Tournament.scheduleData`
- Access: the stored file supports admin workflow, while the public site renders the parsed JSON data returned by the API

### Avatars

- File bytes: public filesystem `avatars/`
- DB reference: `User.avatarImageName`
- Access: public immutable upload route; upload/replacement/removal requires the authenticated owner

### Bank-transfer proofs

- File bytes: private filesystem with file mode `600`
- DB reference: `BankTransferProof.storedFilename`
- Access: authenticated admin download endpoint only; never a public static route
- Images are signature-checked and normalized; PDF is disabled by default

### Native brackets

- Bracket seed and match data: PostgreSQL `tournament_brackets`
- Generation/update logic: `brackets-manager`
- Access: admin APIs can create, update, and publish brackets; public tournament details receive bracket data only after publication

### Admin Excel exports

- Generated from PostgreSQL records on demand
- Returned directly as `.xlsx` responses
- Not written to `backend/uploads/`
- Registration exports include `Registrations` and `Roster Members` sheets
- Recruitment exports include `Applications` and `Team Members` sheets

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

- 5 MB per team logo
- 10 MB per admin poster, tournament image, or schedule file
- 5 MB per avatar or bank-transfer receipt

## Data Integrity Rules

Key protections implemented in the schema and services:

- unique normalized email and username for users
- one team name per captain in saved teams
- unique roster position per registration/team
- unique member email per saved team
- unique team name and captain email per tournament registration
- transaction-level protection for tournament registration creation
- encrypted NIC storage for recruitment applicants and team members
- one account registration per tournament captain email
- transaction-serialized slot allocation with indexed slot numbers
- unique bank-transfer receipt digest across payment transactions
- one proof per payment transaction
- unique provider order/payment identifiers and notification digests for reconciliation

## Important Relationships

- A `User` has many `Session`, `VerificationToken`, `PasswordResetToken`, and `EmailChangeToken` records.
- A `Tournament` has many `TeamRegistration` and `Poster` records, and at most one `TournamentBracket`.
- An `EventSeries` has ordered child `Tournament` records.
- A `TeamRegistration` has many `RegistrationMember` records and may link to its synchronized `SavedTeam`.
- A `SavedTeam` belongs to a captain `User`, has many `SavedTeamMember` records, and can appear on accepted members' profiles.
- A `RecruitmentApplication` belongs to a submitting `User`.
- `RegistrationMember` and `SavedTeamMember` records may link to the accepting `User`.
- A `Poster` belongs to an `ImageAsset` and may belong to a `Tournament`.
- A `Product` has variants and image references; merchandise orders preserve item snapshots even if products change.
- A `PaymentTransaction` belongs to exactly one registration or merchandise order by purpose and may have PayHere audit rows or one bank-transfer proof.

## Migration History Highlights

From the migration names, the schema evolved through:

- initial schema creation
- admin management
- expanded tournament management
- image assets and posters
- email verification and password reset
- email change flow
- saved teams and invites
- account-linked tournament invite acceptance
- file-backed poster assets
- background jobs
- tournament schedule and completed-showcase asset support
- native tournament bracket persistence and optional registration opening time
- recruitment applications and admin review state
- admin Excel export support for registration and recruitment records
- event series, configurable solo/team registration, profiles, products, orders, and generic payments
- scheduled/TBA/TBD tournament date states
- tiered bank-transfer registration and private proof metadata
- duplicate proof prevention and payment reconciliation/refund state

## Backup And Operations Guidance

- Back up PostgreSQL, `UPLOAD_ROOT`, and `PRIVATE_UPLOAD_ROOT` together.
- Restoring the database without public uploads will break banners, logos, avatars, posters, schedules, product images, and completed-showcase references.
- Restoring the database without private uploads will leave bank-transfer audit metadata without reviewable receipts.
- Restoring uploads without the database will orphan files because metadata and filenames live in PostgreSQL.
- Admin Excel exports are not backup artifacts; they can be regenerated from database state.
- Treat both configured roots as persistent production data; private backups require stricter access and retention controls.

## Production Improvement Opportunities

- Move uploads to object storage such as S3, R2, or GCS for horizontal scaling.
- Move background-job processing to a dedicated worker process or external queue if email/media volume grows beyond the built-in database-backed worker.
- Add scheduled cleanup for expired tokens and stale uploads.
- Add a seed/bootstrap workflow for the first admin user.
