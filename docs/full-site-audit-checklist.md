# Quest E-sports Full Site Audit Checklist

Use this checklist for manual QA, user acceptance testing (UAT), pre-release audits, and regression testing. It covers the public website, account flows, tournament registration, teams, recruitment, shop and payments, admin tools, accessibility, security, SEO, performance, and release checks.

## How to use this checklist

- Test destructive actions, payment callbacks, refunds, account lockout, rate limits, and email delivery in staging unless production testing is explicitly approved.
- Replace `[ ]` with `[x]` only when the expected result passes.
- For a failure, leave the item unchecked and append `FAIL: BUG-###`.
- Use `BLOCKED` when required data, credentials, email access, or payment configuration is unavailable.
- Attach screenshots or video for visual defects and browser console/network evidence for technical defects.
- Re-test every fixed defect and the related surrounding flow.

### Test run details

| Field | Value |
| --- | --- |
| Environment / URL | Local automated remediation verification |
| Build / commit | Working tree based on `be4c5a4` with audit fixes |
| Test start and end | 2026-07-17 |
| Tester | Codex automated checks |
| Device(s) | Windows development workstation |
| Browser(s) and versions | Playwright Chromium |
| API environment | Unit/integration mocks; local database integration not enabled |
| Payment mode | Disabled / mocked |
| Overall result | Blocked — automated checks pass; staging UAT and operational sign-off remain |

### Severity guide

| Severity | Meaning |
| --- | --- |
| S1 Critical | Security/data exposure, site unavailable, payment corruption, or no safe workaround |
| S2 High | Core journey is broken, such as login, registration, checkout, or admin publishing |
| S3 Medium | Feature partly broken or confusing, but a reasonable workaround exists |
| S4 Low | Cosmetic, copy, alignment, or minor usability issue |

## Required accounts and test data

- [ ] SETUP-001 A logged-out browser session is available.
- [ ] SETUP-002 An unverified user account is available.
- [ ] SETUP-003 A verified normal user account is available.
- [ ] SETUP-004 A verified user with MFA enabled and unused backup codes is available.
- [ ] SETUP-005 An admin account is available.
- [ ] SETUP-006 Two additional verified accounts are available for team-invite testing.
- [ ] SETUP-007 Test inboxes can receive verification, reset, invite, email-change, and security-alert emails.
- [ ] SETUP-008 At least one published tournament exists for each required state: registration open, full, closed, ongoing, completed, and cancelled.
- [ ] SETUP-009 Team-entry, solo-entry, free, PayHere, and bank-transfer tournament configurations exist where those modes are enabled.
- [ ] SETUP-010 A tournament with a schedule, rulebook, sponsors, approved participants, and published bracket exists.
- [ ] SETUP-011 A tournament with no optional content exists to test empty states.
- [ ] SETUP-012 At least one published event series and game category exists.
- [ ] SETUP-013 Active products include in-stock, out-of-stock, limited-stock, made-to-order, multi-variant, and multi-image examples.
- [ ] SETUP-014 Test image files exist in JPEG, PNG, and WebP formats, including valid files near 5 MB and 10 MB limits.
- [ ] SETUP-015 Invalid upload samples exist: oversized image, renamed non-image, unsupported type, corrupt file, XLSX, CSV, and PDF.
- [ ] SETUP-016 PayHere sandbox credentials and a public HTTPS notification URL are available if payment testing is in scope.
- [ ] SETUP-017 A valid bank-transfer proof and a visually identical duplicate proof are available if bank transfer is in scope.

## 1. Smoke test and application shell

- [ ] SMOKE-001 The home page loads over HTTPS without a certificate warning.
- [ ] SMOKE-002 The API health endpoint returns a healthy response.
- [ ] SMOKE-003 No page shows an unhandled exception, blank screen, raw JSON, or stack trace.
- [ ] SMOKE-004 No unexpected errors appear in the browser console during normal navigation.
- [ ] SMOKE-005 API requests use the correct production/staging API origin and do not call localhost.
- [ ] SMOKE-006 The logo, brand fonts, colors, and primary imagery load correctly.
- [ ] SMOKE-007 Header and footer appear consistently on public pages.
- [ ] SMOKE-008 Header navigation links open the intended pages and show a useful active state where applicable.
- [ ] SMOKE-009 Footer navigation, email, social, Discord, and community links open the intended destinations.
- [ ] SMOKE-010 External links use safe new-tab behavior and do not break the current session.
- [ ] SMOKE-011 Browser back, forward, refresh, and direct URL entry work on public and authenticated routes.
- [ ] SMOKE-012 Loading indicators appear for slow requests and disappear after success or failure.
- [ ] SMOKE-013 Empty states explain what is missing and provide an appropriate next action.
- [ ] SMOKE-014 Error states provide a readable message and retry or recovery path.
- [ ] SMOKE-015 A nonexistent route shows the intended 404 page without exposing internals.
- [ ] SMOKE-016 Repeated clicking does not cause duplicate navigation or duplicate submissions.

## 2. Public pages and navigation

### Home `/`

- [ ] PUB-001 Hero heading, supporting copy, imagery, and calls to action are visible and readable.
- [ ] PUB-002 Hero calls to action open the correct tournament or community destination.
- [ ] PUB-003 Featured tournaments show the correct image, title, status, game, prize pool, deadline, and start information.
- [ ] PUB-004 Featured tournament cards open the correct tournament detail page.
- [ ] PUB-005 Featured content updates correctly when admin publication/featured settings change.
- [ ] PUB-006 About, team/member, media slideshow, and Join Quest sections render without broken content.
- [ ] PUB-007 Slideshow controls, automatic movement, pause/focus behavior, and linked media work without layout shift.

### Static and community pages

- [ ] PUB-008 `/members` shows the intended people, names, roles, portraits, and no placeholder entries.
- [ ] PUB-009 `/gallery` loads published images and opens a correctly sized preview/modal.
- [ ] PUB-010 Gallery modal can be closed with its close button, Escape, and outside click where supported.
- [ ] PUB-011 Gallery focus returns to the item that opened the modal.
- [ ] PUB-012 `/posters` loads published posters, titles, descriptions, and images.
- [ ] PUB-013 `/match-videos` loads the intended videos/links and each playable item works.
- [ ] PUB-014 Video embeds remain usable when third-party content is unavailable or blocked.
- [ ] PUB-015 `/rulebook` lists published rulebooks and opens each correct detail page.
- [ ] PUB-016 `/rulebooks/[slug]` shows the correct title, game, variant, content, and readable formatting.
- [ ] PUB-017 An unpublished or invalid rulebook slug is not publicly exposed.
- [ ] PUB-018 `/contact` shows correct email, TikTok accounts, WhatsApp community, and other social details.
- [ ] PUB-019 `/privacy-policy` displays the complete approved privacy text and contact details.
- [ ] PUB-020 `/terms-of-service` displays the complete approved terms.
- [ ] PUB-021 `/refund-policy` displays approved merchandise, customization, tournament fee, refund, and support terms.
- [ ] PUB-022 All policy links are reachable from the footer and remain readable on mobile.
- [ ] PUB-023 Dates, times, currency, phone numbers, spelling, capitalization, and “Quest E-sports” naming are consistent.
- [ ] PUB-024 No public page contains draft copy, TODO text, test data, lorem ipsum, or broken characters.

