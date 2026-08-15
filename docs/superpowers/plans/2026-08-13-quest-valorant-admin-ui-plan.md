# Quest VALORANT Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js admin UI for the standalone VALORANT series flow inside `QuestEsports/frontend/`: admin navigation and page structure under `/admin/valorant`, SavedTeam → VALORANT team binding selection, Riot-ID two-player discovery with explicit candidate review and two-stage detail/import, standalone BO1/BO3/BO5 draft series creation, attach/remove/absolute reorder with Red/Blue side mapping, preview and finalize with the Rated/Unrated/forfeit/override UX, rankings and rating-history reads, operation/reconciliation state surfaces, and frontend unit tests — all consuming the Quest backend proxy routes defined in the backend integration plan. No public stats, no tournament fixture links, no Challonge, no mobile-admin screens, and no browser-install work in this plan.

**Architecture:** The browser talks only to Quest Express through the existing authenticated admin layer. Every new screen is a thin page under `frontend/app/admin/valorant/*` rendering a `"use client"` manager component under the existing `AdminShell`. A new `frontend/lib/valorant.ts` holds pure types/helpers (no runtime imports, unit-testable), `frontend/lib/valorant-api.ts` wraps `adminRequest` (from `frontend/lib/admin.ts`) and unwraps the backend `{ success, data, meta }` envelope, and `frontend/hooks/api/useValorant.ts` exposes `useApiQuery`-based read hooks. Mutations (bind, detach, import, create, attach, reorder, remove, finalize) follow the existing inline `useState` + `try/catch` + toast pattern used by `AdminTeamsManager` — no new mutation library. All FastAPI-facing work stays server-side; the frontend never sees VALORANT service tokens, never calls FastAPI URLs, and never invents error codes (friendly message mapping lives in the backend `valorant.client.js`; the UI surfaces `ApiRequestError.message` verbatim).

**Tech Stack:** Next.js 16 (App Router, `"use client"` managers), React 19, TypeScript 5 (strict), Tailwind v4, vitest 4 (unit tests in `frontend/tests/unit/`, `npm test`), existing UI primitives (`components/ui/{button,card,input,textarea,select,badge,empty-state,skeleton}.tsx`), existing hooks (`useApiQuery`, `useDebouncedValue`, `useToastStore`), existing admin conventions (`AdminShell`, `AdminGuard`, `adminRequest`, `adminNavigationGroups`, `formatAdminCompactDateTime`).

**Spec:** `QuestEsports/docs/superpowers/specs/2026-08-13-standalone-valorant-integration-design.md` (rev 2, approved). This plan implements the **frontend admin UI slice** of that spec (§3.1 topology browser→Quest, §5.1–§5.7 admin workflows, §6.2 proxy route table as the consumed HTTP surface, §6.4 response shapes, §6.5 error mapping as backend-owned, §8.2–§8.3 reconciliation visibility, §9.1 access boundaries, §10.3 UI verification). The Quest backend routes this UI calls are implemented by `docs/superpowers/plans/2026-08-13-quest-valorant-backend-integration-plan.md` (Task 10 route table); the FastAPI deltas D1–D11 are owned by the sibling repo and are prerequisites, not work here. The deployment/verification plan is `docs/superpowers/plans/2026-08-13-valorant-deployment-verification-plan.md`.

## Global Constraints

Copied from the approved spec and the backend plan; every task inherits these:

1. **Browser talks only to Quest.** The UI calls only the Quest admin proxy routes (`/api/v1/admin/valorant/...` via `adminRequest`); no component contains a FastAPI URL, a Henrik URL, `X-Admin-Key`, or a service-token reference (§3.1, §9.1). Enforced by a source-assertion unit test (Task 1).
2. **No candidate is ever auto-imported or auto-attached** (§5.2). Discovery renders candidates for explicit admin selection; import happens only on an explicit click in the review step. Enforced by source-assertion tests (Task 3).
3. **Quest `SavedTeam` is the team-selection source** (§1.1 A4). The bind form selects from the existing `fetchProfileTeams()`/`useTeams` result set and never fabricates team identities.
4. **Binding detach is Quest-local; there is no re-activate UI in MVP** and no delete of VALORANT data from the UI (§5.1, §7.5). The detach confirmation copy must not imply deletion of VALORANT data.
5. **Finalize is never blind-retried from the UI** (§5.5, §8.2). A timeout/unknown outcome renders an operation `reconciliation_required` banner offering a read-only "Re-check status" (re-fetch `series` + `preview`) — no automatic re-POST. Adoption of committed state is backend-owned (`reconcileSeries`, not yet routed by the backend plan); the UI surfaces observed state only.
6. **Series status values are `draft | finalized | orphaned | reconciliation_required`; FastAPI only reports `draft|finalized`** (§4.3). The UI status badges use exactly these values and never show a `finalizing` series status.
7. **Error copy is backend-owned.** The UI renders `ApiRequestError.message` verbatim and ships the existing fixed fallback strings for transport failures ("Could not reach the server...", "The request took too long...", per `frontend/lib/api.ts`). No new error-code mapping table in the frontend (§6.5).
8. **`unrated` means no ELO and no counters; forfeit/override modes require a reason** (§5.6, delta D5). The finalize form enforces the reason field client-side for `manual_override`, `forfeit_no_rating`, and `forfeit_result_only`, and explains Rated/Unrated semantics in helper text.
9. **No new dependencies; no browser-install work.** No drag-drop library (reorder is an absolute desired-order control), no React Query, no chart library. Do not run `npx playwright install` (§10.3). UI verification is deferred to Playwright MCP / manual browser; `frontend/playwright.config.ts` stays untouched.
10. **Keep existing conventions.** Thin pages under `app/admin/*`, `"use client"` managers under `components/admin/*`, `useApiQuery` reads, inline mutation state, `AdminShell` titles/descriptions, `formatAdminCompactDateTime` for timestamps, `sr-only`/`aria-label` on icon-only controls, `min-w-0` + `overflow-x-auto` tables for responsive admin screens, `EmptyState` for empties, `AdminTableSkeleton` for loading.
11. **Frontend unit tests must run without a DOM.** `vitest run tests/unit` has no jsdom; tests either import pure helpers from `frontend/lib/valorant.ts` (no runtime imports) or assert component source text (the `tests/unit/challonge.test.ts` pattern). `lib/valorant-api.test.ts` mocks `../../lib/admin`.
12. **No public stats, tournament fixture links, Challonge, or mobile-admin work** (§2.1). The `adminNavigationGroups` entry links only the seven `/admin/valorant/*` screens in this plan.
13. **Out-of-scope backend surfaces are not invented.** The reconciliation page is read-only (report + "Refresh report"); it does not render adopt/resync POST buttons because the backend plan does not route them. The finalize "Re-check status" performs reads only.
14. **`/admin/valorant/*` stays behind the existing `AdminGuard`/`requireAdmin`** (via `AdminShell`); no new auth code in the frontend.

---

## File Structure

```
frontend/
  lib/admin.ts                                MODIFY: add "VALORANT" adminNavigationGroups entry
  lib/valorant.ts                             CREATE: pure types + helpers (no runtime imports)
  lib/valorant-api.ts                         CREATE: adminRequest wrappers (unwraps { data })
  hooks/api/useValorant.ts                    CREATE: useApiQuery-based read hooks
  components/admin/AdminShell.tsx             MODIFY: widen the nav grid for the 5th group
  app/admin/valorant/page.tsx                 CREATE: thin page -> <ValorantHub />
  app/admin/valorant/teams/page.tsx           CREATE: thin page -> <ValorantTeamsManager />
  app/admin/valorant/discover/page.tsx        CREATE: thin page -> <ValorantDiscoveryManager />
  app/admin/valorant/series/page.tsx          CREATE: thin page -> <ValorantSeriesManager />
  app/admin/valorant/series/new/page.tsx      CREATE: thin page -> <ValorantSeriesForm />
  app/admin/valorant/series/[id]/page.tsx     CREATE: thin page -> <ValorantSeriesDetail />
  app/admin/valorant/rankings/page.tsx        CREATE: thin page -> <ValorantRankingsManager />
  app/admin/valorant/reconciliation/page.tsx  CREATE: thin page -> <ValorantReconciliationManager />
  components/admin/valorant/
    ValorantHub.tsx                           CREATE: overview hub with per-screen cards + counts
    ValorantStatusBadge.tsx                   CREATE: series/binding/operation status badges
    ValorantOperationBanner.tsx               CREATE: last-operation + in-flight + reconcile banner
    ValorantErrorAlert.tsx                    CREATE: error title/description + optional Retry
    ValorantEmptyState.tsx                    CREATE: EmptyState wrapper with default copy
    ValorantLoadingState.tsx                  CREATE: AdminTableSkeleton wrapper
    ValorantTeamsManager.tsx                  CREATE: bindings list + SavedTeam bind form
    ValorantBindingForm.tsx                   CREATE: SavedTeam select + Bind button
    ValorantDiscoveryManager.tsx              CREATE: discovery form -> results -> review -> imported
    ValorantDiscoveryForm.tsx                 CREATE: Riot ID A/B inputs + filters + Submit
    ValorantCandidateList.tsx                 CREATE: candidate table (no winningSide/roster)
    ValorantCandidateReview.tsx               CREATE: detail modal + explicit import button
    ValorantSeriesManager.tsx                 CREATE: series list + New Series button
    ValorantSeriesForm.tsx                    CREATE: create draft (teams/format/playedAt/preference/anchors)
    ValorantSeriesDetail.tsx                  CREATE: header, games, attach, reorder, preview, finalize, ops
    ValorantGameRow.tsx                       CREATE: game row with side badges + remove
    ValorantMatchLibrary.tsx                  CREATE: paged imported-match picker
    ValorantAttachGameDialog.tsx              CREATE: gameNumber + teamASide + submit
    ValorantSideBadges.tsx                    CREATE: "Team A: Red / Team B: Blue" badges
    ValorantReorderControl.tsx                CREATE: per-game number selects + Save order
    ValorantPreviewPanel.tsx                  CREATE: preview card (valid/maps won/winner/errors/anchors)
    ValorantFinalizeForm.tsx                  CREATE: rating-mode group + winner + reason + submit
    ValorantRankingsManager.tsx               CREATE: rankings table + team drill-down
    ValorantRatingHistoryPanel.tsx            CREATE: rating events + team series
    ValorantReconciliationManager.tsx         CREATE: read-only report sections + refresh
  tests/unit/valorant.test.ts                 CREATE: pure-helper unit tests
  tests/unit/valorant-api.test.ts             CREATE: request-shape tests (mock ../../lib/admin)
  tests/unit/valorant-components.test.ts      CREATE: source-assertion guards (challonge style)
```

**Module boundaries:**
- `lib/valorant.ts` — pure types, literals, and helpers. Zero runtime imports (only `import type`), so vitest can import it directly.
- `lib/valorant-api.ts` — every Quest route call; imports `adminRequest` from `./admin`; unwraps `data` from `{ success, data, meta }`; never touches `fetch` directly.
- `hooks/api/useValorant.ts` — read-only hooks only. Mutations stay inline in managers (existing convention).
- `components/admin/valorant/*` — presentation + inline mutation state; never calls `adminRequest` directly, always through `lib/valorant-api.ts`.
- Pages under `app/admin/valorant/*` — thin (page → single manager), matching `app/admin/games/page.tsx`.

---

## Interfaces Consumed (from the Quest backend integration plan)

The backend plan (Task 10) exposes these admin proxy routes with envelope `{ success: true, data: <payload>, meta: { serverNow } }`; errors are `ApiRequestError` (message = backend `HttpError` message, which already carries the §6.5 friendly mapping). `lib/valorant-api.ts` unwraps `.data` on success and lets `adminRequest` throw `ApiRequestError` on failure.

