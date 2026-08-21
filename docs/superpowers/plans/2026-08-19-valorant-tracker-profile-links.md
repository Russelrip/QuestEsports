# VALORANT Tracker Profile Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible external Tracker Network profile link to every public VALORANT leaderboard and search-result row without adding an API dependency.

**Architecture:** Keep the existing leaderboard data flow unchanged. Add a pure frontend helper that converts the existing Riot ID (`name` + `tag`) into one encoded Tracker profile URL, then render a small external-link affordance beside the player name. Do not add backend routes, schema fields, credentials, or undocumented Tracker API calls.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-valorant-tracker-profile-links-design.md`

## Global Constraints

- Keep Tracker credentials and API calls out of this phase.
- Preserve existing leaderboard columns, pagination, search, outage fallback, and Quest-provided ranking/stat values.
- Encode the complete Riot ID as one URL path segment.
- External links must use `target="_blank"` and `rel="noreferrer"` (or the repository’s equivalent secure rel value) and have an accessible label.
- Use the existing frontend unit-test command: `npm test -- --run tests/unit` from `frontend`.

---

### Task 1: Add the Tracker URL helper and unit tests

**Files:**
- Modify: `frontend/lib/valorant.ts` near `formatRiotId`
- Create: `frontend/tests/unit/valorant-tracker.test.ts`

**Interfaces:**
- Produces `buildValorantTrackerProfileUrl(name: string, tag: string): string | null`.
- The helper returns `https://tracker.gg/valorant/profile/riot/<encoded Riot ID>/overview` when both inputs are non-empty after trimming; otherwise it returns `null`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { buildValorantTrackerProfileUrl } from "../../lib/valorant";

describe("buildValorantTrackerProfileUrl", () => {
  it("encodes the complete Riot ID as one Tracker path segment", () => {
    expect(buildValorantTrackerProfileUrl("Jiren Prime", "JAANU"))
      .toBe("https://tracker.gg/valorant/profile/riot/Jiren%20Prime%23JAANU/overview");
  });

  it("encodes unicode and reserved characters", () => {
    expect(buildValorantTrackerProfileUrl("A/B", "täg"))
      .toBe("https://tracker.gg/valorant/profile/riot/A%2FB%23t%C3%A4g/overview");
  });

  it("returns null when either Riot ID component is empty", () => {
    expect(buildValorantTrackerProfileUrl("", "TAG")).toBeNull();
    expect(buildValorantTrackerProfileUrl("Name", " ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run tests/unit/valorant-tracker.test.ts` from `frontend`.

Expected: FAIL because `buildValorantTrackerProfileUrl` is not exported yet.

- [ ] **Step 3: Implement the minimal helper**

Add this implementation near `formatRiotId` in `frontend/lib/valorant.ts`:

```ts
export const buildValorantTrackerProfileUrl = (name: string, tag: string): string | null => {
  const trimmedName = String(name || "").trim();
  const trimmedTag = String(tag || "").trim();
  if (!trimmedName || !trimmedTag) return null;
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(`${trimmedName}#${trimmedTag}`)}/overview`;
};
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- --run tests/unit/valorant-tracker.test.ts` from `frontend`.

Expected: PASS with all three cases passing.

### Task 2: Render the accessible Tracker link in leaderboard rows

**Files:**
- Modify: `frontend/components/valorant/ValorantLeaderboard.tsx:1-70`
- Modify: `frontend/tests/unit/valorant-leaderboard.test.ts`

**Interfaces:**
- Consumes `buildValorantTrackerProfileUrl` from `@/lib/valorant`.
- The existing `LeaderboardRow` remains the single rendering path for both paginated entries and exact search results.

- [ ] **Step 1: Add static contract assertions for the link behavior**

Extend the existing public leaderboard test with assertions that the component source imports and uses the helper, opens the destination in a new tab, supplies `noopener noreferrer`, and includes an accessible Tracker label:

```ts
expect(component).toContain("buildValorantTrackerProfileUrl");
expect(component).toContain('target="_blank"');
expect(component).toContain('rel="noopener noreferrer"');
expect(component).toContain("View");
expect(component).toContain("Tracker");
```

- [ ] **Step 2: Run the focused leaderboard test to verify the contract fails**

Run: `npm test -- --run tests/unit/valorant-leaderboard.test.ts` from `frontend`.

Expected: FAIL because the component does not yet contain a Tracker link or helper import.

- [ ] **Step 3: Implement the row affordance**

Import `buildValorantTrackerProfileUrl`, derive the URL before the row return, and place the link beside the existing player name without changing the table columns:

```tsx
const trackerUrl = buildValorantTrackerProfileUrl(entry.name, entry.tag);
```

Render the existing player text followed by a conditional link:

```tsx
{trackerUrl ? (
  <a
    href={trackerUrl}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={`View ${entry.name}#${entry.tag} on Tracker`}
    title="View profile on Tracker"
    className="ml-2 inline-flex rounded p-1 text-slate-500 transition hover:text-fuchsia-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
  >
    ↗
  </a>
) : null}
```

Use the repository’s existing visual conventions if an established icon component is available; keep the icon decorative because the link itself has the accessible label. Do not render a dead link for incomplete IDs.

- [ ] **Step 4: Run the focused leaderboard tests to verify they pass**

Run: `npm test -- --run tests/unit/valorant-leaderboard.test.ts tests/unit/valorant-tracker.test.ts` from `frontend`.

Expected: PASS.

### Task 3: Run frontend verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run the complete frontend unit suite**

Run: `npm test` from `frontend`.

Expected: PASS with no unrelated test regressions.

- [ ] **Step 2: Run TypeScript validation**

Run: `npm run typecheck` from `frontend`.

Expected: PASS with no unused import, JSX, or type errors.

- [ ] **Step 3: Run lint validation**

Run: `npm run lint` from `frontend`.

Expected: PASS with no new lint violations.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff -- docs/superpowers/specs/2026-08-19-valorant-tracker-profile-links-design.md docs/superpowers/plans/2026-08-19-valorant-tracker-profile-links.md frontend/lib/valorant.ts frontend/components/valorant/ValorantLeaderboard.tsx frontend/tests/unit/valorant-leaderboard.test.ts frontend/tests/unit/valorant-tracker.test.ts`.

Confirm that only the documented helper, leaderboard affordance, tests, and planning artifacts changed; confirm no API key, upstream request, or backend change was introduced.
