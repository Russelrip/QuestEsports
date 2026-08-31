# Integrated Valorant Map Veto Design

**Date:** 2026-08-31  
**Status:** Design approved in chat; implementation not started

## Goal

Give QuestEsports staff a reference-inspired, real-time Valorant map-veto
experience launched from an existing match. The first release supports
Valorant only and prioritizes a complete functional flow over a new standalone
product.

The experience should feel like a compact esports control surface: strong
match/team identity, an obvious current turn, visible timer, map cards, action
history, and role-specific views for staff, teams, spectators, and casters.

## Chosen approach

Extend the existing veto subsystem rather than introducing a second room model.
QuestEsports already has persistent veto rooms, role credentials, revision
checks, exact-room SSE updates, and polling fallback. The feature therefore
adds match integration and presentation changes around those capabilities.

This avoids duplicating authorization, persistence, timeout behavior, realtime
transport, and concurrency handling.

## Scope

### In scope

- Launching a veto from a Valorant match by an authorized staff user.
- Deriving the two match teams and their logos where available.
- Selecting BO1, BO3, or BO5 and configuring the action timeout before launch.
- Validating the map pool for the selected format.
- Linking the created room to the match.
- Displaying copyable/openable Admin, Team A, Team B, Spectator, and a distinct
  Caster link after creation.
- Presenting the existing veto route with an esports-oriented responsive UI.
- Role-aware controls and read-only spectator/caster views.
- Real-time updates through the existing SSE topic and visible-tab polling
  fallback.
- Showing completed veto results under the existing publication rules.

### Out of scope

- A new standalone room-creation product.
- A second persistence model or realtime protocol.
- Non-Valorant map pools.
- New tournament-wide veto history or analytics.
- Replacing the existing token/access model.
- Changing the authoritative veto rules without a separate rules decision.

## Architecture and data flow

1. A staff user opens an existing match in the admin or match-management
   context.
2. For an eligible Valorant match without an active linked room, the UI shows
   **Start map veto**.
3. The UI submits `matchId` and the selected format/configuration to the
   existing `POST /api/v1/admin/veto-rooms` endpoint.
4. The backend derives the match participants, snapshots the map pool/rules and
   settings, links the `VetoRoom` to the match, and returns the room code and
   role credentials/links, including a distinct caster grant.
5. The launch result displays the links without exposing credentials through
   public match projections.
6. Each role opens `/veto/[code]`. `VetoRoomView` loads the room and submits
   actions using the existing access mechanism and revision value.
7. Veto mutations publish the exact `veto:{code}` event. Clients update through
   SSE when available and retain the existing five-second visible-tab polling
   fallback.
8. Completion updates the linked match using the current veto service behavior.
   The public match projection exposes the result only when the existing
   `publishResult` rule permits it.

No new room tables, broad private realtime topics, or WebSocket transport are
required. The existing `VetoAccessRole` enum must be extended additively with
`caster`; this migration is the only schema change in scope.

## User experience

### Match launch surface

The match view includes a compact veto status card with these states:

- **Not started:** staff can start a room.
- **Starting soon:** the linked room exists but has not begun actions.
- **In progress:** staff can open the room and participants can use their
  issued links.
- **Completed:** the room can be opened for its history and the published
  summary can be displayed.

If an active linked room already exists, the primary action is **Open existing
veto**, not a second room creation action.

### Start-veto panel

The panel pre-fills Team A, Team B, logos, and the current Valorant map pool
from the match. Staff can choose BO1/BO3/BO5 and the action timeout before
creating the room. The selected pool and format are validated before submit;
invalid or incomplete match setup disables launch and explains why.

After success, the panel shows the six-character room code and role-specific
copy/open actions. It explicitly warns staff to save token links because they
cannot be recovered from a public room code.

### Veto room

The existing role-aware route is visually refined without changing its access
contract. The primary layout contains:

- Match and team header with clear team ownership.
- Current-turn and waiting-state indicator.
- Server-authoritative countdown display.
- Selectable map cards with disabled, banned, picked, and remaining states.
- Chronological action history.
- Completion/result state.

