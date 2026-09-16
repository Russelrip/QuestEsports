# Roles and Permissions

SITE-97. Who can create tournaments, upload posters, manage matches, approve
teams, and open the admin tools, and how that maps onto the access checks the
backend already runs.

Status: **proposed**. The "Today" columns describe what the code enforces on
`main`. The "Decision" columns are the recommendation. Items under
[Open questions](#open-questions) need an owner's call before anything is built.

## Principles

1. **Build on the three layers that exist.** No new RBAC framework. Quest
   already has a site role, delegable site areas, and per-tournament staff
   roles. Every decision below fits one of them.
2. **Money stays with admins.** Payments, refunds, fees, shop orders, tickets
   and expenses are admin-only. Nothing that moves or confirms money can be
   delegated.
3. **Scope delegation as narrowly as the job.** A referee for one tournament
   gets nothing on another tournament. A poster editor gets posters, not users.
4. **The backend is the authority.** The frontend only decides what to show.
   Every rule here is a route guard, not a hidden button.
5. **Granting access is admin-only and audited.** Only admins assign roles,
   areas or tournament staff, and each change is written to the audit log.

## The three layers

| Layer | Stored in | Checked by | Scope |
| --- | --- | --- | --- |
| Site role | `users.role` (`user` \| `admin`) | `requireAdmin`, `requireSuperAdmin` | Whole site |
| Staff area | `user_staff_permissions` (`StaffPermission` enum) | `requireStaffPermission(key)` | One admin area, site-wide |
| Tournament staff | `tournament_staff_assignments` (`tournament_admin` \| `referee`) | `requirePermission(scope)` in `permission.middleware.js` | One tournament |

Participant roles are not grants. They come from the data itself:
`saved_teams.captain_user_id`, `RegistrationMember.role`
(`CAPTAIN`/`PLAYER`/`SUBSTITUTE`/`COACH`), and match-room membership
(`captain`/`player`/`staff`).

## Roles

| Role | How someone gets it | What it is for |
| --- | --- | --- |
| **Visitor** | Not signed in | Browse tournaments, matches, posters, galleries, leaderboard |
| **Member** | Signed in, Discord connected | Profile, avatar, saved teams, invites, leaderboard registration, support |
| **Captain** | Owns a saved team or a registration | Register a team, manage its roster, pay, run its side of match rooms and veto |
| **Referee** | Assigned to a tournament by an admin | Run matches, match rooms and veto rooms for that tournament |
| **Tournament admin** | Assigned to a tournament by an admin | Everything a referee does, plus bracket/Challonge, veto config and registration review for that tournament |
| **Area staff** | Granted a staff area by an admin | One admin area: `valorant_leaderboard` today, `media` proposed |
| **Admin** | `users.role = admin`, set by another admin | Everything, including money, users and granting access |

## The five questions

### 1. Who can create tournaments?

| Action | Today | Decision |
| --- | --- | --- |
| Create tournament | Admin | **Admin** |
| Delete tournament | Admin | **Admin** |
| Edit tournament details, fees, payment methods, assets | Admin | **Admin** |
| Sponsors | Admin | **Admin** |
| Events and event series | Admin | **Admin** |

Creating a tournament sets the entry fee, payment methods and slot count, so it
stays with admins (principle 2). `PATCH /api/admin/tournaments/:id` takes
details and money fields in one request. Letting tournament admins edit the
non-financial fields would need that route split first. See open question 2.

### 2. Who can upload posters?

| Action | Today | Decision |
| --- | --- | --- |
| Create, edit, delete posters (`/api/posters`) | Admin | **Admin + `media` area** |
| Image library (`/api/images`) | Admin | **Admin + `media` area** |
| Event albums and photos | Admin | **Admin + `media` area** |
| Tournament banner, hero and winner images | Admin (part of tournament edit) | **Admin** (goes with question 1) |
| Team logo | Captain on registration; admin on `/admin/teams` | Unchanged |
| Avatar | The member themselves | Unchanged |

This is the one new staff area: `media`, for designers and social-media staff
who should not see registrations or payments. It follows the documented recipe
in [Admin Operations → Staff Access](./admin-operations.md#staff-access-delegated-admin-areas).
The legacy media migration routes (`/api/admin/media/import-legacy-posters`,
`/api/admin/media/migrate-image-assets`) stay admin-only.

### 3. Who can manage matches?

| Action | Today | Decision |
| --- | --- | --- |
| Create and update matches (`/api/v1/admin/.../matches`) | Admin, tournament admin, referee | Unchanged |
| Match rooms: sync, moderate, answer support | Admin, tournament admin, referee, directly assigned staff | Unchanged |
| Veto rooms: create, open, reset, rewind, cancel | Admin, tournament admin, referee | Unchanged |
| Tournament veto config | Admin, tournament admin | Unchanged |
| Veto map pools, rule presets, room templates | Admin (global); tournament admin (for their tournament) | Unchanged |
| Global veto maps | Admin | Unchanged |
| Challonge integration, sync, results | Admin, tournament admin | Unchanged |
| Native bracket: generate, edit, publish (`/api/admin/tournaments/:id/bracket`) | Admin | **Admin + tournament admin** for their tournament |
| VALORANT team binding, discovery, series finalisation | Admin | Unchanged |
| Ticket scanning and check-in | Admin | Unchanged (see open question 4) |

Match operations are already scoped per tournament. The only change is letting
the native bracket match Challonge, which a tournament admin can already
control.

### 4. Who can approve teams?

| Action | Today | Decision |
| --- | --- | --- |
| Approve, reject or waitlist a registration | Admin | **Admin + tournament admin** for their tournament |
| View registrations and rosters for a tournament | Admin | **Admin + tournament admin + referee** (read-only for referees) |
| Correct roster, game IDs, slot reservation | Admin | **Admin + tournament admin** for their tournament |
| Delete a registration | Admin | **Admin** |
| Export registrations (contact details) | Admin | **Admin** |
| Confirm bank-transfer, cash or PayHere payment | Admin | **Admin** |
| Saved teams: organisation label, captain transfer, delete | Admin | **Admin** |
| Game account change requests | Admin | **Admin** |

Approving a team does not confirm payment. They are separate steps today, and
this keeps them separate, so a tournament admin cannot approve a team into a
paid slot on their own. Deletion and exports stay admin-only because they
destroy data or copy personal contact data out of the site.

### 5. Who can access admin tools?

| Tool | Today | Decision |
| --- | --- | --- |
| `/admin` panel | Admin; area staff see only their areas | Plus tournament staff see their tournaments |
| Users, role changes | Admin | **Admin** |
| Granting staff areas and tournament staff | Admin | **Admin** |
| Audit log | Admin | **Admin** (IP addresses, every actor's history) |
| Payments, shop, orders, tickets, expenses | Admin | **Admin** |
| Contact inbox, recruitment, support inbox | Admin | **Admin** (see open question 3) |
| Rulebooks, games and categories | Admin | **Admin** |
| VALORANT leaderboard admin | Admin + `valorant_leaderboard` | Unchanged |
| Android admin app | Admin only (`mobile-admin/src/auth.tsx`) | **Admin** |

## Gaps in the current code

These came up while mapping the routes. None of them is a security hole today,
because every gap fails closed, but they need fixing before the decisions
above can work.

1. **Tournament staff cannot reach the admin panel.** The API lets referees and
   tournament admins run matches and veto rooms, but `canOpenAdminPath` in
   `frontend/lib/staff-permissions.ts` only admits admins and area staff, and
   `/admin/match-rooms` has no `permission` on its link. A referee has API
   access and no screen to use it from.
2. **Nothing in the UI assigns tournament staff.** `GET/POST/DELETE
   /api/v1/admin/tournaments/:id/staff` exist, but no frontend calls them.
3. **`staff.roster.management` is a dead scope.** `ROLE_SCOPES` gives it to
   `tournament_admin`, but the staff routes also run `requireSuperAdmin`, so
   only admins ever pass. Decision: only admins assign staff (principle 5), so
   remove the scope from `tournament_admin` rather than drop the admin guard.
   Fixed in #192.
4. **Any admin can make anyone an admin.** The only safeguard is that an admin
   cannot demote or delete themselves. See open question 1.

## Implementation order

Each step ships on its own and is safe to stop after.

1. Remove the dead scope from `tournament_admin` (gap 3). No behaviour change.
   Done in #192.
2. Add the `media` staff area to posters, images and event albums.
3. Tournament staff UI: assign staff on the tournament editor, and let tournament
   staff into `/admin` with only their tournaments, matches, match rooms and
   veto rooms (gaps 1, 2).
4. Registration review and native bracket for tournament admins. This needs
   the admin registration routes in `backend/src/modules/admin/admin.routes.js`
   moved off the blanket `router.use("/admin", requireAdmin)` and onto
   tournament-scoped guards.

Every step needs route tests for the admin path, the allowed staff path, the
wrong-tournament path and the plain-member path.

## Open questions

1. **Owner tier.** Should changing someone's `users.role` to or from `admin` be
   limited to a named owner set, matching the Discord `Owners` role? Today any
   admin can do it.
2. **Tournament admins editing their tournament.** Should they edit schedule,
   description and rules for their own tournament? That needs the tournament
   update route split into content and money fields.
3. **Support and contact inboxes.** Should answering support conversations be a
   staff area, so community staff can reply without seeing payments?
4. **Door staff for events.** Should ticket scanning and check-in be a staff
   area, so volunteers at the entrance do not need full admin?
5. **Who is admin today.** List the current admin accounts and confirm each
   one should keep full access once narrower roles exist.