| Backend route (consumed) | Payload shape consumed (camelCase as returned by backend) | Frontend consumer |
|---|---|---|
| `GET /admin/valorant/teams` | `{ bindings: Binding[] }` | `fetchValorantBindings()` |
| `POST /admin/valorant/teams/bind` | `{ binding: Binding }` | `bindValorantTeam(savedTeamId)` |
| `DELETE /admin/valorant/teams/:bindingId/detach` | `{ binding: Binding }` | `detachValorantBinding(bindingId)` |
| `POST /admin/valorant/discover` | `{ players: { a: ResolvedPlayer, b: ResolvedPlayer }, candidates: MatchCandidate[], search: { pagesExamined, pageSize } }` | `discoverValorant(input)` |
| `POST /admin/valorant/matches/import` | `{ match: MatchDetail, created: boolean }` | `importValorantMatch(henrikMatchId, affinity)` |
| `GET /admin/valorant/matches/by-henrik-id/:henrikMatchId` | `{ match: MatchDetail }` | `fetchValorantMatchByHenrikId(id)` |
| `GET /admin/valorant/matches` | FastAPI `MatchListResponse` **verbatim (snake_case)** `{ items, next_cursor, total }` (pinned from `valorant-platform-backend/app/schemas/matches.py` `MatchSummaryResponse`) | `fetchValorantMatches({ cursor, limit })` + `mapMatchSummary` |
| `POST /admin/valorant/series` | `{ series: QuestValorantSeries }` | `createValorantSeries(input)` |
| `GET /admin/valorant/series` | `{ series: QuestValorantSeries[] }` | `fetchValorantSeriesList()` |
| `GET /admin/valorant/series/:id` | `{ series: QuestValorantSeries }` (incl. `bindingA`, `bindingB`, `games`, `lastOperation`) | `fetchValorantSeries(id)` |
| `DELETE /admin/valorant/series/:id` | 200 `{ success, message }` | `deleteValorantSeries(id)` |
| `POST /admin/valorant/series/:id/games` | `{ game: SeriesGame }` | `attachValorantGame(seriesId, input)` |
| `PUT /admin/valorant/series/:id/games/order` | 200 `{ success, message }` | `setValorantGameOrder(seriesId, games)` |
| `DELETE /admin/valorant/series/:id/games/:gameId` | 200 `{ success, message }` | `removeValorantGame(seriesId, gameId)` |
| `GET /admin/valorant/series/:id/preview` | `{ preview: SeriesPreview }` | `fetchValorantPreview(seriesId)` |
| `POST /admin/valorant/series/:id/finalize` | `{ result: FinalizeResult }` (incl. `operationId`) | `finalizeValorantSeries(seriesId, input)` |
| `GET /admin/valorant/rankings` | `{ rankings: RankingEntry[] }` | `fetchValorantRankings()` |
| `GET /admin/valorant/teams/:teamId/rating-history` | `{ events: RatingEvent[] }` | `fetchValorantRatingHistory(teamId)` |
| `GET /admin/valorant/teams/:teamId/series` | `{ series: SeriesViewLite[] }` | `fetchValorantTeamSeries(teamId)` |
| `GET /admin/valorant/reconciliation` | `{ report: ReconciliationReport }` | `fetchValorantReconciliation()` |

Also consumed: `SavedTeam`/`SavedTeamMember` (`frontend/lib/teams.ts`) via the existing `fetchProfileTeams()` for the bind form, and `formatAdminCompactDateTime`/`adminNavigationGroups` (`frontend/lib/admin.ts`) for tables and navigation.

## Interfaces Produced (frontend module contract)

**`lib/valorant.ts`** (all pure; no runtime imports):

```ts
export const VALORANT_FORMATS = ["bo1", "bo3", "bo5"] as const;
export type ValorantFormat = (typeof VALORANT_FORMATS)[number];
export type ValorantSide = "red" | "blue";
export type ValorantSeriesStatus = "draft" | "finalized" | "orphaned" | "reconciliation_required";
export type ValorantBindingStatus = "active" | "detached";
export type ValorantOperationStatus = "pending" | "in_flight" | "succeeded" | "failed" | "reconciliation_required";
export type ValorantRatingMode = "normal" | "unrated" | "forfeit_no_rating" | "forfeit_result_only" | "manual_override";

export type RiotId = { name: string; tag: string };
export type ResolvedPlayer = { id: string; puuid: string; name: string; tag: string; affinity: string };
export type MatchCandidate = {
  henrikMatchId: string; affinity: string; map: string | null; startedAt: string | null;
  mode: string | null; queue: string | null; isCompleted: boolean;
  redScore: number | null; blueScore: number | null; alreadyImported: boolean;
};
export type MatchPlayer = {
  puuid: string; name: string; tag: string; side: ValorantSide;
  agentName: string | null; kills: number | null; deaths: number | null; assists: number | null;
};
export type MatchDetail = {
  matchId: string; henrikMatchId: string; affinity: string; platform: string; mapName: string;
  mode: string | null; queue: string | null; startedAt: string; isCompleted: boolean;
  redScore: number | null; blueScore: number | null; winningSide: ValorantSide | null;
  players: MatchPlayer[]; rawPayloadAvailable: boolean;
};
export type ValorantMatchSummary = {
  matchId: string; henrikMatchId: string; affinity: string; platform: string; mapName: string;
  mode: string | null; queue: string | null; startedAt: string; isCompleted: boolean;
  redScore: number | null; blueScore: number | null; winningSide: ValorantSide | null;
};
export type Binding = {
  id: string; savedTeamId: string | null; valorantTeamUuid: string; status: ValorantBindingStatus;
  boundByUserId: string | null; boundAt: string; detachedAt: string | null;
  savedTeam: { id: string; name: string; teamTag: string | null } | null;
  boundByUser: { id: string; username: string } | null;
};
export type SeriesGame = {
  id: string; questSeriesId: string; gameNumber: number; matchId: string;
  teamASide: ValorantSide; teamBSide: ValorantSide; mapName: string | null;
};
export type QuestValorantSeries = {
  id: string; externalKey: string; bindingAId: string; bindingBId: string; format: ValorantFormat;
  playedAt: string; ratingModePreference: ValorantRatingMode | null; status: ValorantSeriesStatus;
  valorantSeriesUuid: string | null; finalizedById: string | null; lastOperationId: string | null;
  bindingA: Binding; bindingB: Binding; games: SeriesGame[];
  lastOperation: QuestValorantOperation | null;
};
export type QuestValorantOperation = {
  id: string; operationId: string; type: string; externalKey: string | null; questSeriesId: string | null;
  status: ValorantOperationStatus; fastapiRequestId: string | null; responseCode: number | null;
  errorCode: string | null; responseSummary: Record<string, unknown> | null;
};
export type GameView = {
  id: string; gameNumber: number; matchId: string; mapName: string | null;
  teamASide: ValorantSide; teamBSide: ValorantSide;
  teamARounds: number; teamBRounds: number; winnerTeamId: string | null;
};
export type SeriesPreview = {
  valid: boolean; teamAMapsWon: number; teamBMapsWon: number;
  calculatedWinnerId: string | null; games: GameView[]; errors: string[];
};
export type RatingEvent = {
  id: string; runId: string; seriesId: string; teamId: string; eloBefore: string; eloAfter: string;
  result: string; sequence: number; kFactor: number | null; calculationDetails: Record<string, unknown>;
};
export type FinalizeResult = {
  seriesId: string; status: string; calculatedWinnerId: string | null; officialWinnerId: string | null;
  winnerOverrideReason: string | null; ratingMode: ValorantRatingMode | null;
  events: RatingEvent[]; teamACurrentElo: number; teamBCurrentElo: number; operationId: string;
};
export type RankingEntry = { teamId: string; rank: number; elo: number; seriesWins: number; seriesLosses: number };
export type SeriesViewLite = {
  id: string; teamAId: string; teamBId: string; format: ValorantFormat; status: string;
  teamAMapsWon: number; teamBMapsWon: number; playedAt: string | null; ratingMode: ValorantRatingMode | null;
};
export type ReconciliationReport = {
  orphaned: Array<{ id: string; externalKey: string; valorantSeriesUuid: string | null; status: ValorantSeriesStatus }>;
  unprojected: Array<{ id: string; externalQuestSeriesId: string | null }>;
  teamMissing: Binding[];
  matchMissing: Array<{ id: string; matchId: string; henrikMatchId: string }>;
  stuckOperations: Array<{ id: string; operationId: string; type: string; status: ValorantOperationStatus; questSeriesId: string | null }>;
};

export const mapsForFormat = (format: ValorantFormat): number;            // bo1->1, bo3->3, bo5->5
export const REQUIRES_REASON_RATING_MODES: ReadonlySet<ValorantRatingMode>; // manual_override, forfeit_no_rating, forfeit_result_only
export const ratingModeLabel = (mode: ValorantRatingMode | null): string;
export const seriesStatusLabel = (status: ValorantSeriesStatus): string;
export const operationStatusLabel = (status: ValorantOperationStatus): string;
export const parseRiotIdInput = (value: string): RiotId | null;          // "Name#Tag" pre-validation
export const formatRiotId = (id: RiotId): string;
export const mapMatchSummary = (raw: {
  id: string; henrik_match_id: string; affinity: string; platform: string; map_name: string;
  mode?: string | null; queue?: string | null; started_at: string; is_completed: boolean;
  red_score?: number | null; blue_score?: number | null; winning_side?: string | null;
}): ValorantMatchSummary;
export const validateDesiredOrder = (numbers: number[], count: number): string | null; // permutation check
export const nextGameNumber = (existing: number[], format: ValorantFormat): number | null;
export const joinRankingsWithBindings = (rankings: RankingEntry[], bindings: Binding[]): Array<RankingEntry & { teamLabel: string }>;
export const formatEloDelta = (before: string, after: string): string;
```

**`lib/valorant-api.ts`** (wraps `adminRequest`; consumes the route table above):

```ts
import { adminRequest } from "./admin";
import type { /* all types from ./valorant */ } from "./valorant";

export const valorantAdminRequest = async <T>(
  path: string,
  options?: Parameters<typeof adminRequest>[1]
): Promise<T> => {
  const envelope = await adminRequest<{ data: T }>(path, options);
  return envelope.data;
};
// fetchValorantBindings / bindValorantTeam / detachValorantBinding / discoverValorant
// importValorantMatch / fetchValorantMatchByHenrikId / fetchValorantMatches
// createValorantSeries / fetchValorantSeriesList / fetchValorantSeries / deleteValorantSeries
// attachValorantGame / setValorantGameOrder / removeValorantGame / fetchValorantPreview
// finalizeValorantSeries / fetchValorantRankings / fetchValorantRatingHistory
// fetchValorantTeamSeries / fetchValorantReconciliation
```

**`hooks/api/useValorant.ts`** (read-only; all `useApiQuery`-based): `useValorantBindings()`, `useValorantSeriesList()`, `useValorantSeriesDetail(seriesId)`, `useValorantPreview(seriesId, enabled)`, `useValorantMatches({ cursor, enabled })`, `useValorantRankings()`, `useValorantRatingHistory(teamId, enabled)`, `useValorantTeamSeries(teamId, enabled)`, `useValorantReconciliation()`. Mutation flows stay inline in managers.

---

### Task 1: Admin navigation entry, VALORANT lib foundation, overview hub

**Files:**
- Modify: `frontend/lib/admin.ts` (append the `VALORANT` group to `adminNavigationGroups`)
- Modify: `frontend/components/admin/AdminShell.tsx` (nav grid columns for a 5th group)
- Create: `frontend/lib/valorant.ts` (full pure module from "Interfaces Produced")
- Create: `frontend/lib/valorant-api.ts` (request wrappers per the consumed route table)
- Create: `frontend/hooks/api/useValorant.ts` (`useValorantBindings`; the rest in later tasks)
- Create: `frontend/app/admin/valorant/page.tsx`
- Create: `frontend/components/admin/valorant/ValorantHub.tsx`, `ValorantStatusBadge.tsx`, `ValorantOperationBanner.tsx`, `ValorantErrorAlert.tsx`, `ValorantEmptyState.tsx`, `ValorantLoadingState.tsx`
- Create: `frontend/tests/unit/valorant.test.ts`, `frontend/tests/unit/valorant-api.test.ts`, `frontend/tests/unit/valorant-components.test.ts` (navigation + no-FastAPI-URL guards here; extended in later tasks)

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/valorant.test.ts` (pure helpers — this is the red gate for `lib/valorant.ts`):

```ts
import { describe, expect, it } from "vitest";
import {
  REQUIRES_REASON_RATING_MODES,
  formatEloDelta,
  formatRiotId,
  joinRankingsWithBindings,
  mapMatchSummary,
  mapsForFormat,
  nextGameNumber,
  parseRiotIdInput,
  ratingModeLabel,
  seriesStatusLabel,
  validateDesiredOrder,
  type Binding,
  type RankingEntry,
} from "../../lib/valorant";