## 3. Account creation, login, and recovery

### Signup `/signup`

- [ ] AUTH-001 Signup succeeds with valid unique data and accepted terms.
- [ ] AUTH-002 Required fields are clearly marked and block empty submission.
- [ ] AUTH-003 Invalid email, weak/short password, mismatched passwords, and unaccepted terms show field-level errors.
- [ ] AUTH-004 Duplicate email and duplicate username are rejected with safe, understandable messages.
- [ ] AUTH-005 Leading/trailing spaces and email/username casing are normalized correctly.
- [ ] AUTH-006 Password fields are masked and work with password managers.
- [ ] AUTH-007 One click creates only one account even on a slow connection.
- [ ] AUTH-008 Successful signup does not silently log the user in and explains email verification.
- [ ] AUTH-009 Verification email contains the correct brand, recipient, environment URL, and unbroken link.

### Email verification `/verify-email`

- [ ] AUTH-010 A valid unused token verifies the correct account.
- [ ] AUTH-011 An expired, invalid, missing, or already-used token shows a safe recovery message.
- [ ] AUTH-012 Resend verification works for an unverified account.
- [ ] AUTH-013 Resend does not disclose whether an unrelated email address has an account.
- [ ] AUTH-014 A newly issued token invalidates older unused verification tokens as designed.
- [ ] AUTH-015 A verified user can log in and access verified-only actions.

### Login `/login` and logout

- [ ] AUTH-016 Login works with email and with username.
- [ ] AUTH-017 Incorrect credentials show a generic error without revealing which field was wrong.
- [ ] AUTH-018 “Remember me” persists the session for the intended duration; normal login uses the shorter duration.
- [ ] AUTH-019 A return/deep-link destination is restored after login where supported.
- [ ] AUTH-020 Login and OAuth redirect parameters cannot send users to an external malicious URL.
- [ ] AUTH-021 Google login succeeds, creates/links the correct account, and returns to the site when configured.
- [ ] AUTH-022 Discord login succeeds, creates/links the correct account, and returns to the site when configured.
- [ ] AUTH-023 Unconfigured OAuth providers fail gracefully without exposing configuration details.
- [ ] AUTH-024 Logout removes the server session, clears the cookie, and returns the UI to logged-out state.
- [ ] AUTH-025 Back navigation after logout does not reveal cached protected data.
- [ ] AUTH-026 Repeated failed login triggers the intended rate limit/account lockout in staging.
- [ ] AUTH-027 A locked account becomes usable after the intended unlock period or admin recovery.

### Password reset `/forgot-password` and `/reset-password`

- [ ] AUTH-028 Forgot-password gives the same safe response for known and unknown emails.
- [ ] AUTH-029 Reset email has the correct recipient, expiry guidance, environment URL, and link.
- [ ] AUTH-030 A valid token accepts a valid new password and rejects a mismatched/invalid password.
- [ ] AUTH-031 Expired, invalid, missing, and already-used reset tokens are rejected safely.
- [ ] AUTH-032 Resetting a password invalidates all existing sessions for that account.
- [ ] AUTH-033 The old password fails and the new password succeeds after reset.

## 4. Profile, account security, and sessions `/profile`

- [ ] PROFILE-001 Logged-out access redirects to login without briefly exposing profile data.
- [ ] PROFILE-002 Profile shows the correct name, username, email, phone, Discord tag, role, verification state, and avatar.
- [ ] PROFILE-003 Valid profile edits save, persist after refresh, and appear anywhere the data is reused.
- [ ] PROFILE-004 Invalid profile values and duplicate username are rejected with field-level feedback.
- [ ] PROFILE-005 JPEG, PNG, and WebP avatar uploads succeed within the limit and display with the correct crop/orientation.
- [ ] PROFILE-006 Oversized, corrupt, or unsupported avatar uploads are rejected without replacing the existing avatar.
- [ ] PROFILE-007 Replacing and removing an avatar updates the UI and stored file safely.
- [ ] PROFILE-008 Dashboard totals match current registrations, completed tournaments, teams, and orders.
- [ ] PROFILE-009 Current/past registration cards show correct tournament, registration, and payment status.
- [ ] PROFILE-010 Bank-transfer items needing proof link to the correct payment page.
- [ ] PROFILE-011 Merchandise order links open only the correct public-token order page.
- [ ] PROFILE-012 Empty dashboard sections show useful actions to register, create a team, or visit the shop.
- [ ] PROFILE-013 Password change rejects the wrong current password and invalid new passwords.
- [ ] PROFILE-014 Successful password change sends the intended security alert and handles existing sessions as designed.
- [ ] PROFILE-015 Email-change request requires the current password and rejects a conflicting email.
- [ ] PROFILE-016 The old email remains active until the new email is confirmed.
- [ ] PROFILE-017 `/confirm-email-change` promotes the new email for a valid token and rejects invalid/expired/used tokens.
- [ ] PROFILE-018 Email-change confirmation sends the intended security alert.

### MFA

- [ ] PROFILE-019 MFA setup displays a scannable QR code and manual secret.
- [ ] PROFILE-020 A wrong/expired authenticator code cannot enable MFA.
- [ ] PROFILE-021 A valid code enables MFA and backup codes are shown once with clear storage guidance.
- [ ] PROFILE-022 Subsequent login requires MFA before creating a session.
- [ ] PROFILE-023 Valid TOTP completes login; invalid, reused, or expired challenge data is rejected.
- [ ] PROFILE-024 A backup code completes login once and cannot be reused.
- [ ] PROFILE-025 Backup-code regeneration requires the intended password and second factor, invalidates old codes, and alerts the user.
- [ ] PROFILE-026 MFA disable requires the intended password/second factor and subsequent login no longer requests MFA.

### Session management

- [ ] PROFILE-027 Active sessions list correct device/browser, IP, creation, last-seen, remember status, and expiry data.
- [ ] PROFILE-028 The current session is clearly identified.
- [ ] PROFILE-029 Revoking another session immediately blocks it on its next protected request.
- [ ] PROFILE-030 “Revoke other sessions” preserves only the current session.
- [ ] PROFILE-031 Expired/revoked sessions disappear and cannot access protected APIs.