Team views expose only the actions allowed for that team and turn. Spectator
views are read-only. Caster views are read-only and optimized for broadcast
capture, with controls and nonessential management details omitted.

The visual direction may borrow the reference’s dark, condensed, high-contrast
esports treatment, uppercase labels, border-led cards, and restrained accent
glow, while retaining QuestEsports’ existing black/navy and purple/fuchsia
brand system rather than copying external branding.

The layout must stack cleanly on mobile; no interaction may depend on hover or
desktop-only width.

## Authorization and failure handling

- Room creation remains staff-authorized by the existing admin middleware and
  veto service access checks.
- Team, viewer, and caster access uses hashed room grants. Caster is a distinct
  read-only grant and must not be treated as a team or staff role. Credentials
  must not be included in public match DTOs or browser-visible public metadata.
- The backend remains authoritative for turn order, timeout outcomes, and
  state transitions.
- Revision conflicts produce a refresh/retry state rather than overwriting a
  newer action.
- SSE unavailability is non-fatal; the existing polling fallback remains the
  recovery path.
- Missing teams, unsupported game, or invalid map pool produces an actionable
  launch explanation rather than a generic request failure.
- Duplicate active launch returns/open existing room behavior rather than
  creating parallel rooms.
- A completed result remains private until publication is enabled by the
  existing match/result policy.

## Files and boundaries

Likely frontend touchpoints:

- `frontend/app/matches/[id]/page.tsx` — match-level placement and data flow.
- `frontend/components/veto/VetoRoomView.tsx` — role-aware room presentation
  and interaction polish.
- `frontend/lib/veto.ts` — typed launch/load/mutation client additions only if
  an existing client method is insufficient.
- `frontend/lib/realtime.ts` — reuse existing SSE behavior; change only if
  integration exposes a concrete gap.
- Existing shared UI primitives under `frontend/components/ui/`.

Backend touchpoints, only where existing contracts are insufficient:

- `backend/prisma/schema.prisma` and a new additive migration under
  `backend/prisma/migrations/` — add the `caster` access role without editing
  the applied original veto migration.
- `backend/src/modules/veto/veto.controller.js` and
  `backend/src/modules/veto/veto.service.js` — linked launch validation or
  response shaping, caster grant issuance/resolution/rotation.
- `backend/src/modules/matches/match.service.js` — match veto status/result
  projection if the current projection lacks a required state.
- Existing route registration under `backend/src/routes/v1.js`.

The implementation must read and follow the nearest codemaps before changing
the event, match, or veto boundaries. Any changed responsibility or data flow
must be reflected in the relevant codemap.

## Verification plan

### Backend/API

- Authorized staff can create one linked room from an eligible Valorant match.
- Team participants and room settings are snapshotted correctly.
- Ineligible matches return actionable validation errors.
- An existing active linked room is returned/reopened rather than duplicated.
- Unauthorized users cannot create rooms or mutate another role’s actions.
- Revision conflicts preserve the first accepted action and return a recoverable
  conflict.
- Completion and `publishResult` control public result visibility.

### Frontend

- Match status card renders all four room states.
- Launch validation, submit/loading, success links, and failure states work.
- Copy and open controls use the returned role links without leaking them into
  public match data.
- Team, spectator, and caster views expose the correct controls.
- Caster grants are distinct, read-only, rotatable, and never authorize team
  actions.
- Map, timer, turn, history, and completion states render from server data.
- SSE updates and polling fallback both refresh the room correctly.

### End to end

Use Playwright to cover staff launch through a team action and verify that the
other role views update. Run the scenario at desktop and mobile widths. Retain
existing unit/API tests for veto rules and add focused tests rather than
duplicating the entire room implementation.

## Acceptance criteria

The feature is ready when an authorized staff user can launch a Valorant BO1,
BO3, or BO5 veto from a real match, distribute working role links, and two
team roles can complete the server-validated flow while spectator and distinct
caster views update in real time or through fallback polling. The caster grant
is read-only and cannot perform team actions. The linked match shows the result
only according to its publication setting, and the automated tests cover the
launch, authorization, concurrency, responsive UI, caster isolation, and
realtime fallback paths described above.