describe("VALORANT pure helpers", () => {
  it("maps formats to required map counts", () => {
    expect(mapsForFormat("bo1")).toBe(1);
    expect(mapsForFormat("bo3")).toBe(3);
    expect(mapsForFormat("bo5")).toBe(5);
  });

  it("requires a reason exactly for the three forfeit/override modes", () => {
    expect(REQUIRES_REASON_RATING_MODES.has("manual_override")).toBe(true);
    expect(REQUIRES_REASON_RATING_MODES.has("forfeit_no_rating")).toBe(true);
    expect(REQUIRES_REASON_RATING_MODES.has("forfeit_result_only")).toBe(true);
    expect(REQUIRES_REASON_RATING_MODES.has("normal")).toBe(false);
    expect(REQUIRES_REASON_RATING_MODES.has("unrated")).toBe(false);
  });

  it("parses Name#Tag and rejects malformed input", () => {
    expect(parseRiotIdInput("TenZ#SEN")).toEqual({ name: "TenZ", tag: "SEN" });
    expect(parseRiotIdInput("  Demon1#NA ")).toEqual({ name: "Demon1", tag: "NA" });
    for (const bad of ["", "NoTag", "a#b#c", "#tag", "name#", "x".repeat(33) + "#SEN"]) {
      expect(parseRiotIdInput(bad)).toBeNull();
    }
    expect(formatRiotId({ name: "TenZ", tag: "SEN" })).toBe("TenZ#SEN");
  });

  it("maps the FastAPI match-library summary to the display shape", () => {
    const mapped = mapMatchSummary({
      id: "00000000-0000-4000-8000-00000000000e",
      henrik_match_id: "abcdef0123",
      affinity: "eu",
      platform: "pc",
      map_name: "Ascent",
      started_at: "2026-08-01T14:30:00Z",
      is_completed: true,
      red_score: 13,
      blue_score: 8,
      winning_side: "red",
    });
    expect(mapped.matchId).toBe("00000000-0000-4000-8000-00000000000e");
    expect(mapped.mapName).toBe("Ascent");
    expect(mapped.winningSide).toBe("red");
  });

  it("validates that reorder numbers form a full 1..N permutation", () => {
    expect(validateDesiredOrder([3, 1, 2], 3)).toBeNull();
    expect(validateDesiredOrder([1, 1, 2], 3)).toBe("Assign each map a unique number from 1 to 3.");
    expect(validateDesiredOrder([1, 2], 3)).toBe("Assign each map a unique number from 1 to 3.");
    expect(validateDesiredOrder([1, 2, 4], 3)).toBe("Assign each map a unique number from 1 to 3.");
  });

  it("suggests the next free game number within the format", () => {
    expect(nextGameNumber([1, 3], "bo3")).toBe(2);
    expect(nextGameNumber([1, 2, 3], "bo3")).toBeNull();
  });

  it("joins rankings with binding display names", () => {
    const rankings: RankingEntry[] = [{ teamId: "val-team-1", rank: 1, elo: 1218, seriesWins: 2, seriesLosses: 0 }];
    const bindings: Binding[] = [{
      id: "b-1", savedTeamId: "saved-1", valorantTeamUuid: "val-team-1", status: "active",
      boundByUserId: "u-1", boundAt: "2026-08-01T00:00:00Z", detachedAt: null,
      savedTeam: { id: "saved-1", name: "Quest Five", teamTag: "QF" }, boundByUser: null,
    }];
    const rows = joinRankingsWithBindings(rankings, bindings);
    expect(rows[0].teamLabel).toBe("Quest Five");
    expect(joinRankingsWithBindings(rankings, []).every((r) => r.teamLabel.startsWith("VAL team"))).toBe(true);
  });

  it("formats ELO deltas and status labels", () => {
    expect(formatEloDelta("1200", "1218")).toBe("+18");
    expect(formatEloDelta("1218", "1200")).toBe("-18");
    expect(formatEloDelta("1200", "1200")).toBe("±0");
    expect(seriesStatusLabel("reconciliation_required")).toBe("Reconciliation required");
    expect(ratingModeLabel("unrated")).toBe("Unrated");
  });
});
```

Create `frontend/tests/unit/valorant-api.test.ts` (request-shape gate for `lib/valorant-api.ts`):

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminRequest } from "../../lib/admin";

vi.mock("../../lib/admin", () => ({ adminRequest: vi.fn() }));
const mockedRequest = vi.mocked(adminRequest);

const unwrap = <T>(payload: T) => ({ success: true as const, data: payload, meta: { serverNow: "2026-08-13T00:00:00Z" } });

afterEach(() => mockedRequest.mockReset());

describe("VALORANT admin API client", () => {
  it("unwraps the { data } envelope", async () => {
    mockedRequest.mockResolvedValueOnce(unwrap({ bindings: [] }));
    const { fetchValorantBindings } = await import("../../lib/valorant-api");
    const result = await fetchValorantBindings();
    expect(result).toEqual({ bindings: [] });
    expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/teams");
  });

  it("sends the exact bind body", async () => {
    mockedRequest.mockResolvedValueOnce(unwrap({ binding: { id: "b-1" } }));
    const { bindValorantTeam } = await import("../../lib/valorant-api");
    await bindValorantTeam("saved-team-1");
    expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/teams/bind", {
      method: "POST",
      json: { savedTeamId: "saved-team-1" },
    });
  });

  it("sends the exact finalize body with nullable winner and reason", async () => {
    mockedRequest.mockResolvedValueOnce(unwrap({ result: { seriesId: "s-1", status: "finalized", operationId: "op-1" } }));
    const { finalizeValorantSeries } = await import("../../lib/valorant-api");
    await finalizeValorantSeries("quest-series-1", { ratingMode: "normal", officialWinnerTeamId: null, overrideReason: null });
    expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/series/quest-series-1/finalize", {
      method: "POST",
      json: { ratingMode: "normal", officialWinnerTeamId: null, overrideReason: null },
    });
  });

  it("maps the raw match library to camelCase through the envelope", async () => {
    mockedRequest.mockResolvedValueOnce(unwrap({
      items: [{ id: "m-1", henrik_match_id: "h-1", affinity: "eu", platform: "pc", map_name: "Ascent", started_at: "2026-08-01T14:30:00Z", is_completed: true, red_score: 13, blue_score: 8, winning_side: "red" }],
      next_cursor: null,
      total: 1,
    }));
    const { fetchValorantMatches } = await import("../../lib/valorant-api");
    const result = await fetchValorantMatches({ limit: 20 });
    expect(result.items[0].matchId).toBe("m-1");
    expect(result.items[0].mapName).toBe("Ascent");
    expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/matches?limit=20");
  });
});
```

Note: the bind/finalize/etc. functions in `lib/valorant-api.ts` must use the existing `apiFetch` JSON convention (`json:` key, method) that `adminRequest`'s options accept — mirror how `frontend/lib/teams.ts` calls `apiFetchJson`/`adminRequest` with `{ method: "POST", json: {...} }`. Inspect `frontend/lib/auth.ts` `apiFetch` to confirm the exact option key (`json`) before implementing; the request-shape tests above pin the final contract.