## 5. Saved teams, rosters, and invitations

- [ ] TEAM-001 `/registration` requires a logged-in, verified account for team creation.
- [ ] TEAM-002 A captain can create a team with valid name, tag, country, organization request, logo, and roster.
- [ ] TEAM-003 Required fields, tag length, email format, duplicate member emails, and roster limits are enforced.
- [ ] TEAM-004 Team logo accepts JPEG/PNG/WebP up to 5 MB and rejects invalid or oversized files.
- [ ] TEAM-005 The captain sees the new team on the profile dashboard and Teams tab.
- [ ] TEAM-006 Team detail shows captain/member roles, names, invite states, linked accounts, tag, country, logo, and organization state correctly.
- [ ] TEAM-007 Only the captain can edit or delete the team.
- [ ] TEAM-008 Captain can update metadata, replace/remove logo, add/remove members, and change roles within limits.
- [ ] TEAM-009 Changing a member email sends a new invitation while unchanged accepted members stay linked.
- [ ] TEAM-010 New invitations use the correct recipient, team/captain details, environment URL, and token.
- [ ] TEAM-011 `/team-invite` previews a valid invite correctly when logged out.
- [ ] TEAM-012 Accepting an invite requires login to the matching verified email account.
- [ ] TEAM-013 A matching user can accept and then appears as a linked team member.
- [ ] TEAM-014 A matching user can decline and the captain sees the declined state.
- [ ] TEAM-015 Wrong-account, expired, invalid, and already-used invite tokens are rejected safely.
- [ ] TEAM-016 A removed member can no longer manage or appear in the team after refresh.
- [ ] TEAM-017 Deleting a team asks for confirmation, removes it from dashboards, and does not delete unrelated registrations.
- [ ] TEAM-018 Requesting “Quest E-sports” organization does not become verified until an admin approves it.

## 6. Tournament discovery and detail pages

### Listing `/tournaments`

- [ ] TOUR-001 Only published tournaments and published event series/categories are visible publicly.
- [ ] TOUR-002 Game category artwork/logo, filter labels, order, and tournament counts are correct.
- [ ] TOUR-003 “All” and individual game filters update the cards and URL behavior correctly.
- [ ] TOUR-004 Active, closed, full, ongoing, completed, and cancelled cards use correct status text and visual treatment.
- [ ] TOUR-005 Cards show correct image, title, game, prize pool, registration deadline, start date, and TBA/TBD states.
- [ ] TOUR-006 Card ordering respects featured/display priority and expected date ordering.
- [ ] TOUR-007 Whole-card navigation works by mouse and keyboard without nested-link conflicts.
- [ ] TOUR-008 No-results and API-failure states are helpful and do not leave stale cards visible.

### Event series `/tournaments/series/[slug]`

- [ ] TOUR-009 A published series shows the correct hero, title, description, and ordered child tournaments.
- [ ] TOUR-010 Unpublished series and invalid slugs are not publicly exposed.
- [ ] TOUR-011 Series child cards open the correct tournament and reflect publication changes.

### Tournament detail `/tournaments/[slug]`

- [ ] TOUR-012 Hero/banner, title, game, organizer, country, location, descriptions, format, prize pool, capacity, and status are correct.
- [ ] TOUR-013 Scheduled, TBA, and TBD start/end/deadline values render correctly in the intended timezone.
- [ ] TOUR-014 Registration call to action matches open, closed, full, completed, cancelled, login, and already-registered states.
- [ ] TOUR-015 Refreshing registration state clears stale browser markers when the backend reports no registration.
- [ ] TOUR-016 Rulebook, contact, bracket, and external links point to valid trusted destinations.
- [ ] TOUR-017 Sponsors show correct logo, partnership label, order, and safe website link.
- [ ] TOUR-018 Schedule headers and rows parsed from XLSX/CSV display accurately and remain usable on mobile.
- [ ] TOUR-019 Approved public participants show correct name/team, logo/avatar, short code, and member count.
- [ ] TOUR-020 Pending/rejected registrations and private member/contact data are not exposed publicly.
- [ ] TOUR-021 Empty participant, sponsor, schedule, showcase, and bracket sections are hidden or show the intended empty state.
- [ ] TOUR-022 Completed tournament poster and 1st/2nd/3rd-place images are labeled and displayed correctly.
- [ ] TOUR-023 Published native bracket has correct participants, seeds, rounds, results, progress summary, and readable layout.
- [ ] TOUR-024 Unpublished native bracket is not public.
- [ ] TOUR-025 Challonge embed/link works where configured and native fallback remains available when blocked.
- [ ] TOUR-026 Invalid/unpublished tournament slugs return the intended not-found behavior.

## 7. Tournament registration and payments

### Eligibility and forms `/tournaments/[slug]/register`

- [ ] REG-001 Logged-out users are directed to login and returned to the tournament flow.
- [ ] REG-002 Unverified users cannot register and receive a clear verification action.
- [ ] REG-003 Registration is blocked when not yet open, past deadline, closed, full, completed, or cancelled.
- [ ] REG-004 Team and solo tournament forms display only the fields appropriate to their entry type.
- [ ] REG-005 Admin-configured text, number, and select fields render at entry/member scope with correct required rules/options.
- [ ] REG-006 Captain/contact information is populated from the signed-in account where intended.
- [ ] REG-007 A captain can reuse one of their saved teams and the correct roster populates.
- [ ] REG-008 A non-captain cannot use another saved team to register.
- [ ] REG-009 Team name/tag/country, captain details, member emails, roles, custom data, and logo are validated server-side.
- [ ] REG-010 Minimum/maximum roster size, substitute limit, maximum capacity, and slot rules are enforced.
- [ ] REG-011 Duplicate emails within a roster and duplicate tournament registration are rejected.
- [ ] REG-012 Rulebook and accuracy declarations must be accepted.
- [ ] REG-013 A valid free registration submits once and appears in profile/admin with correct statuses.
- [ ] REG-014 Simultaneous final-slot attempts allow only available capacity and do not oversubscribe.
- [ ] REG-015 Server errors preserve reasonable form data and allow a safe retry without duplicate registration.
- [ ] REG-016 Admin deletion allows the same eligible captain/account to register again.

### PayHere `/tournaments/[slug]/payment`