Create `frontend/tests/unit/valorant-components.test.ts` (source guards; extended in later tasks — start with navigation + no-FastAPI):

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("VALORANT admin UI boundaries", () => {
  it("registers the VALORANT navigation group with exactly the planned screens", () => {
    const lib = read("lib/admin.ts");
    expect(lib).toContain('label: "VALORANT"');
    for (const href of [
      "/admin/valorant",
      "/admin/valorant/teams",
      "/admin/valorant/discover",
      "/admin/valorant/series",
      "/admin/valorant/rankings",
      "/admin/valorant/reconciliation",
    ]) {
      expect(lib).toContain(`{ href: "${href}"`);
    }
  });

  it("never references the FastAPI service or Henrik from the frontend", () => {
    const files = [
      "lib/valorant.ts",
      "lib/valorant-api.ts",
      "components/admin/valorant/ValorantHub.tsx",
      "components/admin/valorant/ValorantTeamsManager.tsx",
      "components/admin/valorant/ValorantDiscoveryManager.tsx",
      "components/admin/valorant/ValorantSeriesDetail.tsx",
      "components/admin/valorant/ValorantRankingsManager.tsx",
      "components/admin/valorant/ValorantReconciliationManager.tsx",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/localhost:8000|valorant-platform-backend|api\.henrikdev|X-Admin-Key|VALORANT_SERVICE_SECRET/);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/valorant.test.ts tests/unit/valorant-api.test.ts tests/unit/valorant-components.test.ts`
Expected: FAIL — `lib/valorant.ts` / `lib/valorant-api.ts` / the component files do not exist yet; the `lib/admin.ts` assertion fails (no `VALORANT` group).

- [ ] **Step 3: Implement `lib/valorant.ts`**

Create `frontend/lib/valorant.ts` with the exact types, literals, and helpers from "Interfaces Produced". Key logic:

```ts
export const mapsForFormat = (format: ValorantFormat): number =>
  ({ bo1: 1, bo3: 3, bo5: 5 })[format];

export const REQUIRES_REASON_RATING_MODES: ReadonlySet<ValorantRatingMode> = new Set([
  "manual_override",
  "forfeit_no_rating",
  "forfeit_result_only",
]);

export const ratingModeLabel = (mode: ValorantRatingMode | null): string => {
  switch (mode) {
    case "normal": return "Rated";
    case "unrated": return "Unrated";
    case "forfeit_no_rating": return "Forfeit — no rating";
    case "forfeit_result_only": return "Forfeit — result only";
    case "manual_override": return "Manual override";
    default: return "Not set";
  }
};

export const seriesStatusLabel = (status: ValorantSeriesStatus): string =>
  ({ draft: "Draft", finalized: "Finalized", orphaned: "Orphaned", reconciliation_required: "Reconciliation required" })[status];

export const operationStatusLabel = (status: ValorantOperationStatus): string =>
  ({ pending: "Pending", in_flight: "In progress", succeeded: "Succeeded", failed: "Failed", reconciliation_required: "Reconciliation required" })[status];

const RIOT_ID_PATTERN = /^([^#\s]{1,32})#([^#\s]{1,16})$/;

export const parseRiotIdInput = (value: string): RiotId | null => {
  const match = RIOT_ID_PATTERN.exec(String(value || "").trim());
  return match ? { name: match[1], tag: match[2] } : null;
};

export const formatRiotId = (id: RiotId): string => `${id.name}#${id.tag}`;

export const mapMatchSummary = (raw: {
  id: string; henrik_match_id: string; affinity: string; platform: string; map_name: string;
  mode?: string | null; queue?: string | null; started_at: string; is_completed: boolean;
  red_score?: number | null; blue_score?: number | null; winning_side?: string | null;
}): ValorantMatchSummary => ({
  matchId: raw.id,
  henrikMatchId: raw.henrik_match_id,
  affinity: raw.affinity,
  platform: raw.platform,
  mapName: raw.map_name,
  mode: raw.mode ?? null,
  queue: raw.queue ?? null,
  startedAt: raw.started_at,
  isCompleted: raw.is_completed,
  redScore: raw.red_score ?? null,
  blueScore: raw.blue_score ?? null,
  winningSide: raw.winning_side === "red" || raw.winning_side === "blue" ? raw.winning_side : null,
});

export const validateDesiredOrder = (numbers: number[], count: number): string | null => {
  const expected = new Set(Array.from({ length: count }, (_, i) => i + 1));
  const actual = new Set(numbers);
  if (actual.size !== numbers.length || actual.size !== count || ![...expected].every((n) => actual.has(n))) {
    return `Assign each map a unique number from 1 to ${count}.`;
  }
  return null;
};

export const nextGameNumber = (existing: number[], format: ValorantFormat): number | null => {
  const used = new Set(existing);
  for (let n = 1; n <= mapsForFormat(format); n += 1) {
    if (!used.has(n)) return n;
  }
  return null;
};

export const joinRankingsWithBindings = (rankings: RankingEntry[], bindings: Binding[]) => {
  const bindingByValTeamId = new Map(bindings.map((b) => [b.valorantTeamUuid, b]));
  return rankings.map((entry) => ({
    ...entry,
    teamLabel: bindingByValTeamId.get(entry.teamId)?.savedTeam?.name
      ?? `VAL team ${entry.teamId.slice(0, 8)}`,
  }));
};

export const formatEloDelta = (before: string, after: string): string => {
  const delta = Number(after) - Number(before);
  if (delta === 0) return "±0";
  return delta > 0 ? `+${delta}` : `${delta}`;
};
```

Implement the remaining exports exactly as typed in "Interfaces Produced" (`formatRiotId` shown, plus `seriesStatusLabel`, `operationStatusLabel`, `ratingModeLabel`, `REQUIRES_REASON_RATING_MODES`, `mapsForFormat` as above). Use `export type` for all type exports so they erase at runtime — the module must load in vitest with zero runtime imports.

- [ ] **Step 4: Run the pure-helper tests to verify they pass**

Run: `npx vitest run tests/unit/valorant.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `lib/valorant-api.ts`**

Create `frontend/lib/valorant-api.ts`. Read `frontend/lib/auth.ts` first to confirm the `apiFetch` option key for JSON bodies (`json`), and read `frontend/lib/admin.ts` `adminRequest` signature. Every function:

```ts
import { adminRequest } from "./admin";
import { mapMatchSummary } from "./valorant";
import type { /* all types */ } from "./valorant";

export const valorantAdminRequest = async <T>(
  path: string,
  options?: Parameters<typeof adminRequest>[1]
): Promise<T> => {
  const envelope = await adminRequest<{ data: T }>(path, options);
  return envelope.data;
};

export const fetchValorantBindings = () =>
  valorantAdminRequest<{ bindings: Binding[] }>("/api/v1/admin/valorant/teams");

export const bindValorantTeam = (savedTeamId: string) =>
  valorantAdminRequest<{ binding: Binding }>("/api/v1/admin/valorant/teams/bind", {
    method: "POST",
    json: { savedTeamId },
  });

export const detachValorantBinding = (bindingId: string) =>
  valorantAdminRequest<{ binding: Binding }>(
    `/api/v1/admin/valorant/teams/${encodeURIComponent(bindingId)}/detach`,
    { method: "DELETE" }
  );

export const discoverValorant = (input: {
  playerA: RiotId; playerB: RiotId; pageSize?: number; maxPages?: number; map?: string; from?: string;
}) => valorantAdminRequest<DiscoverResponse>("/api/v1/admin/valorant/discover", { method: "POST", json: input });

export const importValorantMatch = (henrikMatchId: string, affinity = "eu") =>
  valorantAdminRequest<{ match: MatchDetail; created: boolean }>("/api/v1/admin/valorant/matches/import", {
    method: "POST",
    json: { henrikMatchId, affinity },
  });

export const fetchValorantMatchByHenrikId = (henrikMatchId: string) =>
  valorantAdminRequest<{ match: MatchDetail }>(
    `/api/v1/admin/valorant/matches/by-henrik-id/${encodeURIComponent(henrikMatchId)}`
  );

export const fetchValorantMatches = async (filters: { cursor?: string; limit?: number } = {}) => {
  const params = new URLSearchParams();
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit) params.set("limit", String(filters.limit));
  const suffix = params.toString() ? `?${params}` : "";
  const raw = await valorantAdminRequest<{
    items: Array<{
      id: string; henrik_match_id: string; affinity: string; platform: string; map_name: string;
      mode?: string | null; queue?: string | null; started_at: string; is_completed: boolean;
      red_score?: number | null; blue_score?: number | null; winning_side?: string | null;
    }>;
    next_cursor: string | null; total: number | null;
  }>(`/api/v1/admin/valorant/matches${suffix}`);
  return { items: raw.items.map(mapMatchSummary), nextCursor: raw.next_cursor, total: raw.total };
};

export const createValorantSeries = (input: {
  bindingTeamAId: string; bindingTeamBId: string; format: ValorantFormat; playedAt: string;
  ratingModePreference?: ValorantRatingMode | null; anchorPlayerA: RiotId; anchorPlayerB: RiotId;
}) => valorantAdminRequest<{ series: QuestValorantSeries }>("/api/v1/admin/valorant/series", { method: "POST", json: input });

export const fetchValorantSeriesList = () =>
  valorantAdminRequest<{ series: QuestValorantSeries[] }>("/api/v1/admin/valorant/series");

export const fetchValorantSeries = (seriesId: string) =>
  valorantAdminRequest<{ series: QuestValorantSeries }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}`
  );

export const deleteValorantSeries = (seriesId: string) =>
  valorantAdminRequest<{ success: boolean }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}`,
    { method: "DELETE" }
  );

export const attachValorantGame = (seriesId: string, input: { gameNumber: number; matchId: string; teamASide: ValorantSide }) =>
  valorantAdminRequest<{ game: SeriesGame }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}/games`,
    { method: "POST", json: input }
  );

export const setValorantGameOrder = (seriesId: string, games: Array<{ gameId: string; gameNumber: number }>) =>
  valorantAdminRequest<{ success: boolean }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}/games/order`,
    { method: "PUT", json: { games } }
  );

export const removeValorantGame = (seriesId: string, gameId: string) =>
  valorantAdminRequest<{ success: boolean }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}/games/${encodeURIComponent(gameId)}`,
    { method: "DELETE" }
  );

export const fetchValorantPreview = (seriesId: string) =>
  valorantAdminRequest<{ preview: SeriesPreview }>(
    `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}/preview`
  );

export const finalizeValorantSeries = (seriesId: string, input: {
  ratingMode: ValorantRatingMode; officialWinnerTeamId?: string | null; overrideReason?: string | null;
}) => valorantAdminRequest<{ result: FinalizeResult }>(
  `/api/v1/admin/valorant/series/${encodeURIComponent(seriesId)}/finalize`,
  { method: "POST", json: input }
);

export const fetchValorantRankings = () =>
  valorantAdminRequest<{ rankings: RankingEntry[] }>("/api/v1/admin/valorant/rankings");

export const fetchValorantRatingHistory = (teamId: string) =>
  valorantAdminRequest<{ events: RatingEvent[] }>(
    `/api/v1/admin/valorant/teams/${encodeURIComponent(teamId)}/rating-history`
  );

export const fetchValorantTeamSeries = (teamId: string) =>
  valorantAdminRequest<{ series: SeriesViewLite[] }>(
    `/api/v1/admin/valorant/teams/${encodeURIComponent(teamId)}/series`
  );

export const fetchValorantReconciliation = () =>
  valorantAdminRequest<{ report: ReconciliationReport }>("/api/v1/admin/valorant/reconciliation");
```

- [ ] **Step 6: Run the API-client tests to verify they pass**

Run: `npx vitest run tests/unit/valorant-api.test.ts`
Expected: PASS — `vi.mock("../../lib/admin")` intercepts `adminRequest`; the unwrap, body-shape, and match-library mapping assertions hold.

- [ ] **Step 7: Add the navigation group and widen the shell grid**

In `frontend/lib/admin.ts`, append to `adminNavigationGroups` (after the `Commerce` group):

```ts
{
  label: "VALORANT",
  links: [
    { href: "/admin/valorant", label: "Overview" },
    { href: "/admin/valorant/teams", label: "Team Bindings" },
    { href: "/admin/valorant/discover", label: "Discovery" },
    { href: "/admin/valorant/series", label: "Series" },
    { href: "/admin/valorant/rankings", label: "Rankings" },
    { href: "/admin/valorant/reconciliation", label: "Reconciliation" },
  ],
},
```

In `frontend/components/admin/AdminShell.tsx`, change the desktop nav grid from `xl:grid-cols-[0.65fr_1.6fr_1.35fr_1fr]` to `xl:grid-cols-[0.65fr_1.5fr_1.15fr_0.9fr_1fr]` so the 5th group lays out on one row.

- [ ] **Step 8: Implement the shared components and the hub page**

Create the shared presentational components:

`frontend/components/admin/valorant/ValorantStatusBadge.tsx` — `"use client"`; props `{ status: ValorantSeriesStatus | ValorantBindingStatus | ValorantOperationStatus; kind: "series" | "binding" | "operation" }`; renders a `<Badge>` with the exact labels from `seriesStatusLabel`/`operationStatusLabel` (binding: `active` → "Active", `detached` → "Detached") and tone classes (`draft`/`active` → `border-purple-300/20 bg-purple-400/10 text-purple-100`; `finalized`/`succeeded` → green; `failed` → red; `orphaned`/`detached`/`reconciliation_required`/`pending` → amber/slate; `in_flight` → slate with `animate-pulse`).

`frontend/components/admin/valorant/ValorantOperationBanner.tsx` — `"use client"`; props `{ operation: QuestValorantOperation | null; inFlight: boolean }`. Renders:
- `inFlight === true` → "Applying changes — do not refresh" (amber, `role="status"`).
- `operation?.status === "reconciliation_required"` → title "Finalization result unknown", body "The platform did not confirm the result. Use 'Re-check status' to read the current state. This action never retries automatically." with the operation `errorCode`/`fastapiRequestId` shown when present.
- `operation?.status === "failed"` → title "Last action failed", body `operation.errorCode` when present (the backend's §6.5-friendly mapping is the backend's job; this banner shows its output verbatim).
- otherwise renders `null`.

`frontend/components/admin/valorant/ValorantErrorAlert.tsx` — `"use client"`; props `{ title?: string; message: string; onRetry?: () => void }`; renders `role="alert"` Card with `title` (default "Something went wrong"), `message` verbatim, and a `Retry` `Button variant="ghost"` when `onRetry` is provided.

`frontend/components/admin/valorant/ValorantEmptyState.tsx` — `"use client"`; props `{ title?: string; description?: string; children?: ReactNode }`; renders the existing `EmptyState` component with defaults `title = "Nothing here yet"`, `description = "No VALORANT data to show yet."`.

`frontend/components/admin/valorant/ValorantLoadingState.tsx` — `"use client"`; renders `AdminTableSkeleton rows={4}`.

`frontend/components/admin/valorant/ValorantHub.tsx` — `"use client"`; uses `useValorantBindings()`, `useValorantSeriesList()`, `useValorantReconciliation()`. Renders `<AdminShell title="VALORANT" description="Run standalone VALORANT competitive series with Riot-sourced results and ELO ratings.">` and a responsive `grid gap-4 md:grid-cols-2 xl:grid-cols-3` of hub cards, each a `Link` inside a `Card`:

| href | Title | Count badge |
|---|---|---|
| `/admin/valorant/teams` | Team Bindings | `bindings.filter(status==='active').length` |
| `/admin/valorant/discover` | Match Discovery | — |
| `/admin/valorant/series` | Series | `series.length` (draft count subtitle) |
| `/admin/valorant/rankings` | Rankings | — |
| `/admin/valorant/reconciliation` | Reconciliation | `stuckOperations.length` when > 0, amber badge |

Each card shows a one-line description with the existing `Link` styling from `AdminShell`. Loading: three `ValorantLoadingState` cards. Empty: counts render `0` (the hub always shows the five cards).

Create `frontend/app/admin/valorant/page.tsx`:

```tsx
import ValorantHub from "@/components/admin/valorant/ValorantHub";
export default function ValorantPage() { return <ValorantHub />; }
```

- [ ] **Step 9: Run the full frontend unit suite and typecheck**

```bash
npm test
npm run typecheck
```

Expected: `npm test` PASS (existing suites + the three new files). `npm run typecheck` PASS (strict; all new types are exported, `noUnusedLocals` clean).

- [ ] **Step 10: Commit**

```bash
git add frontend/lib/admin.ts frontend/components/admin/AdminShell.tsx frontend/lib/valorant.ts frontend/lib/valorant-api.ts frontend/hooks/api/useValorant.ts frontend/app/admin/valorant/page.tsx frontend/components/admin/valorant frontend/tests/unit/valorant.test.ts frontend/tests/unit/valorant-api.test.ts frontend/tests/unit/valorant-components.test.ts
git commit -m "feat(valorant): add VALORANT admin navigation, lib foundation, and overview hub"
```

---

### Task 2: Team binding selection from SavedTeams

**Files:**
- Modify: `frontend/hooks/api/useValorant.ts` (add `useValorantBindings`)
- Create: `frontend/components/admin/valorant/ValorantTeamsManager.tsx`, `ValorantBindingForm.tsx`
- Create: `frontend/app/admin/valorant/teams/page.tsx`
- Extend: `frontend/tests/unit/valorant-api.test.ts` (detach shape), `frontend/tests/unit/valorant-components.test.ts` (bind/detach source guards)

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/valorant-api.test.ts`:

```ts
it("sends the detach DELETE for a binding and never calls a delete on VALORANT data", async () => {
  mockedRequest.mockResolvedValueOnce(unwrap({ binding: { id: "b-1", status: "detached" } }));
  const { detachValorantBinding } = await import("../../lib/valorant-api");
  await detachValorantBinding("b-1");
  expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/teams/b-1/detach", { method: "DELETE" });
});
```

Append to `frontend/tests/unit/valorant-components.test.ts`:

```ts
it("bind form selects SavedTeams and detach copy never implies deleting VALORANT history", () => {
  const teamsManager = read("components/admin/valorant/ValorantTeamsManager.tsx");
  const bindingForm = read("components/admin/valorant/ValorantBindingForm.tsx");
  expect(bindingForm).toContain("fetchProfileTeams");
  expect(bindingForm).toContain('label="Saved team to bind"');
  expect(bindingForm).toContain("Bind to VALORANT");
  expect(teamsManager).toContain("Detach binding");
  expect(teamsManager).toContain("Detaching never deletes VALORANT teams, series, or rating history.");
  expect(teamsManager).not.toContain("Re-activate");
});

it("shows loading, empty, and error states on the teams screen", () => {
  const manager = read("components/admin/valorant/ValorantTeamsManager.tsx");
  expect(manager).toContain("AdminTableSkeleton");
  expect(manager).toContain("EmptyState");
  expect(manager).toContain('role="alert"');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/valorant-api.test.ts tests/unit/valorant-components.test.ts`
Expected: FAIL — the component files do not exist (and `detachValorantBinding` is missing from `lib/valorant-api.ts` if Task 1 Step 5 was not fully applied).

- [ ] **Step 3: Implement `useValorantBindings`**

In `frontend/hooks/api/useValorant.ts`:

```ts
"use client";

import { useApiQuery } from "@/hooks/api/useApiQuery";
import { fetchValorantBindings } from "@/lib/valorant-api";

export function useValorantBindings() {
  return useApiQuery(["valorant-bindings"], fetchValorantBindings);
}
```

(Other hooks are added in Tasks 3, 5, 6, 7, 8 — add `useValorantSeriesList`, `useValorantSeriesDetail`, `useValorantPreview`, `useValorantMatches`, `useValorantRankings`, `useValorantRatingHistory`, `useValorantTeamSeries`, `useValorantReconciliation` in those tasks with the same `useApiQuery(["valorant-..."], fn)` pattern.)

- [ ] **Step 4: Implement the teams manager and bind form**

`frontend/components/admin/valorant/ValorantBindingForm.tsx` — `"use client"`. Props `{ teams: SavedTeam[]; bindings: Binding[]; onBound: () => Promise<void> }`. Behavior:
- Compute `bindableTeams = teams.filter((t) => !bindings.some((b) => b.savedTeamId === t.id && b.status === "active"))`.
- Render a `Card` with `<h3>Bind a SavedTeam</h3>`, a `<label>` "Saved team to bind" containing a native `<select>` (via `components/ui/select.tsx`) listing `bindableTeams` (`<option value={t.id}>{t.name}{t.teamTag ? ` (${t.teamTag})` : ""}</option>`), and a `disabled` state when `bindableTeams.length === 0` ("All of your SavedTeams are already bound.").
- On submit: `setSubmitting(true)`; `bindValorantTeam(selectedTeamId)`; on success `showToast({ title: "Team bound", tone: "success" })` then `onBound()`; on failure set local error (rendered via `ValorantErrorAlert`) and `showToast({ title: error.message, tone: "error" })`; finally `setSubmitting(false)`.
- Submit button label exactly `Bind to VALORANT`; disabled while `submitting || !selectedTeamId`.

`frontend/components/admin/valorant/ValorantTeamsManager.tsx` — `"use client"`. Uses `useValorantBindings()` and `useTeams()` (existing `frontend/hooks/api/useTeams.ts`). Renders `<AdminShell title="Team Bindings" description="Link Quest SavedTeams to VALORANT platform teams. One active binding per team; detaching never deletes VALORANT data.">` containing:
- `ValorantBindingForm` (shown when `bindings` and `teams` have loaded).
- A responsive list (`grid gap-4 lg:grid-cols-2`) of binding `Card`s: SavedTeam name (or "Detached team" when `savedTeamId === null`), `teamTag`, `ValorantStatusBadge kind="binding"`, `valorantTeamUuid` truncated with `title` attribute, `boundByUser?.username`, `boundAt` via `formatAdminCompactDateTime`, and for `active` bindings a `Detach binding` `Button variant="ghost"` that opens a confirm state: button label switches to "Confirm detach?" on first click; second click calls `detachValorantBinding(binding.id)` then `refetch()`. Helper text under the list: "Detaching never deletes VALORANT teams, series, or rating history."
- Loading → `ValorantLoadingState`. `bindings.length === 0 && teams loaded` → `ValorantEmptyState title="No bindings yet" description="Bind a SavedTeam to start running VALORANT series."`. Any list error → `ValorantErrorAlert message={error}` with `onRetry={refetch}`.

Create `frontend/app/admin/valorant/teams/page.tsx` (thin, mirrors `app/admin/games/page.tsx`).

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/unit/valorant-api.test.ts tests/unit/valorant-components.test.ts && npm run typecheck`
Expected: PASS — detach request shape matches, source guards find the required strings, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/hooks/api/useValorant.ts frontend/components/admin/valorant/ValorantTeamsManager.tsx frontend/components/admin/valorant/ValorantBindingForm.tsx frontend/app/admin/valorant/teams/page.tsx frontend/tests/unit/valorant-api.test.ts frontend/tests/unit/valorant-components.test.ts
git commit -m "feat(valorant): add SavedTeam binding selection, bind, and Quest-local detach"
```

---

### Task 3: Riot-ID two-player discovery, candidate review, explicit import

**Files:**
- Create: `frontend/components/admin/valorant/ValorantDiscoveryManager.tsx`, `ValorantDiscoveryForm.tsx`, `ValorantCandidateList.tsx`, `ValorantCandidateReview.tsx`
- Create: `frontend/app/admin/valorant/discover/page.tsx`
- Extend: `frontend/tests/unit/valorant-components.test.ts` (candidate-list and explicit-import guards), `frontend/tests/unit/valorant.test.ts` (candidate type has no `winningSide`/roster)

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/valorant.test.ts` (type-level runtime check is impossible — the types erase — so assert the source between the type declarations):

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

it("keeps the lightweight candidate type free of winningSide and roster", () => {
  const source = readFileSync(resolve(process.cwd(), "lib/valorant.ts"), "utf8");
  const candidateType = source.slice(source.indexOf("export type MatchCandidate"), source.indexOf("export type MatchPlayer"));
  expect(candidateType).not.toContain("winningSide");
  expect(candidateType).not.toContain("roster");
  expect(candidateType).toContain("alreadyImported");
});
```

Append to `frontend/tests/unit/valorant-components.test.ts`:

```ts
it("candidate list shows only the lightweight fields and never auto-imports", () => {
  const list = read("components/admin/valorant/ValorantCandidateList.tsx");
  expect(list).not.toContain("winningSide");
  expect(list).not.toContain("roster");
  for (const field of ["henrikMatchId", "map", "startedAt", "mode", "queue", "redScore", "blueScore", "alreadyImported"]) {
    expect(list).toContain(field);
  }
});

it("candidate review requires an explicit import click and shows detail + created state", () => {
  const review = read("components/admin/valorant/ValorantCandidateReview.tsx");
  expect(review).toContain("Import this match");
  expect(review).toContain("onClick");
  expect(review).toContain("importValorantMatch");
  expect(review).toContain("already imported");
  expect(review).toContain("winningSide");
  expect(review).toContain("players");
});

it("discovery form validates Riot IDs locally before submitting", () => {
  const form = read("components/admin/valorant/ValorantDiscoveryForm.tsx");
  expect(form).toContain('placeholder="Name#Tag"');
  expect(form).toContain("parseRiotIdInput");
  expect(form).toContain('aria-label="Player A Riot ID"');
  expect(form).toContain('aria-label="Player B Riot ID"');
});

it("no-overlap is an empty state, not an error", () => {
  const manager = read("components/admin/valorant/ValorantDiscoveryManager.tsx");
  expect(manager).toContain("No matches found for these two players");
  expect(manager).toContain("candidates.length");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/valorant.test.ts tests/unit/valorant-components.test.ts`
Expected: FAIL — the candidate-type guard fails (the type block is missing) and the four component files do not exist.

- [ ] **Step 3: Implement the discovery flow**

`frontend/components/admin/valorant/ValorantDiscoveryForm.tsx` — `"use client"`. Props `{ onSearch: (input: { playerA: RiotId; playerB: RiotId; pageSize: number; maxPages: number; map?: string; from?: string }) => Promise<void>; loading: boolean }`. State: `playerAInput`, `playerBInput`, `map`, `from` (date input). Local validation via `parseRiotIdInput` on submit; invalid → inline error "Enter both Riot IDs as Name#Tag." and no network call. Inputs:
- `<Input aria-label="Player A Riot ID" placeholder="Name#Tag" />` (e.g. `TenZ#SEN`)
- `<Input aria-label="Player B Riot ID" placeholder="Name#Tag" />`
- optional map `<Input aria-label="Map filter (optional)" placeholder="Ascent" />`
- optional from `<Input aria-label="From date (optional)" type="date" />`
- Submit `Button` label `Search matches`, `disabled={loading}`; while loading label `Searching…`.
- Defaults: `pageSize = 10`, `maxPages = 1` (fixed per spec §5.2 bounds), sent in the body.

`frontend/components/admin/valorant/ValorantCandidateList.tsx` — `"use client"`. Props `{ candidates: MatchCandidate[]; onSelect: (candidate: MatchCandidate) => void }`. Renders an accessible table (`<table>`, `<thead>`, `<th scope="col">`) with columns: Match ID (`henrikMatchId`, truncated with `title`), Map (`map`), Started (`startedAt` via `formatAdminCompactDateTime`), Mode/Queue (`mode` + `queue`), Score (`redScore`–`blueScore`, `aria-label="Red score vs Blue score"`), Imported (`Badge` "Imported" when `alreadyImported`, else "New"), and an action cell with `Review` `Button`. No `winningSide`, no roster, no `players` — only the pinned `MatchCandidate` fields.

`frontend/components/admin/valorant/ValorantCandidateReview.tsx` — `"use client"`. Props `{ candidate: MatchCandidate | null; onClose: () => void; onImported: (detail: MatchDetail, created: boolean) => void }`. When `candidate === null` renders `null`. Behavior (two-stage §5.2/D11):
- On open: if `candidate.alreadyImported` → `fetchValorantMatchByHenrikId(candidate.henrikMatchId)` and show detail; else show a loading card with only the summary (no detail fetched) and a primary `Button` labeled `Import this match`.
- Clicking `Import this match` calls `importValorantMatch(candidate.henrikMatchId)` (explicit action, inside `onClick`), then shows the returned `MatchDetail` with a `Badge` reading exactly `Imported` when `created === true` or `Already imported` when `created === false` (informational — never an error; §5.2).
- Detail render: `mapName`, `startedAt`, `winningSide` ("Winning side: Red/Blue"), `redScore`–`blueScore`, and a `players` table (`name#tag`, `side`, `agentName`, `kills`, `deaths`) with `aria-label="Match roster"`. A "Close" button and an "Import another match" note.
- Loading/error inside the modal: `ValorantLoadingState`; `ValorantErrorAlert` with a `Retry` that re-runs the current step (never auto-retries).

`frontend/components/admin/valorant/ValorantDiscoveryManager.tsx` — `"use client"`. Orchestrates: `ValorantDiscoveryForm` → on response store `players` + `candidates`; render `ResolvedPlayer` summary ("Player A: TenZ#SEN (eu)" / "Player B: Demon1#NA (eu)") when present; `ValorantCandidateList`; selected candidate opens `ValorantCandidateReview` (modal overlay `role="dialog"` + `aria-modal="true"`). Empty result → `ValorantEmptyState title="No matches found for these two players" description="Try different Riot IDs, filters, or a wider date range."`. Error → `ValorantErrorAlert` with retry. Imported confirmation strip: "Match imported — you can attach it from the Series screen." (no auto-attach; the manager never calls any series/games endpoint).

Create `frontend/app/admin/valorant/discover/page.tsx` (thin).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/valorant.test.ts tests/unit/valorant-components.test.ts && npm run typecheck`
Expected: PASS — type guard, component guards, and typecheck all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/admin/valorant/ValorantDiscoveryManager.tsx frontend/components/admin/valorant/ValorantDiscoveryForm.tsx frontend/components/admin/valorant/ValorantCandidateList.tsx frontend/components/admin/valorant/ValorantCandidateReview.tsx frontend/app/admin/valorant/discover/page.tsx frontend/tests/unit/valorant.test.ts frontend/tests/unit/valorant-components.test.ts
git commit -m "feat(valorant): add two-player discovery with explicit candidate review and import"
```

---

### Task 4: Standalone BO1/BO3/BO5 series creation

**Files:**
- Extend: `frontend/hooks/api/useValorant.ts` (`useValorantSeriesList`)
- Create: `frontend/components/admin/valorant/ValorantSeriesManager.tsx`, `ValorantSeriesForm.tsx`
- Create: `frontend/app/admin/valorant/series/page.tsx`, `frontend/app/admin/valorant/series/new/page.tsx`
- Extend: `frontend/tests/unit/valorant-api.test.ts` (create-series body shape), `frontend/tests/unit/valorant-components.test.ts` (create-form guards)

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/valorant-api.test.ts`:

```ts
it("sends the exact series-create body with anchors and preference", async () => {
  mockedRequest.mockResolvedValueOnce(unwrap({ series: { id: "quest-series-1" } }));
  const { createValorantSeries } = await import("../../lib/valorant-api");
  await createValorantSeries({
    bindingTeamAId: "binding-a",
    bindingTeamBId: "binding-b",
    format: "bo3",
    playedAt: "2026-08-02T18:00:00.000Z",
    ratingModePreference: "normal",
    anchorPlayerA: { name: "TenZ", tag: "SEN" },
    anchorPlayerB: { name: "Demon1", tag: "NA" },
  });
  expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/series", {
    method: "POST",
    json: {
      bindingTeamAId: "binding-a",
      bindingTeamBId: "binding-b",
      format: "bo3",
      playedAt: "2026-08-02T18:00:00.000Z",
      ratingModePreference: "normal",
      anchorPlayerA: { name: "TenZ", tag: "SEN" },
      anchorPlayerB: { name: "Demon1", tag: "NA" },
    },
  });
});
```

Append to `frontend/tests/unit/valorant-components.test.ts`:

```ts
it("series create form covers BO1/BO3/BO5, playedAt, Rated/Unrated preference, and both anchors", () => {
  const form = read("components/admin/valorant/ValorantSeriesForm.tsx");
  for (const value of ["bo1", "bo3", "bo5"]) expect(form).toContain(value);
  expect(form).toContain('type="datetime-local"');
  expect(form).toContain("ratingModePreference");
  expect(form).toContain('value="normal"');
  expect(form).toContain('value="unrated"');
  expect(form).toContain("Anchor player A");
  expect(form).toContain("Anchor player B");
  expect(form).toContain("parseRiotIdInput");
  expect(form).toContain("Both teams must have an active VALORANT binding");
});