- [ ] REG-017 PayHere registration is clearly unavailable when provider credentials/capabilities are disabled, and no draft is created.
- [ ] REG-018 A configured paid registration shows the server-calculated amount and currency before redirect.
- [ ] REG-019 Signed PayHere fields use the correct merchant, order, amount, currency, return, cancel, and notification values.
- [ ] REG-020 Successful sandbox payment becomes paid/confirmed only after a valid server callback.
- [ ] REG-021 Browser return alone never marks a payment paid.
- [ ] REG-022 Failed and cancelled payments show accurate status and release capacity when intended.
- [ ] REG-023 Duplicate valid notifications are idempotent and do not double-register or double-charge state.
- [ ] REG-024 Invalid signature, merchant, amount, currency, order, or status callbacks are rejected and flagged appropriately.
- [ ] REG-025 Late successful callback moves the transaction to the intended review/reconciliation state.
- [ ] REG-026 Chargeback/refund state is reflected consistently in payment, registration, admin, and profile views.

### Bank transfer

- [ ] REG-027 The reserved slot number, tiered fee, currency, bank details, deadline, and review guidance are correct.
- [ ] REG-028 Fee-tier boundary slots receive the correct server-calculated amount.
- [ ] REG-029 JPEG/PNG/WebP proof upload succeeds within limits; PDF remains blocked unless explicitly enabled and secured.
- [ ] REG-030 Oversized, corrupt, unsupported, and duplicate normalized proofs are rejected safely.
- [ ] REG-031 Private proof URLs/files cannot be accessed through public upload routes or by another user.
- [ ] REG-032 Proof submission changes status correctly and appears to admin with the right transaction.
- [ ] REG-033 Reservation/review expiry releases the slot and updates all user/admin views.

## 8. Join Quest recruitment `/join`

- [ ] JOIN-001 Logged-out/unverified users are prompted to authenticate and verify before submitting.
- [ ] JOIN-002 Deep links correctly select solo player, existing team, and incomplete team application types.
- [ ] JOIN-003 Each application type displays only its relevant fields and instructions.
- [ ] JOIN-004 Required personal, game, team, roster, rank, experience, LAN, and declaration fields validate correctly.
- [ ] JOIN-005 Other-game input, prior-organization conditional input, and women’s-league interest work correctly.
- [ ] JOIN-006 Existing/incomplete team member add/remove controls enforce sensible roster and required-field rules.
- [ ] JOIN-007 Sensitive identity values are masked in the UI where appropriate and never exposed in URLs/logs.
- [ ] JOIN-008 A valid application submits once and confirms success.
- [ ] JOIN-009 Repeated submission/rate-limit behavior provides a clear safe message.
- [ ] JOIN-010 Submitted data appears accurately in admin without field loss or incorrect application type.

## 9. Shop, cart, checkout, and order status

### Shop `/shop` and product `/shop/[slug]`

- [ ] SHOP-001 Only active products and active variants are public; draft/archived items are hidden.
- [ ] SHOP-002 Product order, image order, names, descriptions, currency, and pricing match admin data.
- [ ] SHOP-003 Product gallery loads all images with correct alt text and usable controls.
- [ ] SHOP-004 Size/color/variant selection updates price, availability, SKU context, and add-to-cart state.
- [ ] SHOP-005 Out-of-stock or inactive variants cannot be added to cart.
- [ ] SHOP-006 Made-to-order messaging and policy links are clear before adding to cart.
- [ ] SHOP-007 Invalid/unpublished product slugs return the intended not-found behavior.

### Cart `/shop/cart`

- [ ] SHOP-008 Cart persists across refresh and normal navigation as intended.
- [ ] SHOP-009 Adding the same variant updates quantity rather than creating incorrect duplicate lines.
- [ ] SHOP-010 Quantity controls enforce 1–20 and current stock; invalid manual values are handled safely.
- [ ] SHOP-011 Removing a line and emptying the cart updates totals and empty state correctly.
- [ ] SHOP-012 Server quote determines unit prices, subtotal, delivery fee, currency, and total; client values cannot override it.
- [ ] SHOP-013 Price/stock changes since add-to-cart are clearly reconciled before checkout.
- [ ] SHOP-014 Customer name, email, phone, address, and city validation works and preserves data after quote refresh.
- [ ] SHOP-015 Checkout is clearly disabled when PayHere/shop capability is unavailable and creates no order/reservation.
- [ ] SHOP-016 Valid checkout creates only one order and uses the correct signed payment amount.
- [ ] SHOP-017 Concurrent orders cannot reduce tracked inventory below zero.
- [ ] SHOP-018 Abandoned/expired pending orders release reserved stock after the configured period.

### Order `/shop/order/[token]`

- [ ] SHOP-019 Valid token shows correct items, quantities, unit/line totals, delivery fee, total, payment, order status, and expiry.
- [ ] SHOP-020 Invalid token does not disclose whether nearby orders exist or expose customer/order data.
- [ ] SHOP-021 Pending, paid, processing, fulfilled, cancelled, expired, charged-back, and refunded states display correctly where applicable.
- [ ] SHOP-022 Successful payment is reflected only after the authoritative callback and remains correct after refresh.
- [ ] SHOP-023 Cart clears only after the intended successful order/checkout point.

## 10. Contact form and media behavior

- [ ] CONTACT-001 Contact form required name, email, subject, and message validation is clear.
- [ ] CONTACT-002 Valid submission succeeds once and shows confirmation.
- [ ] CONTACT-003 HTML/script-like text is stored/rendered as text and cannot execute in public or admin views.
- [ ] CONTACT-004 Spam/rate-limit response is understandable and does not expose internals.
- [ ] CONTACT-005 Submitted message appears accurately and unread in admin.
- [ ] MEDIA-001 Missing images use an intentional fallback without broken-image icons.
- [ ] MEDIA-002 Image aspect ratio, crop, compression, orientation, and sharpness are acceptable on mobile and desktop.
- [ ] MEDIA-003 Public media endpoints expose only published/intended assets.
- [ ] MEDIA-004 Deleting or replacing media does not break unrelated records that reuse other assets.

## 11. Admin access and overview `/admin`

- [ ] ADMIN-001 Logged-out users cannot load admin pages or admin APIs.
- [ ] ADMIN-002 Normal users receive a safe forbidden/redirect result for every admin page and API.
- [ ] ADMIN-003 Admin navigation lists Overview, Tournaments, Event Series, Games, Registrations, Rulebooks, Users, Teams, Recruitment, Messages, Products, Orders, and Payments.
- [ ] ADMIN-004 Admin navigation is keyboard and mobile usable and indicates the current section.
- [ ] ADMIN-005 Dashboard counts match source lists for tournaments, open tournaments, registrations, pending recruitment, and unread messages.
- [ ] ADMIN-006 Dashboard handles zero-data, loading, and API-error states.
- [ ] ADMIN-007 Admin mutations show success/failure feedback and disable duplicate submission.
- [ ] ADMIN-008 Confirmation is required for destructive actions and cancel leaves data unchanged.
- [ ] ADMIN-009 Pagination, searching, filtering, sorting, and result totals remain consistent after mutations.

## 12. Admin users, teams, messages, and recruitment

### Users `/admin/users`

- [ ] ADMUSR-001 User search, pagination, and detail loading return the correct accounts.
- [ ] ADMUSR-002 Admin can create a valid user and duplicate email/username is rejected.
- [ ] ADMUSR-003 Admin can update allowed identity/contact/role fields and changes persist.
- [ ] ADMUSR-004 Role changes take effect on the user’s next authorization check.
- [ ] ADMUSR-005 Dangerous self-demotion/self-deletion or last-admin cases are prevented or clearly controlled.
- [ ] ADMUSR-006 User deletion requires confirmation and handles related data according to policy without orphan errors.

### Saved teams `/admin/teams`

- [ ] ADMTEAM-001 Search/list shows the correct captain, roster, organization request, logo, and metadata.
- [ ] ADMTEAM-002 Admin can approve/remove the organization label and public/profile displays update.
- [ ] ADMTEAM-003 Admin team deletion requires confirmation and does not alter unrelated teams/registrations.

### Messages `/admin/contact-messages`

- [ ] ADMMSG-001 Unread/read filtering, pagination, and message detail are correct.
- [ ] ADMMSG-002 Marking read/unread updates the row and dashboard unread count.
- [ ] ADMMSG-003 Message content is safely escaped and long content does not break layout.
- [ ] ADMMSG-004 Deletion requires confirmation and removes only the selected message.

### Recruitment `/admin/recruitment`

- [ ] ADMREC-001 Search, application-type/status filters, pagination, and totals are correct.
- [ ] ADMREC-002 Detail view accurately shows all relevant solo/team fields, members, declarations, and women’s-league interest.
- [ ] ADMREC-003 Sensitive identity data is visible only to authorized admins and is not leaked to exports/logs beyond approved policy.
- [ ] ADMREC-004 Status moves among pending, reviewed, accepted, and rejected and persists after refresh.
- [ ] ADMREC-005 Deletion requires confirmation and removes only the chosen application.
- [ ] ADMREC-006 Filtered Excel export matches current filters, downloads as `.xlsx`, and contains correct columns/rows.
- [ ] ADMREC-007 Spreadsheet values that begin with formula characters cannot execute malicious formulas when opened.

## 13. Admin games, event series, rulebooks, and posters

### Games `/admin/games`

- [ ] ADMCONTENT-001 Admin can create a game category with unique slug/name, order, publication state, artwork, and logo.
- [ ] ADMCONTENT-002 Duplicate/invalid slug, invalid order, unsupported file, and oversized file are rejected.
- [ ] ADMCONTENT-003 Edit/replace/remove artwork and logo works and updates public filters.
- [ ] ADMCONTENT-004 Published/unpublished state and display order take effect publicly.
- [ ] ADMCONTENT-005 Deleting a category handles linked tournaments safely and requires confirmation.

### Event series `/admin/event-series`

- [ ] ADMCONTENT-006 Create/edit series validates unique slug, title, description, order, publication, and hero image.
- [ ] ADMCONTENT-007 Public series content updates correctly after edit/publish/unpublish.
- [ ] ADMCONTENT-008 Deleting a series detaches child tournaments without deleting them.

### Rulebooks `/admin/rulebooks`

- [ ] ADMCONTENT-009 Create/edit validates unique slug, title, game, variant, publication, and content.
- [ ] ADMCONTENT-010 Published rulebook becomes public and selectable in tournament editor; unpublished content does not.
- [ ] ADMCONTENT-011 Rulebook formatting renders safely and script/HTML injection cannot execute.
- [ ] ADMCONTENT-012 Deletion handles linked tournaments safely and requires confirmation.

### Posters/media administration

- [ ] ADMCONTENT-013 Admin image upload accepts supported formats/limits and shows accurate metadata/preview.
- [ ] ADMCONTENT-014 Poster entry creation associates the correct image, title, description, date, and publication/display data.
- [ ] ADMCONTENT-015 Poster/image deletion requires confirmation and does not delete the wrong binary/record.
- [ ] ADMCONTENT-016 Legacy import/migration is run only with backup/approval and reports imported/skipped items accurately.

## 14. Admin tournaments, sponsors, and brackets

### Tournament editor `/admin/tournaments`, `/new`, `/[id]/edit`

- [ ] ADMTOUR-001 List search/filter/status/publication data and links are correct.
- [ ] ADMTOUR-002 Create validates unique title/slug and required game, organizer, location, descriptions, format, capacity, dates, and status.
- [ ] ADMTOUR-003 Game category, event series/order, display priority, featured, and publication settings persist.
- [ ] ADMTOUR-004 Start/end/deadline scheduled/TBA/TBD combinations validate and display correctly.
- [ ] ADMTOUR-005 Registration open/deadline ordering and timezone conversion remain correct after save/edit.
- [ ] ADMTOUR-006 Open-entry/slot-based and team/solo settings persist and drive the public form correctly.
- [ ] ADMTOUR-007 Team size, min/max roster, substitutes, max entries, and capacity combinations reject impossible values.
- [ ] ADMTOUR-008 Registration field JSON accepts only valid unique keys, labels, text/number/select type, entry/member scope, required flag, and select options.
- [ ] ADMTOUR-009 Invalid JSON or unsupported registration-field values produce actionable errors without losing the form.
- [ ] ADMTOUR-010 Free, PayHere, and bank-transfer payment configurations validate all mode-specific fields.
- [ ] ADMTOUR-011 Bank fee tiers reject gaps, overlaps, invalid ranges/amounts, or ranges beyond capacity.
- [ ] ADMTOUR-012 Prize pool, rules, rulebook, contact link, bracket/Challonge link, and publication settings persist accurately.
- [ ] ADMTOUR-013 Banner, hero, completed poster, and placement images accept supported files up to 10 MB each.
- [ ] ADMTOUR-014 Schedule accepts valid XLSX/CSV, rejects bad/unsupported/oversized files, and parses expected headers/rows.
- [ ] ADMTOUR-015 Total multipart request over 45 MB is rejected cleanly without partial record/file updates.
- [ ] ADMTOUR-016 Replacing/removing each asset changes only that asset and cleans up safely.
- [ ] ADMTOUR-017 Editing does not silently reset fields, dates, JSON configuration, or unchanged assets.
- [ ] ADMTOUR-018 Draft/unpublished tournaments remain private; publishing makes only intended data public.
- [ ] ADMTOUR-019 Delete requires confirmation and either safely handles or clearly blocks related registrations/payments/brackets.