it("series list shows status, format, teams, and links to create", () => {
  const manager = read("components/admin/valorant/ValorantSeriesManager.tsx");
  expect(manager).toContain("New series");
  expect(manager).toContain("ValorantStatusBadge");
  expect(manager).toContain("/admin/valorant/series/new");
  expect(manager).toContain("formatAdminCompactDateTime");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/valorant-api.test.ts tests/unit/valorant-components.test.ts`
Expected: FAIL — the component files do not exist (the create-body test should already pass from Task 1 if `createValorantSeries` was implemented; if not, it fails on `createValorantSeries is not a function`).

- [ ] **Step 3: Implement the series list and create form**

`frontend/hooks/api/useValorant.ts` — add:

```ts
export function useValorantSeriesList() {
  return useApiQuery(["valorant-series-list"], fetchValorantSeriesList);
}
```

`frontend/components/admin/valorant/ValorantSeriesManager.tsx` — `"use client"`. Uses `useValorantSeriesList()`. `<AdminShell title="VALORANT Series" description="Create standalone BO1/BO3/BO5 draft series and manage their games.">` with an `actions` prop containing a `Link href="/admin/valorant/series/new"` styled as `Button` labeled `New series`. Body: responsive list/table (`overflow-x-auto`) of series rows: format (uppercased), `playedAt` via `formatAdminCompactDateTime`, Team A SavedTeam name, Team B SavedTeam name, games count (`games.length / mapsForFormat(format)`), `ValorantStatusBadge kind="series"`, `ratingModePreference` via `ratingModeLabel` when set, and a `View` `Button` linking to `/admin/valorant/series/{id}`. Loading/empty/error states as in Task 2.

`frontend/components/admin/valorant/ValorantSeriesForm.tsx` — `"use client"`. Uses `useValorantBindings()` and `useRouter()`. Fields (react `useState`, plain inputs — no form library, matching `AdminGamesManager` style):
- Team A: `<select aria-label="Team A binding">` over `active` bindings (option label = savedTeam name + tag; value = binding id). Team B likewise (`aria-label="Team B binding"`), excluding the Team A selection; the two selections must differ (guard text: "Both teams must have an active VALORANT binding" and "Team A and Team B must be different teams.").
- Format: three radio inputs (`name="format"`, values `bo1|bo3|bo5`).
- `playedAt`: `<Input type="datetime-local" aria-label="Played at" />` defaulting to now (converted with `sriLankaDateTimeLocalToIso` from `@/lib/date-time` on submit, mirroring `admin.ts`).
- Rating preference: radio group `ratingModePreference` with `value="normal"` label "Rated — applies ELO and counts toward standings" and `value="unrated"` label "Unrated — result recorded, no ELO, no counters". Helper text: "The final decision happens at finalization."
- Anchor player A / B: two `<Input aria-label="Anchor player A Riot ID" placeholder="Name#Tag" />` / B, validated with `parseRiotIdInput`.
- Submit: `createValorantSeries({ bindingTeamAId, bindingTeamBId, format, playedAt: iso, ratingModePreference, anchorPlayerA, anchorPlayerB })`; on success `showToast({ title: "Draft series created", tone: "success" })` and `router.push(`/admin/valorant/series/${series.id}`)`; on error local `ValorantErrorAlert` + error toast. Submit label `Create draft series`, `disabled` while submitting or when either binding or an anchor is invalid.

Create `frontend/app/admin/valorant/series/page.tsx` and `frontend/app/admin/valorant/series/new/page.tsx` (thin).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/valorant-api.test.ts tests/unit/valorant-components.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/api/useValorant.ts frontend/components/admin/valorant/ValorantSeriesManager.tsx frontend/components/admin/valorant/ValorantSeriesForm.tsx frontend/app/admin/valorant/series/page.tsx frontend/app/admin/valorant/series/new/page.tsx frontend/tests/unit/valorant-api.test.ts frontend/tests/unit/valorant-components.test.ts
git commit -m "feat(valorant): add standalone draft series creation with anchors and rating preference"
```

---

### Task 5: Series detail — attach, remove, absolute reorder, side mapping

**Files:**
- Extend: `frontend/hooks/api/useValorant.ts` (`useValorantSeriesDetail`, `useValorantPreview`, `useValorantMatches`)
- Create: `frontend/components/admin/valorant/ValorantSeriesDetail.tsx`, `ValorantGameRow.tsx`, `ValorantMatchLibrary.tsx`, `ValorantAttachGameDialog.tsx`, `ValorantSideBadges.tsx`, `ValorantReorderControl.tsx`, `ValorantPreviewPanel.tsx`
- Create: `frontend/app/admin/valorant/series/[id]/page.tsx`
- Extend: `frontend/tests/unit/valorant-api.test.ts` (attach/order/remove/delete shapes), `frontend/tests/unit/valorant-components.test.ts` (attach/side/reorder guards)

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/valorant-api.test.ts`:

```ts
it("sends attach, order, remove, and delete with the exact shapes", async () => {
  mockedRequest.mockResolvedValueOnce(unwrap({ game: { id: "game-1", teamASide: "red", teamBSide: "blue" } }));
  const { attachValorantGame, setValorantGameOrder, removeValorantGame, deleteValorantSeries } = await import("../../lib/valorant-api");
  await attachValorantGame("quest-series-1", { gameNumber: 2, matchId: "val-match-1", teamASide: "blue" });
  expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/series/quest-series-1/games", {
    method: "POST", json: { gameNumber: 2, matchId: "val-match-1", teamASide: "blue" },
  });

  mockedRequest.mockResolvedValueOnce(unwrap({ success: true }));
  await setValorantGameOrder("quest-series-1", [{ gameId: "g2", gameNumber: 1 }, { gameId: "g1", gameNumber: 2 }]);
  expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/series/quest-series-1/games/order", {
    method: "PUT", json: { games: [{ gameId: "g2", gameNumber: 1 }, { gameId: "g1", gameNumber: 2 }] },
  });

  mockedRequest.mockResolvedValueOnce(unwrap({ success: true }));
  await removeValorantGame("quest-series-1", "game-1");
  expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/series/quest-series-1/games/game-1", { method: "DELETE" });

  mockedRequest.mockResolvedValueOnce(unwrap({ success: true }));
  await deleteValorantSeries("quest-series-1");
  expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/series/quest-series-1", { method: "DELETE" });
});
```

Append to `frontend/tests/unit/valorant-components.test.ts`:

```ts
it("attach dialog sends a VAL match UUID and a Team A side radio, and derives Team B from the platform", () => {
  const dialog = read("components/admin/valorant/ValorantAttachGameDialog.tsx");
  expect(dialog).toContain('name="teamASide"');
  expect(dialog).toContain('value="red"');
  expect(dialog).toContain('value="blue"');
  expect(dialog).toContain("Team A side");
  expect(dialog).toContain("matchId");
  expect(dialog).toContain("nextGameNumber");
  expect(dialog).toContain("The platform derives Team B side and scores — scores are never re-entered.");
});