### Sponsors

- [ ] ADMTOUR-020 Add/edit sponsor validates name, partnership label, website URL, display order, and logo.
- [ ] ADMTOUR-021 Sponsor order and publication on the tournament detail page match admin data.
- [ ] ADMTOUR-022 Replacing/removing a sponsor logo and deleting a sponsor affect only the chosen sponsor.

### Native brackets

- [ ] ADMTOUR-023 Draft bracket generates from the correct approved eligible entries and seed order.
- [ ] ADMTOUR-024 Generation is blocked or warned appropriately with insufficient/invalid participants.
- [ ] ADMTOUR-025 Regeneration after registration approval/rejection/deletion reflects the new seeds.
- [ ] ADMTOUR-026 Admin can record valid scores/results and winners advance correctly through upper/lower/final rounds.
- [ ] ADMTOUR-027 Invalid score/result transitions, wrong match IDs, and edits that contradict completed downstream matches are rejected safely.
- [ ] ADMTOUR-028 Publishing exposes the current bracket; unpublishing hides it; status timestamps update correctly.
- [ ] ADMTOUR-029 Public bracket remains internally consistent after each admin result update.

## 15. Admin registrations and exports `/admin/registrations`

- [ ] ADMREG-001 Tournament, approval, payment, verification, and search filters return correct rows and totals.
- [ ] ADMREG-002 Registration detail shows correct entry type, team/solo data, captain, members, custom fields, invite states, payment, reservation, logo, and timestamps.
- [ ] ADMREG-003 Status changes among pending/approved/rejected persist and public participants update accordingly.
- [ ] ADMREG-004 Payment and verification statuses cannot be changed through an unrelated unsafe action.
- [ ] ADMREG-005 Deletion requires confirmation, removes only the selected registration, and restores capacity.
- [ ] ADMREG-006 Deleting/rejecting a registration warns that an existing bracket may require regeneration.
- [ ] ADMREG-007 Filtered Excel export matches the current filters and downloads with the intended dated filename.
- [ ] ADMREG-008 Registration and Roster Members sheets contain correct rows, columns, linked-account/invite data, and no unrelated records.
- [ ] ADMREG-009 Exported user values are protected from spreadsheet formula injection.

## 16. Admin products, orders, and payments

### Products `/admin/products`

- [ ] ADMCOM-001 Create/edit validates unique slug, name, description, LKR currency rules, status, order, made-to-order, and images.
- [ ] ADMCOM-002 Product requires 1–100 variants with unique SKU, valid name/price, optional size/color/stock, and active state.
- [ ] ADMCOM-003 Duplicate SKU, negative price/stock, invalid decimal, and impossible variant data are rejected.
- [ ] ADMCOM-004 Product images upload, order, alt text, replace, and remove correctly.
- [ ] ADMCOM-005 Activating/deactivating product/variant updates the public shop immediately as intended.
- [ ] ADMCOM-006 Delete archives/deactivates instead of erasing historical order-item snapshots.

### Orders `/admin/orders`

- [ ] ADMCOM-007 Search/filter/pagination and displayed customer, totals, inventory, payment, and status data are correct.
- [ ] ADMCOM-008 Pending-payment order can be cancelled and reserved stock is released once.
- [ ] ADMCOM-009 Only provider-confirmed paid orders can move to processing or fulfilled.
- [ ] ADMCOM-010 Invalid status transitions and direct paid-order cancellation are blocked with clear guidance.
- [ ] ADMCOM-011 Historical item name/SKU/price snapshots remain unchanged after product edits.

### Payments `/admin/payments`

- [ ] ADMCOM-012 Status/purpose filters and pagination correctly cover tournament and merchandise payments.
- [ ] ADMCOM-013 Payment detail matches provider/order, amount, currency, status, purpose, timestamps, and linked record.
- [ ] ADMCOM-014 Admin can securely download an authorized bank proof; response is never publicly cacheable.
- [ ] ADMCOM-015 Bank approval marks payment paid and confirms registration exactly once.
- [ ] ADMCOM-016 Bank rejection records the reason and releases the reserved slot exactly once.
- [ ] ADMCOM-017 Re-review, wrong transaction type, expired reservation, and missing reason cases are safely handled.
- [ ] ADMCOM-018 PayHere `review_required` acceptance succeeds only when capacity/inventory is still available.
- [ ] ADMCOM-019 “Mark refunded” requires an operator note and external refund reference and does not initiate an unapproved external refund.
- [ ] ADMCOM-020 Every reconciliation records admin identity, time, decision, note/reference, and produces consistent linked statuses.

## 17. Email audit

- [ ] EMAIL-001 Verification, reset, team invite, email-change, and security-alert messages use the correct recipient and trigger.
- [ ] EMAIL-002 Subjects, sender name/address, reply behavior, logo/branding, spelling, and support details are approved.
- [ ] EMAIL-003 Links use the correct HTTPS frontend/API domains and do not contain localhost, staging references in production, or malformed encoding.
- [ ] EMAIL-004 Tokenized links expire and are single-use according to the documented flow.
- [ ] EMAIL-005 Email HTML and plain-text versions are readable on desktop and mobile clients.
- [ ] EMAIL-006 No password, raw stored token/hash, MFA secret, backup-code set, bank proof, or unrelated personal data appears in emails/logs.
- [ ] EMAIL-007 Queue retry does not send unintended duplicate messages or duplicate state changes.
- [ ] EMAIL-008 Delivery failure is recorded/observable and the user receives an accurate non-misleading response.
- [ ] EMAIL-009 SPF, DKIM, and DMARC pass for the production sender domain.

## 18. Validation, errors, and data integrity

- [ ] DATA-001 Client validation is also enforced by the API when requests are sent directly.
- [ ] DATA-002 Required values containing only spaces are rejected.
- [ ] DATA-003 Very long text, Unicode names, apostrophes, hyphens, emoji, and Sri Lankan/international phone formats do not corrupt layouts or data.
- [ ] DATA-004 Stored content containing `<script>`, HTML, SQL-like text, spreadsheet formulas, and URL-encoded payloads never executes.
- [ ] DATA-005 Invalid IDs/slugs/tokens produce consistent 400/401/403/404 responses without stack traces.
- [ ] DATA-006 Network timeout/offline/500 responses do not show false success or create duplicate records on retry.
- [ ] DATA-007 Database uniqueness/conflict errors are translated into understandable UI feedback.
- [ ] DATA-008 Multi-step operations do not leave partial records, orphan files, lost inventory, or incorrect capacity after failure.
- [ ] DATA-009 Dates and money retain exact values after create, edit, API round trip, and display formatting.
- [ ] DATA-010 Admin/public/profile views converge on the same status after refresh and background processing.