it("reorder control submits the full absolute desired order and validates a permutation", () => {
  const control = read("components/admin/valorant/ValorantReorderControl.tsx");
  expect(control).toContain("validateDesiredOrder");
  expect(control).toContain("Save order");
  expect(control).toContain("setValorantGameOrder");
  expect(control).toContain('aria-label="Map number');
});

it("game rows show side mapping badges and a draft-only remove", () => {
  const row = read("components/admin/valorant/ValorantGameRow.tsx");
  const badges = read("components/admin/valorant/ValorantSideBadges.tsx");
  expect(badges).toContain("Team A");
  expect(badges).toContain("Team B");
  expect(badges).toContain("Red");
  expect(badges).toContain("Blue");
  expect(row).toContain("Remove");
  expect(row).toContain("removeValorantGame");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/valorant-api.test.ts tests/unit/valorant-components.test.ts`
Expected: FAIL — the detail components do not exist.

- [ ] **Step 3: Implement the hooks**

In `frontend/hooks/api/useValorant.ts`:

```ts
export function useValorantSeriesDetail(seriesId: string) {
  return useApiQuery(["valorant-series", seriesId], () => fetchValorantSeries(seriesId), {
    enabled: Boolean(seriesId),
  });
}

export function useValorantPreview(seriesId: string, enabled: boolean) {
  return useApiQuery(["valorant-preview", seriesId], () => fetchValorantPreview(seriesId), {
    enabled: enabled && Boolean(seriesId),
  });
}

export function useValorantMatches(cursor: string | null, enabled: boolean) {
  return useApiQuery(["valorant-matches", cursor ?? ""], () => fetchValorantMatches({ cursor: cursor ?? undefined, limit: 20 }), {
    enabled,
  });
}
```

- [ ] **Step 4: Implement the detail components**

`frontend/components/admin/valorant/ValorantSideBadges.tsx` — `"use client"`; props `{ teamASide: ValorantSide; teamBSide: ValorantSide }`. Renders two `Badge`s: `Team A: Red` / `Team B: Blue` (labels exactly `Red`/`Blue`, capitalized from the side literal).

`frontend/components/admin/valorant/ValorantGameRow.tsx` — `"use client"`; props `{ game: SeriesGame; teamALabel: string; teamBLabel: string; removable: boolean; onRemove: () => void; removing: boolean }`. Renders a `Card` row: `Game {gameNumber}`, `game.mapName`, `ValorantSideBadges`, truncated `matchId` with `title`, and when `removable` a `Remove` `Button variant="ghost"` (disabled while `removing`, label `Removing…`). Confirmation pattern: first click sets `confirming` (label `Confirm remove?`), second click fires `onRemove`.

`frontend/components/admin/valorant/ValorantMatchLibrary.tsx` — `"use client"`; props `{ onPick: (match: ValorantMatchSummary) => void }`. Uses `useValorantMatches(cursor, true)`; renders a `Card` with a `Load more` button that advances `cursor` to `nextCursor` (keyset pagination per `MatchListResponse`); each row: `mapName`, `startedAt` via `formatAdminCompactDateTime`, `redScore`–`blueScore`, `winningSide` badge, and an `Attach` `Button` (label `Attach`) that calls `onPick(match)`. Empty → `ValorantEmptyState title="No imported matches" description="Import a match from Discovery first."`.

`frontend/components/admin/valorant/ValorantAttachGameDialog.tsx` — `"use client"`; props `{ seriesId: string; match: ValorantMatchSummary | null; existingNumbers: number[]; format: ValorantFormat; onClose: () => void; onAttached: () => Promise<void> }`. When `match === null` renders `null`. Renders `role="dialog"` + `aria-modal="true"` overlay: match summary, `<Input type="number" aria-label="Game number" min="1" max={mapsForFormat(format)}>` prefilled with `nextGameNumber(existingNumbers, format)`, a radio group `name="teamASide"` with `value="red"` label `Team A side: Red` and `value="blue"` label `Team A side: Blue`, helper text exactly `The platform derives Team B side and scores — scores are never re-entered.`, and `Attach map` `Button` calling `attachValorantGame(seriesId, { gameNumber, matchId: match.matchId, teamASide })` then `onAttached()` and `onClose()`. Errors → `ValorantErrorAlert` (e.g. backend's "This match is already used in another series" surfaces verbatim).

`frontend/components/admin/valorant/ValorantReorderControl.tsx` — `"use client"`; props `{ games: SeriesGame[]; onReorder: (order: Array<{ gameId: string; gameNumber: number }>) => Promise<void> }`. State: `numbers: Record<string, number>` initialized from `games` (`game.gameNumber`). Renders one `<select aria-label={`Map number for game ${game.gameNumber}`}>` per game with options `1..games.length`; a `Save order` `Button` (disabled while submitting) that builds `numbers` in the current row order, runs `validateDesiredOrder(Object.values(numbers), games.length)`; on invalid shows the returned string inline (`<p role="alert">`); on valid calls `onReorder(games.map((g) => ({ gameId: g.id, gameNumber: numbers[g.id] })))`. Submitting label `Saving order…`. Note in a `<p>`: "Order is saved as the full desired map order — retrying the same order is safe." (absolute desired-order semantics, delta D9).

`frontend/components/admin/valorant/ValorantPreviewPanel.tsx` — `"use client"`; props `{ preview: SeriesPreview | null; loading: boolean; error: string; anchors: { playerA: RiotId; playerB: RiotId } }`. Renders a `Card` "Preview": when `loading` → `ValorantLoadingState`; when `preview?.valid` → green `Badge` "Ready to finalize" plus `teamAMapsWon`–`teamBMapsWon`, `calculatedWinnerId` mapped to the winning team label, per-game winners from `preview.games` (`mapName`, `winnerTeamId`), and an anchor strip "Anchors: TenZ#SEN vs Demon1#NA". When `!preview?.valid` → amber `Badge` "Not ready" + `preview.errors` list (`<ul role="list">`). When `error` → `ValorantErrorAlert` with retry via the parent.

`frontend/components/admin/valorant/ValorantSeriesDetail.tsx` — `"use client"`; receives `seriesId` from the page (`useParams`). Uses `useValorantSeriesDetail(seriesId)`, `useValorantPreview(seriesId, Boolean(series?.valorantSeriesUuid))`. Sections:
- `AdminShell title={`${series.format.toUpperCase()} series`} description={teams + playedAt + anchors}` with `ValorantStatusBadge kind="series"` and, for `draft`, a `Delete draft series` `Button` (two-click confirm, copy "Delete this draft series? Finalized history is never affected.") calling `deleteValorantSeries` then `router.push("/admin/valorant/series")`.
- `ValorantOperationBanner operation={series.lastOperation} inFlight={mutationBusy}`.
- Games section: `ValorantGameRow` per `series.games` (sorted by `gameNumber`), each with `onRemove` → `removeValorantGame(seriesId, game.id)` then `refetch()`. For drafts, `ValorantReorderControl` above the rows and `Attach map` `Button` that opens `ValorantMatchLibrary` → `ValorantAttachGameDialog`.
- `ValorantPreviewPanel` (draft only; for `finalized` show a committed-result `Card` instead: `ratingMode` via `ratingModeLabel`, `finalizedById`, `valorantSeriesUuid`).
- A `Re-check status` `Button` (shown only when `series.status === "reconciliation_required"` or the operation banner reports an unknown finalize outcome) that calls `refetch()` on the detail hook and the preview hook — reads only, no writes (Global Constraint 5).
- Loading/error/empty per the established pattern.

Create `frontend/app/admin/valorant/series/[id]/page.tsx`:

```tsx
import ValorantSeriesDetail from "@/components/admin/valorant/ValorantSeriesDetail";
export default function ValorantSeriesDetailPage() { return <ValorantSeriesDetail />; }
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/unit/valorant-api.test.ts tests/unit/valorant-components.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/hooks/api/useValorant.ts frontend/components/admin/valorant/ValorantSeriesDetail.tsx frontend/components/admin/valorant/ValorantGameRow.tsx frontend/components/admin/valorant/ValorantMatchLibrary.tsx frontend/components/admin/valorant/ValorantAttachGameDialog.tsx frontend/components/admin/valorant/ValorantSideBadges.tsx frontend/components/admin/valorant/ValorantReorderControl.tsx frontend/components/admin/valorant/ValorantPreviewPanel.tsx frontend/app/admin/valorant/series/[id]/page.tsx frontend/tests/unit/valorant-api.test.ts frontend/tests/unit/valorant-components.test.ts
git commit -m "feat(valorant): add series detail with attach, remove, absolute reorder, and side mapping"
```

---

### Task 6: Preview and finalize — Rated/Unrated, forfeit, override, and outcome handling

**Files:**
- Create: `frontend/components/admin/valorant/ValorantFinalizeForm.tsx`
- Modify: `frontend/components/admin/valorant/ValorantSeriesDetail.tsx` (render `ValorantFinalizeForm` for drafts; committed-result card for finalized; outcome handling wiring)
- Extend: `frontend/tests/unit/valorant.test.ts` (reason-mode logic + labels), `frontend/tests/unit/valorant-api.test.ts` (override body), `frontend/tests/unit/valorant-components.test.ts` (finalize form guards)

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/valorant.test.ts`:

```ts
it("labels every rating mode for the finalize UX", () => {
  expect(ratingModeLabel("normal")).toBe("Rated");
  expect(ratingModeLabel("unrated")).toBe("Unrated");
  expect(ratingModeLabel("forfeit_no_rating")).toBe("Forfeit — no rating");
  expect(ratingModeLabel("forfeit_result_only")).toBe("Forfeit — result only");
  expect(ratingModeLabel("manual_override")).toBe("Manual override");
  expect(ratingModeLabel(null)).toBe("Not set");
});
```

Append to `frontend/tests/unit/valorant-api.test.ts`:

```ts
it("sends a manual-override body with winner and reason", async () => {
  mockedRequest.mockResolvedValueOnce(unwrap({ result: { seriesId: "s-1", status: "finalized", operationId: "op-2" } }));
  const { finalizeValorantSeries } = await import("../../lib/valorant-api");
  await finalizeValorantSeries("s-1", { ratingMode: "manual_override", officialWinnerTeamId: "val-team-1", overrideReason: "Anchor mismatch override" });
  expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/series/s-1/finalize", {
    method: "POST",
    json: { ratingMode: "manual_override", officialWinnerTeamId: "val-team-1", overrideReason: "Anchor mismatch override" },
  });
});
```

Append to `frontend/tests/unit/valorant-components.test.ts`:

```ts
it("finalize form exposes all five modes and requires a reason for the three override/forfeit modes", () => {
  const form = read("components/admin/valorant/ValorantFinalizeForm.tsx");
  for (const mode of ["normal", "unrated", "forfeit_no_rating", "forfeit_result_only", "manual_override"]) {
    expect(form).toContain(`value="${mode}"`);
  }
  expect(form).toContain("REQUIRES_REASON_RATING_MODES");
  expect(form).toContain("Reason for this policy (required)");
  expect(form).toContain("reason");
  expect(form).toContain("Finalize series");
  expect(form).toContain("This action cannot be retried automatically");
});

it("finalize outcome handling surfaces anchor mismatch, backdate, and unknown-result states", () => {
  const detail = read("components/admin/valorant/ValorantSeriesDetail.tsx");
  expect(detail).toContain("Re-check status");
  expect(detail).toContain("SERIES_ALREADY_FINALIZED");
  expect(detail).toContain("ANCHOR_MISMATCH");
  expect(detail).toContain("BACKDATED_SERIES_REJECTED");
  expect(detail).toContain("never retries automatically");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/valorant.test.ts tests/unit/valorant-api.test.ts tests/unit/valorant-components.test.ts`
Expected: FAIL — `ValorantFinalizeForm.tsx` and the outcome handling in `ValorantSeriesDetail.tsx` do not exist yet.

- [ ] **Step 3: Implement the finalize form**

`frontend/components/admin/valorant/ValorantFinalizeForm.tsx` — `"use client"`. Props `{ seriesId: string; teamALabel: string; teamBLabel: string; calculatedWinnerId: string | null; onFinalized: (result: FinalizeResult) => Promise<void> }`. State: `ratingMode` (default `"normal"`), `officialWinnerTeamId: string | null`, `overrideReason`, `submitting`, `error`.
- Mode group (radio, `name="ratingMode"`) — five options with labels from `ratingModeLabel` and helper copy:
  - `normal` → "Rated — applies ELO and standings counters."
  - `unrated` → "Unrated — result recorded, no ELO, no counters."
  - `forfeit_result_only` → "Forfeit — result only — official result counts, no ELO."
  - `forfeit_no_rating` → "Forfeit — no rating — result recorded, nothing counts."
  - `manual_override` → "Manual override — ELO applied to the official winner you choose."
- Official winner `<select aria-label="Official winner">`: default option `value=""` `Calculated winner (auto)` (sends `null`); plus one option per team label. When the chosen team differs from `calculatedWinnerId` **and** mode is `normal`, the form auto-switches `ratingMode` to `manual_override` (with a note "You chose a different official winner — this is a manual override.").
- When `REQUIRES_REASON_RATING_MODES.has(ratingMode)`: show `<Textarea aria-label="Reason for this policy (required)" placeholder="Required for this rating policy" />`; the `Finalize series` `Button` is `disabled` while `reason.trim() === ""`.
- Submit: `finalizeValorantSeries(seriesId, { ratingMode, officialWinnerTeamId: officialWinnerTeamId ?? null, overrideReason: reason.trim() || null })`. While `submitting`, button label `Finalizing…` and a `role="status"` note "This action cannot be retried automatically — wait for the result."
- Error handling (rendered in `ValorantErrorAlert`; the backend `ApiRequestError.message` is always shown first, then these contextual hints — hints never replace the backend message):
  - message contains `ANCHOR_MISMATCH` → hint "Override requires an explicit rated mode and a reason."
  - message contains `BACKDATED_SERIES_REJECTED` → hint "Create a new series with a later played-at date; backdating is not allowed."
  - message contains `RATING_POLICY_REQUIRED` → hint "Choose an explicit rating policy and provide a reason."
  - message contains `SERIES_ALREADY_FINALIZED` → hint "This series is already committed." and trigger the parent refetch so the committed state shows (never re-submit).
- On success: `onFinalized(result)` → parent refetches series + preview and shows the committed-result card.

Modify `frontend/components/admin/valorant/ValorantSeriesDetail.tsx`:
- For `draft` series render `ValorantFinalizeForm` (below `ValorantPreviewPanel`), passing `calculatedWinnerId={preview?.calculatedWinnerId ?? null}` and team labels from `series.bindingA.savedTeam?.name ?? "Team A"` / `series.bindingB.savedTeam?.name ?? "Team B"`.
- On `onFinalized`: `showToast({ title: "Series finalized", tone: "success" })`, `await refetchDetail()`, `await refetchPreview()`.
- For `finalized` render the committed-result card (replaces the preview): `ValorantStatusBadge`, `ratingMode` via `ratingModeLabel`, `finalizedById`, `valorantSeriesUuid` (truncated), and the two current ELOs when the finalize result is still in state.
- Timeout/unknown finalize (finalize `catch` receives `ApiRequestError` with `status === 0` or `408`, and the subsequent refetch shows `series.lastOperation.status === "reconciliation_required"`): render `ValorantOperationBanner` (already present) plus `Re-check status` (reads only, Global Constraint 5).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/valorant.test.ts tests/unit/valorant-api.test.ts tests/unit/valorant-components.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/admin/valorant/ValorantFinalizeForm.tsx frontend/components/admin/valorant/ValorantSeriesDetail.tsx frontend/tests/unit/valorant.test.ts frontend/tests/unit/valorant-api.test.ts frontend/tests/unit/valorant-components.test.ts
git commit -m "feat(valorant): add Rated/Unrated finalize UX with forfeit/override and outcome handling"
```

---

### Task 7: Rankings and rating history

**Files:**
- Extend: `frontend/hooks/api/useValorant.ts` (`useValorantRankings`, `useValorantRatingHistory`, `useValorantTeamSeries`)
- Create: `frontend/components/admin/valorant/ValorantRankingsManager.tsx`, `ValorantRatingHistoryPanel.tsx`
- Create: `frontend/app/admin/valorant/rankings/page.tsx`
- Extend: `frontend/tests/unit/valorant-components.test.ts` (rankings guards)

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/valorant-components.test.ts`:

```ts
it("rankings join with bindings and drill into rating history", () => {
  const manager = read("components/admin/valorant/ValorantRankingsManager.tsx");
  expect(manager).toContain("useValorantRankings");
  expect(manager).toContain("useValorantBindings");
  expect(manager).toContain("joinRankingsWithBindings");
  expect(manager).toContain('aria-label="Rank"');
  expect(manager).toContain('aria-label="ELO"');
  expect(manager).toContain('aria-label="Series (W-L)"');
});

it("rating history panel shows ELO deltas and team series", () => {
  const panel = read("components/admin/valorant/ValorantRatingHistoryPanel.tsx");
  expect(panel).toContain("fetchValorantRatingHistory");
  expect(panel).toContain("fetchValorantTeamSeries");
  expect(panel).toContain("formatEloDelta");
  expect(panel).toContain("calculationDetails");
  expect(panel).toContain("No rating events yet");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/valorant-components.test.ts`
Expected: FAIL — the two component files do not exist.

- [ ] **Step 3: Implement rankings and rating history**

`frontend/hooks/api/useValorant.ts` — add:

```ts
export function useValorantRankings() {
  return useApiQuery(["valorant-rankings"], fetchValorantRankings);
}

export function useValorantRatingHistory(teamId: string | null, enabled: boolean) {
  return useApiQuery(["valorant-rating-history", teamId ?? ""], () => fetchValorantRatingHistory(teamId as string), {
    enabled: enabled && Boolean(teamId),
  });
}

export function useValorantTeamSeries(teamId: string | null, enabled: boolean) {
  return useApiQuery(["valorant-team-series", teamId ?? ""], () => fetchValorantTeamSeries(teamId as string), {
    enabled: enabled && Boolean(teamId),
  });
}
```

`frontend/components/admin/valorant/ValorantRankingsManager.tsx` — `"use client"`. Uses `useValorantRankings()` and `useValorantBindings()`. `<AdminShell title="VALORANT Rankings" description="Admin-only standings and rating history. Quest never computes ELO — rankings come from the VALORANT platform.">`. Body:
- Join `rankings` with `bindings` via `joinRankingsWithBindings`.
- Responsive table (`overflow-x-auto`): `<th scope="col" aria-label="Rank">`, `<th scope="col" aria-label="Team">`, `<th scope="col" aria-label="ELO">`, `<th scope="col" aria-label="Series (W-L)">`; rows sorted by `rank`; each row clickable (a `Button`-style row or an explicit `History` button) selecting the team.
- Selected team → `ValorantRatingHistoryPanel teamId={selected.teamId} teamLabel={selected.teamLabel}` below the table.
- Loading → `ValorantLoadingState`. Empty (`rankings.length === 0`) → `ValorantEmptyState title="No rankings yet" description="Finalize a rated series to generate ELO standings."`. Error → `ValorantErrorAlert` with retry.

`frontend/components/admin/valorant/ValorantRatingHistoryPanel.tsx` — `"use client"`. Props `{ teamId: string; teamLabel: string }`. Uses `useValorantRatingHistory(teamId, true)` and `useValorantTeamSeries(teamId, true)`. Renders:
- "Rating history" section: table of events — `sequence`, `result` (`Badge`), `eloBefore` → `eloAfter` with `formatEloDelta` (e.g. `1200 → 1218 (+18)`), `kFactor`, `calculationDetails` rendered as a `<details>` with a JSON `<pre>` (scrubbed display only). Empty → "No rating events yet".
- "Team series" section: list of `SeriesViewLite` rows — `format`, `status` label, `playedAt` via `formatAdminCompactDateTime`, `ratingMode` via `ratingModeLabel`. Empty → "No series found for this team".
- Loading/error states per the established pattern.

Create `frontend/app/admin/valorant/rankings/page.tsx` (thin).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/valorant-components.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/api/useValorant.ts frontend/components/admin/valorant/ValorantRankingsManager.tsx frontend/components/admin/valorant/ValorantRatingHistoryPanel.tsx frontend/app/admin/valorant/rankings/page.tsx frontend/tests/unit/valorant-components.test.ts
git commit -m "feat(valorant): add admin rankings with rating-history and team-series drill-down"
```

---

### Task 8: Reconciliation and operation states

**Files:**
- Extend: `frontend/hooks/api/useValorant.ts` (`useValorantReconciliation`)
- Create: `frontend/components/admin/valorant/ValorantReconciliationManager.tsx`
- Create: `frontend/app/admin/valorant/reconciliation/page.tsx`
- Extend: `frontend/tests/unit/valorant-api.test.ts` (reconciliation read), `frontend/tests/unit/valorant-components.test.ts` (report guards)

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/valorant-api.test.ts`:

```ts
it("reads the reconciliation report as a read-only endpoint", async () => {
  mockedRequest.mockResolvedValueOnce(unwrap({ report: { orphaned: [], unprojected: [], teamMissing: [], matchMissing: [], stuckOperations: [] } }));
  const { fetchValorantReconciliation } = await import("../../lib/valorant-api");
  const result = await fetchValorantReconciliation();
  expect(result.report.stuckOperations).toEqual([]);
  expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/reconciliation");
});
```

Append to `frontend/tests/unit/valorant-components.test.ts`:

```ts
it("reconciliation page surfaces every report class as read-only", () => {
  const manager = read("components/admin/valorant/ValorantReconciliationManager.tsx");
  expect(manager).toContain("fetchValorantReconciliation");
  expect(manager).toContain("Refresh report");
  for (const label of ["Orphaned series", "Series without a Quest projection", "Bindings with a missing VALORANT team", "Match projections with a missing match", "Stuck operations"]) {
    expect(manager).toContain(label);
  }
  expect(manager).not.toContain('method: "POST"');
  expect(manager).not.toContain('method: "DELETE"');
  expect(manager).not.toContain('method: "PUT"');
});

it("series and operation statuses use the exact enum labels", () => {
  const detail = read("components/admin/valorant/ValorantSeriesDetail.tsx");
  const badge = read("components/admin/valorant/ValorantStatusBadge.tsx");
  for (const status of ["draft", "finalized", "orphaned", "reconciliation_required"]) {
    expect(detail).toContain(status);
  }
  expect(badge).toContain("operationStatusLabel");
  expect(badge).toContain("seriesStatusLabel");
  expect(badge).not.toContain("finalizing");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/valorant-api.test.ts tests/unit/valorant-components.test.ts`
Expected: FAIL — the reconciliation component does not exist.

- [ ] **Step 3: Implement the reconciliation manager**

`frontend/hooks/api/useValorant.ts` — add:

```ts
export function useValorantReconciliation() {
  return useApiQuery(["valorant-reconciliation"], fetchValorantReconciliation);
}
```

`frontend/components/admin/valorant/ValorantReconciliationManager.tsx` — `"use client"`. Uses `useValorantReconciliation()`. `<AdminShell title="Reconciliation" description="Detect mismatches between Quest projections and the VALORANT platform. All checks are read-only.">` with an `actions` `Refresh report` `Button` that calls `refetch()`. Body: five `Card` sections, each titled as pinned in the test labels:

1. **Orphaned series** — `report.orphaned` rows: `id`, `externalKey`, `valorantSeriesUuid`, `ValorantStatusBadge kind="series"`. Empty → "No orphaned series."
2. **Series without a Quest projection** — `report.unprojected` rows: `id`, `externalQuestSeriesId`. Empty → "No unprojected series."
3. **Bindings with a missing VALORANT team** — `report.teamMissing` rows: SavedTeam name (or "Detached team"), `valorantTeamUuid`. Empty → "All bound teams resolve."
4. **Match projections with a missing match** — `report.matchMissing` rows: `henrikMatchId`, `matchId`. Empty → "All match projections resolve."
5. **Stuck operations** — `report.stuckOperations` rows: `operationId`, `type`, `ValorantStatusBadge kind="operation"`, `questSeriesId`; a hint row: "Open the related series and use 'Re-check status' — the UI never retries automatically."

Each section header includes a count `Badge`. A closing note: "Projection re-sync and adoption are backend operations (FastAPI reads only) — MVP offers no destructive cleanup." The component contains no `method: "POST"` / `"PUT"` / `"DELETE"` calls (Global Constraint 13). Loading → `ValorantLoadingState`; a failed report → `ValorantErrorAlert` with retry. `role="status"` on the count summaries for screen readers.

Create `frontend/app/admin/valorant/reconciliation/page.tsx` (thin).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/valorant-api.test.ts tests/unit/valorant-components.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/api/useValorant.ts frontend/components/admin/valorant/ValorantReconciliationManager.tsx frontend/app/admin/valorant/reconciliation/page.tsx frontend/tests/unit/valorant-api.test.ts frontend/tests/unit/valorant-components.test.ts
git commit -m "feat(valorant): add read-only reconciliation surface with operation state badges"
```

---

### Task 9: Final verification — loading/empty/error/accessibility/responsive polish and full suite

**Files:**
- Modify: `frontend/components/admin/valorant/*` (only as flagged by the new source guards or `npm run lint`/typecheck)
- Extend: `frontend/tests/unit/valorant-components.test.ts` (final accessibility/responsive guard pass)

- [ ] **Step 1: Write the final guard tests**

Append to `frontend/tests/unit/valorant-components.test.ts`:

```ts
it("every VALORANT manager ships loading, empty, and error surfaces", () => {
  for (const file of [
    "ValorantTeamsManager.tsx",
    "ValorantDiscoveryManager.tsx",
    "ValorantSeriesManager.tsx",
    "ValorantSeriesDetail.tsx",
    "ValorantRankingsManager.tsx",
    "ValorantReconciliationManager.tsx",
  ]) {
    const source = read(`components/admin/valorant/${file}`);
    expect(source, file).toContain("ValorantLoadingState");
    expect(source, file).toContain("ValorantEmptyState");
    expect(source, file).toContain("ValorantErrorAlert");
  }
});

it("uses accessible, responsive primitives and stays inside the admin shell", () => {
  for (const file of [
    "ValorantTeamsManager.tsx",
    "ValorantDiscoveryManager.tsx",
    "ValorantSeriesManager.tsx",
    "ValorantSeriesDetail.tsx",
    "ValorantRankingsManager.tsx",
    "ValorantReconciliationManager.tsx",
  ]) {
    const source = read(`components/admin/valorant/${file}`);
    expect(source, file).toContain("<AdminShell");
    expect(source, file).toContain("min-w-0");
    expect(source, file).toMatch(/overflow-x-auto|md:grid-cols-2|lg:grid-cols-2|xl:grid-cols-3/);
  }
});

it("never calls the platform directly from any VALORANT component", () => {
  const { readdirSync } = require("node:fs");
  const dir = resolve(process.cwd(), "components/admin/valorant");
  for (const file of readdirSync(dir)) {
    const source = read(`components/admin/valorant/${file}`);
    expect(source, file).not.toMatch(/localhost:8000|valorant-platform-backend|api\.henrikdev|X-Admin-Key|VALORANT_SERVICE_SECRET|window\.fetch/);
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/valorant-components.test.ts`
Expected: FAIL — the loading/empty/error guard fails for any manager that was implemented without one of the three surfaces (fix by wiring the missing surface into that manager before Step 3's green run; do not weaken the test).

- [ ] **Step 3: Fix surfaces and verify green**

Fix any manager flagged by Step 2 (add the missing `ValorantLoadingState`/`ValorantEmptyState`/`ValorantErrorAlert`, `AdminShell`, `min-w-0` wrapper, or responsive grid/overflow classes). Re-run:

Run: `npx vitest run tests/unit/valorant-components.test.ts`
Expected: PASS.

- [ ] **Step 4: Full verification battery**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: `npm test` PASS (all unit suites incl. the three VALORANT files). `npm run typecheck` PASS (strict). `npm run lint` clean (0 errors). `npm run build` succeeds (all `/admin/valorant/*` pages resolve).

- [ ] **Step 5: UI verification note (deferred — do not install a browser)**

Do **not** run `npx playwright install` (spec §10.3). Record in the commit message and hand-off notes that interactive verification is deferred to **Playwright MCP** or a manual browser against `localhost:3000` once available, covering the §11.6 flows: bind flow, discovery + explicit selection, series create with Rated/Unrated preference, attach/reorder/remove with side mapping, preview panel, finalize with audit banner, anchor-mismatch prompt, orphan/reconciliation banner, rankings page. `frontend/playwright.config.ts` and `frontend/tests/e2e/*` stay untouched.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/admin/valorant frontend/tests/unit/valorant-components.test.ts
git commit -m "test(valorant): final accessibility, responsive, and state-surface verification pass"
```

If any manager needed a surface fix, include its file path in the same commit and re-run Task 9 Step 4 before committing.

---

## Plan Self-Review

**1. Spec coverage (approved spec §3.1, §5.1–§5.7, §6.2/§6.4/§6.5, §8.2–§8.3, §9.1, §10.3, §11.6):**
- §5.1 team binding selection from SavedTeams + detach (no re-activate) → Task 2.
- §5.2 Riot-ID two-player discovery, explicit selection, two-stage detail/import, no-overlap empty state → Task 3.
- §5.3 standalone BO1/BO3/BO5 create with anchors + `ratingModePreference` → Task 4.
- §5.4 attach/remove/absolute reorder/side mapping with draft-only guards and the exact attach error surface (verbatim backend messages) → Task 5.
- §5.5/§5.6 preview + finalize with all five `rating_mode` options, reason-required forfeit/override, `SERIES_ALREADY_FINALIZED`/`ANCHOR_MISMATCH`/`BACKDATED_SERIES_REJECTED`/`RATING_POLICY_REQUIRED` outcome handling, no blind retry → Task 6.
- §5.7 rankings + rating history reads joined with bindings (Quest never computes ELO) → Task 7.
- §8.2/§8.3 reconciliation + operation-state surfaces (read-only report, `Re-check status` reads, no `finalizing` series status) → Tasks 5, 6, 8.
- §9.1 browser→Quest only, `requireAdmin` via `AdminShell`/`AdminGuard` → Global Constraints 1, 14 + Task 1 source guard.
- §10.3 Playwright install deferred; Playwright MCP / manual later → Task 9 Step 5.
- §11.6 UI verification checklist coverage → Task 9 Step 5.
- Excluded per §2.1: public stats, tournament fixture links, Challonge, mobile-admin screens, browser-install work → Global Constraints 9, 12 and no such code appears in any task.

**2. Placeholder scan:** No TBD/TODO/"implement later". Every task names exact file paths, exact test code, exact expected red/green outcomes, exact labels/aria strings, and exact commit commands. The single "…" snippets in `lib/valorant-api.ts`'s interface block are export-name enumerations already fully spelled out in Task 1 Step 5's implementation, not vague steps.

**3. Type consistency:**
- Every API type in "Interfaces Produced" matches the backend plan's consumed payloads (route table above): `Binding`, `MatchCandidate`, `MatchDetail`, `QuestValorantSeries`, `SeriesGame`, `SeriesPreview`, `FinalizeResult`, `RankingEntry`, `RatingEvent`, `ReconciliationReport` field-for-field with the backend mapper output (`mapMatchCandidate`, `mapMatchDetail`, `mapSeriesView`, `mapGameView`, `mapPreview`, `mapFinalizeResult`, `mapRatingEvent`, `mapRankingEntry`) and the `MatchListResponse` pin from `valorant-platform-backend/app/schemas/matches.py`.
- `lib/valorant-api.ts` function names used by tests (Task 1/2/4/5/6/8), by hooks (Tasks 2–8), and by components (Tasks 2–8) are identical (`fetchValorantBindings`, `bindValorantTeam`, `detachValorantBinding`, `discoverValorant`, `importValorantMatch`, `fetchValorantMatchByHenrikId`, `fetchValorantMatches`, `createValorantSeries`, `fetchValorantSeriesList`, `fetchValorantSeries`, `deleteValorantSeries`, `attachValorantGame`, `setValorantGameOrder`, `removeValorantGame`, `fetchValorantPreview`, `finalizeValorantSeries`, `fetchValorantRankings`, `fetchValorantRatingHistory`, `fetchValorantTeamSeries`, `fetchValorantReconciliation`).
- Hook names produced in Tasks 1–8 match their component usages (`useValorantBindings`, `useValorantSeriesList`, `useValorantSeriesDetail`, `useValorantPreview`, `useValorantMatches`, `useValorantRankings`, `useValorantRatingHistory`, `useValorantTeamSeries`, `useValorantReconciliation`).
- Pure helpers referenced by tests and components are identical (`mapsForFormat`, `REQUIRES_REASON_RATING_MODES`, `ratingModeLabel`, `seriesStatusLabel`, `operationStatusLabel`, `parseRiotIdInput`, `formatRiotId`, `mapMatchSummary`, `validateDesiredOrder`, `nextGameNumber`, `joinRankingsWithBindings`, `formatEloDelta`).
- Route paths in `lib/valorant-api.ts`, the consumed-route table, and the backend plan's Task 10 table are identical (`/api/v1/admin/valorant/...`).
- Series status literals are exactly `draft | finalized | orphaned | reconciliation_required` (Global Constraint 6) — enforced by the Task 8 source guard.

**Dependency note for the orchestrator:** this UI plan is consumable once the Quest backend plan's Task 10 route table is merged; its fixture-driven frontend tests (`lib/valorant-api.test.ts` with `vi.mock`) pass without any backend or FastAPI work running. The two-service E2E journey (§11.4) and the FastAPI deltas D1–D11 remain prerequisites for end-to-end interactive verification, which is explicitly deferred (§10.3).