## 19. Responsive design and browser compatibility

Test at minimum: 320×568, 375×667, 390×844, 768×1024, 1366×768, 1440×900, and a wide desktop.

- [ ] RESP-001 All pages fit the viewport without unintended horizontal scrolling.
- [ ] RESP-002 Mobile navigation opens/closes without page shift, traps focus appropriately, and restores scroll/focus.
- [ ] RESP-003 Text remains readable without overlap, clipping, or tiny tap targets.
- [ ] RESP-004 Forms, tabs, tables, filters, cards, modals, schedules, and brackets remain usable at every breakpoint.
- [ ] RESP-005 On-screen keyboard does not hide focused inputs or primary actions on mobile.
- [ ] RESP-006 Portrait/landscape rotation preserves content and does not reset unsaved form data.
- [ ] RESP-007 Images and videos keep intended aspect ratio and do not cause major layout shifts.
- [ ] RESP-008 200% browser zoom remains usable without loss of content/functionality.
- [ ] RESP-009 Current Chrome, Edge, Firefox, and Safari complete all critical public journeys.
- [ ] RESP-010 iOS Safari and Android Chrome complete signup/login, menu, forms, uploads, cart, and payment handoff.
- [ ] RESP-011 Slow 3G/4G behavior provides loading feedback and prevents duplicate actions.

## 20. Accessibility audit

- [ ] A11Y-001 Every page has one meaningful H1 and a logical heading order.
- [ ] A11Y-002 Page language, titles, landmarks, navigation labels, and skip-navigation behavior are correct.
- [ ] A11Y-003 All interactive controls are reachable and operable using keyboard only.
- [ ] A11Y-004 Focus is always visible and follows a logical order.
- [ ] A11Y-005 Modals/menus manage focus, close with Escape, and do not leave background controls active.
- [ ] A11Y-006 Inputs have programmatic labels; required state, hints, and errors are associated and announced.
- [ ] A11Y-007 Error summary/focus makes failed submissions discoverable without relying only on color.
- [ ] A11Y-008 Buttons and links have meaningful accessible names and are not empty or duplicated ambiguously.
- [ ] A11Y-009 Informative images have useful alt text; decorative images use empty alt text.
- [ ] A11Y-010 Text, controls, focus rings, and status badges meet WCAG AA contrast.
- [ ] A11Y-011 Status, bracket result, validation, and availability meaning is not communicated by color alone.
- [ ] A11Y-012 Touch targets are approximately 44×44 CSS pixels and spaced to avoid accidental activation.
- [ ] A11Y-013 Tables have headers/captions or an equivalent accessible structure.
- [ ] A11Y-014 Toasts/loading/status changes are announced appropriately without stealing focus.
- [ ] A11Y-015 Content works with reduced-motion preference and has no flashing/unsafe animation.
- [ ] A11Y-016 Automated axe/Lighthouse accessibility scan has no unreviewed serious or critical issue.
- [ ] A11Y-017 Critical journeys are smoke-tested with a screen reader (NVDA/VoiceOver).

## 21. Performance and reliability

- [ ] PERF-001 Home, tournament list/detail, shop, and login meet agreed mobile Core Web Vitals targets.
- [ ] PERF-002 Hero/LCP images are correctly sized, compressed, and prioritized without downloading huge originals.
- [ ] PERF-003 Below-the-fold images/media are lazy-loaded where appropriate.
- [ ] PERF-004 Fonts use correct formats/loading behavior and do not produce unacceptable layout shift.
- [ ] PERF-005 JavaScript, CSS, image, and API payload sizes have no obvious avoidable regression.
- [ ] PERF-006 Public API list responses are paginated/bounded or otherwise remain acceptable with production-size data.
- [ ] PERF-007 Admin tables remain responsive with large user, registration, recruitment, order, and payment datasets.
- [ ] PERF-008 Repeated navigation does not create runaway requests, event handlers, memory use, or duplicate polling.
- [ ] PERF-009 Images/uploads return appropriate cache and content-type headers; private data is not publicly cached.
- [ ] PERF-010 Health monitoring, structured request logs, error reporting, and job-worker visibility are operating.
- [ ] PERF-011 Email/payment/background jobs retry safely and failed jobs can be diagnosed without direct database guessing.
- [ ] PERF-012 A backend restart does not lose committed sessions, registrations, payments, inventory, or queued durable work.

## 22. SEO, sharing, sitemap, and PWA

- [ ] SEO-001 Public pages have unique accurate title, meta description, and canonical URL.
- [ ] SEO-002 Admin, profile, auth, registration, payment, cart, order-token, and other private pages are `noindex` as intended.
- [ ] SEO-003 Open Graph/Twitter titles, descriptions, image URLs, dimensions, and absolute production URLs are correct.
- [ ] SEO-004 Shared home/tournament/product links produce the intended preview on major social platforms.
- [ ] SEO-005 `/robots.txt` uses the correct production rules and does not block intended public content.
- [ ] SEO-006 `/sitemap.xml` contains only canonical public/indexable routes with the correct domain.
- [ ] SEO-007 Organization, website, and sports-event structured data validates and matches visible content.
- [ ] SEO-008 No metadata, sitemap, JSON-LD, manifest, API call, or email link contains localhost or the wrong environment domain.
- [ ] SEO-009 Invalid/unpublished/draft/private URLs do not appear in search metadata or sitemap.
- [ ] SEO-010 Manifest name, icons, theme/background color, start URL, and installed-app launch behavior are correct.
- [ ] SEO-011 Favicon and Apple touch icon display correctly.
- [ ] SEO-012 Search engine crawl smoke test finds no accidental soft 404, redirect loop, or duplicate canonical page.
- [ ] SEO-013 `/sitemap.xml` returns `200`, `application/xml`, and valid UTF-8 XML to both a normal client and a Googlebot user agent.
- [ ] SEO-014 Sitemap entries cover published tournaments, published event series, published rulebooks, and active products while excluding redirects and functional/private routes.
- [ ] SEO-015 Dynamic sitemap source failure is isolated; one unavailable API group does not make the sitemap endpoint fail or remove unrelated groups.
- [ ] SEO-016 Search Console shows the submitted sitemap as `Success`, with a populated last-read time and a plausible discovered-page count.
- [ ] SEO-017 Live URL inspection reports successful fetches for the sitemap and representative canonical pages.
- [ ] SEO-018 Search Console Page indexing, HTTPS, Manual actions, Security issues, and Core Web Vitals reports have been reviewed for release blockers.

Use [Google Search Console and Sitemap Operations](./search-console-and-sitemap.md) for the commands, expected results, and `Couldn't fetch` procedure.

## 23. Security and privacy

Perform intrusive tests only with authorization and in staging.

- [ ] SEC-001 Production uses HTTPS and secure session cookies with HttpOnly, SameSite, Path, expiry, and Secure attributes.
- [ ] SEC-002 Session tokens never appear in URLs, frontend storage, response bodies, analytics, or logs.
- [ ] SEC-003 State-changing requests reject disallowed Origin/Referer values and CORS allows only approved origins.
- [ ] SEC-004 Every protected object/API enforces server-side authentication and role/ownership checks, not just hidden UI.
- [ ] SEC-005 Changing user, team, registration, order, payment, image, or tournament IDs cannot access another user’s/private data.
- [ ] SEC-006 Admin APIs return 401/403 to unauthenticated/non-admin direct requests.
- [ ] SEC-007 Login, signup, reset, resend, contact, invite, registration, recruitment, proof, order, and notification rate limits work as intended.
- [ ] SEC-008 Error responses and headers do not expose stack traces, filesystem paths, SQL, Prisma internals, secrets, or software debug data.
- [ ] SEC-009 Upload validation checks decoded content/type/size; filenames cannot traverse directories or overwrite another asset.
- [ ] SEC-010 Public uploads cannot serve active HTML/script content; private proofs are isolated outside public storage.
- [ ] SEC-011 Content Security Policy permits only required trusted origins, including the configured PayHere endpoint, and blocks unexpected script/frame sources.
- [ ] SEC-012 Security headers include appropriate HSTS, content-type sniffing, frame/embedding, referrer, and permissions protections.
- [ ] SEC-013 OAuth state/redirect validation prevents CSRF, replay, provider mix-up, and open redirects.
- [ ] SEC-014 Password/reset/verification/invite/email-change tokens are random, hashed at rest where designed, expire, and are single-use.
- [ ] SEC-015 Account enumeration is not possible through login, forgot-password, resend, invite, or timing/message differences beyond accepted risk.
- [ ] SEC-016 MFA secrets and backup codes are encrypted/hashed as designed and never returned after their one-time display.
- [ ] SEC-017 PayHere merchant secret never reaches frontend code, page source, logs, or public repository data.
- [ ] SEC-018 Payment callback validates signature, merchant, order, exact amount, currency, and status and is idempotent.
- [ ] SEC-019 Bank proofs require admin authorization, have approved retention, and are absent from backups/logs/public caches beyond policy.
- [ ] SEC-020 Sensitive recruitment identity data is encrypted at rest and limited to approved admin/export/log access.
- [ ] SEC-021 Analytics/monitoring do not capture passwords, tokens, MFA data, payment proof, full identity data, or unnecessary personal information.
- [ ] SEC-022 Privacy policy matches actual cookies, analytics, account data, recruitment data, uploads, payment processing, retention, and contact process.
- [ ] SEC-023 Dependency, secret, and source scans contain no unresolved release-blocking findings.
- [ ] SEC-024 Database and upload backups are encrypted, restorable, access-controlled, and include required public/private asset roots.

## 24. API and operational audit

- [ ] OPS-001 `/api/openapi.json` loads and matches implemented public/auth/admin routes closely enough for operations/testing.
- [ ] OPS-002 Common success, validation, authentication, authorization, not-found, conflict, rate-limit, and server-error shapes are consistent.
- [ ] OPS-003 Production environment variables use correct frontend/API URLs, allowed origins, cookie name, database, storage, mail, proxy, and payment settings.
- [ ] OPS-004 Database migration status is clean and the deployed schema matches the application version.
- [ ] OPS-005 Public and private upload roots are durable, outside disposable release directories, and included in backup/restore procedures.
- [ ] OPS-006 Proxy/client IP configuration produces correct secure-cookie, origin, audit, and rate-limit behavior.
- [ ] OPS-007 Maintenance/capability flags disable only the intended commerce paths while free and bank-transfer registration remain correct.
- [ ] OPS-008 Server clock/timezone and database timestamps are synchronized; user-facing Sri Lankan times are correct.
- [ ] OPS-009 Logs correlate requests/jobs/payment events without leaking secrets or personal data.
- [ ] OPS-010 Alerting covers API health, elevated errors, database/storage exhaustion, job failure, mail failure, and payment callback failure.

## 25. Automated checks and release sign-off

- [x] REL-001 Backend `npm run lint` passes.
- [x] REL-002 Backend `npm run test:coverage` passes its line, branch, and function thresholds.
- [x] REL-003 Frontend `npm run lint` passes.
- [x] REL-004 Frontend production `npm run build` passes.
- [x] REL-005 Frontend `npm run test:e2e` passes against the intended test build/environment.
- [x] REL-006 New/fixed critical journeys have regression coverage or a documented reason why manual testing is sufficient.
- [ ] REL-007 Production database migration has been rehearsed on a recent backup or production-like dataset.
- [ ] REL-008 Backup restore has been tested for database, public uploads, and private proofs.
- [ ] REL-009 Rollback procedure is understood and remains compatible with forward-only database migrations.
- [ ] REL-010 PayHere sandbox launch matrix passes: paid, failed, cancelled, duplicate callback, mismatch, late callback, refund, and chargeback where enabled.
- [ ] REL-011 Final legal/business approval exists for privacy, terms, refund/return policy, prices, fees, bank details, and public contact information.
- [ ] REL-012 All S1/S2 defects are closed; remaining defects have accepted owner, severity, workaround, and target date.
- [ ] REL-013 Smoke test is repeated immediately after deployment on the production URL.
- [ ] REL-014 Monitoring/logs are watched through the first real signup, verification, tournament registration, upload, order, and payment callback.

## Bug report template

```text
Bug ID:
Title:
Severity: S1 / S2 / S3 / S4
Checklist ID:
Environment and build:
Browser/device:
Account/role:
Preconditions/test data:
Steps to reproduce:
1.
2.
3.

Expected result:
Actual result:
Reproduction rate:
Evidence (screenshots/video/console/network):
Sensitive data removed from evidence: Yes / No
Workaround:
Assigned owner:
Retest result and build:
```

## Final test summary

| Result | Count |
| --- | ---: |
| Passed | 6 automated release checks |
| Failed | 0 known |
| Blocked / not tested | 456 staging/manual checks |
| S1 open | 0 known |
| S2 open | 0 known |
| S3 open | 0 known |
| S4 open | 0 known |

### Sign-off

| Role | Name | Decision | Date | Notes |
| --- | --- | --- | --- | --- |
| QA / Tester | | Approve / Reject | | |
| Product / Operations | | Approve / Reject | | |
| Engineering | | Approve / Reject | | |
| Business / Legal | | Approve / Reject | | |
