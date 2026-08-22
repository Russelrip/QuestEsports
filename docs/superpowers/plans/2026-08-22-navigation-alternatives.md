# Navigation cleanup — alternatives evaluation

Date: 2026-08-22
Status: evaluation only; no restructuring implemented yet.

This document covers the third bullet of the "Clean up navigation bar" task.
The first two bullets (remove unnecessary titles, add icons to submenu items)
are already implemented — see the summary at the end.

## Current state, measured

**Public header** ([`frontend/components/Navbar.tsx`](../../../frontend/components/Navbar.tsx))

- 8 destinations, split around a centered logo: 5 on the left
  (`primaryNavItems`) and 3 on the right (`secondaryNavItems`).
- The desktop right side also carries auth actions (2 links) or the account
  dropdown plus a notification bell.
- Below `lg`, all 8 collapse into a single flat list in a drop-down sheet, with
  the account block appended underneath.

**Admin sidebar** ([`frontend/components/admin/AdminShell.tsx`](../../../frontend/components/admin/AdminShell.tsx))

- 19 links in 5 groups (Workspace 3, Competition 5, People 5, Commerce 5,
  Game Operations 4), defined in [`frontend/lib/admin.ts`](../../../frontend/lib/admin.ts).
- Fixed 288px (`w-72`) rail, always fully expanded, no collapse affordance.
- Below `lg`, the identical 19-link list renders in a full-height drawer.

## Problems worth fixing

1. **The left/right split carries no meaning.** Nothing tells a visitor that
   Gallery sits left of the logo while Shop sits right. The split exists to
   balance the centered logo, not to model the site. It also caps the header at
   roughly 8 items before it stops fitting.

2. **Real destinations have no header entry.** `/tickets`, `/events`, `/join`,
   `/rulebook`, and `/support` are all live routes reachable only from the
   footer or from deep links. `/tickets` is the clearest case: the active-state
   helper special-cases it so that browsing a ticket page lights up
   **Tournaments** ([`Navbar.tsx:23`](../../../frontend/components/Navbar.tsx#L23)).
   That line is a symptom — the header has no place to put Tickets, so the
   highlight borrows a neighbour.

3. **The footer keeps a second, drifted copy of the menu.**
   [`Footer.tsx:6-20`](../../../frontend/components/Footer.tsx#L6-L20) hardcodes
   its own `mainMenuLinks` and `usefulLinks`. Compared with `lib/site.ts` it
   omits Valorant Leaderboard and Contact and adds Join Quest. Two sources of
   truth for the same information architecture, already out of sync.

4. **The admin sidebar shows everything, always.** 19 links with no collapse and
   no search means the rail is a wall of text on every page. Three of the five
   groups are the same size, so the grouping does little to speed up scanning.

5. **Every admin row renders a trailing chevron** that implies the row expands.
   It does not — it navigates. This is a misleading affordance, and it is the
   single largest source of visual noise in the rail.

## Options — public header

### A. Flat bar, rebalanced, with a "More" overflow menu

Move the logo to the left, run all primary destinations in one row, and push
low-traffic items (Members, Contact, Rulebook, Join) into a single **More**
dropdown. Account controls stay right.

- **Pros:** smallest diff; kills the arbitrary left/right split; gives Tickets
  and Events a home; the overflow menu is the natural place for the icons added
  in this pass. Removes the need for the `/tickets` active-state special case.
- **Cons:** a "More" bucket is a known dead end — items inside get materially
  fewer clicks. Loses the centered-logo look, which is part of the current brand
  presentation.
- **Effort:** roughly half a day, including the footer de-duplication.

### B. Grouped dropdowns (Compete / Watch / Community / Shop)

Four top-level triggers, each opening a small panel of 2-5 icon-led items.

| Trigger | Contains |
|---|---|
| Compete | Tournaments, Events, Valorant Leaderboard, Rulebook, Join Quest |
| Watch | Match Videos, Gallery |
| Community | Members, Contact, Support |
| Shop | Shop, Tickets |

- **Pros:** models the site properly and scales — new surfaces land in an
  existing group instead of widening the bar. The icons added in this pass pay
  off most here, since every submenu row is icon-led. Mirrors the admin
  sidebar's grouped structure, so the two shells finally agree with each other.
- **Cons:** the biggest behavioural change of the three. Hover, focus, escape
  and outside-click handling for four panels, plus keyboard and touch
  behaviour, is genuinely fiddly. Adds a click to reach Tournaments, currently
  the top destination. Mobile needs the groups as accordions, which is more code
  than today's flat list.
- **Effort:** roughly 2 days including accessibility work and tests.

### C. Slim bar plus a command palette

Keep 4-5 destinations in the bar; add a `Ctrl/Cmd-K` palette that searches every
route, tournament, and event.

- **Pros:** the best ceiling for power users and admins; makes the "we have more
  pages than fit" problem go away permanently.
- **Cons:** solves a problem the public site does not have. Visitors are mostly
  first-time and mobile; a palette is invisible to them, so the bar still has to
  answer the question on its own. The real cost sits in the search index, not
  the UI.
- **Effort:** roughly 3 days, and it does not remove the need for A or B
  underneath it.

## Options — admin sidebar

### A. Keep groups, make them collapsible with persisted state

Each of the 5 headings becomes a disclosure; open/closed state persists in
`localStorage`; the group containing the active route always opens.

- **Pros:** a direct answer to problem 4, and the existing chevron finally means
  something once it moves from the rows to the headings. Small, contained diff.
- **Cons:** adds a click for people who want everything visible. Persisted state
  can leave someone staring at a rail where the thing they want is hidden.
- **Effort:** roughly half a day.

### B. Icon rail plus contextual panel

A narrow 64px rail of the 5 group icons; clicking one opens its links in a
secondary panel.

- **Pros:** recovers around 220px of horizontal space for the data tables that
  are the actual content of most admin pages.
- **Cons:** two-level navigation for a 19-item menu is over-built. Group icons
  are hard to make distinct enough to be recognised without labels, and
  "Workspace" and "Game Operations" have no obvious glyphs.
- **Effort:** roughly 2 days.

### C. Flat list plus a filter box

Drop the group headings, sort all 19 alphabetically, and add a type-to-filter
input at the top of the rail.

- **Pros:** fastest route to a known destination; deletes the grouping question
  entirely.
- **Cons:** loses the mental model of the console, which is genuinely useful for
  new admins. Filtering only helps people who already know the label.
- **Effort:** roughly half a day.

## Recommendation

**Public header: option B, with option A as the fallback.** The header's real
problem is that the site has outgrown a flat bar — five live routes have no
entry, and the `/tickets` special case is the proof. A "More" bucket (option A)
hides that problem rather than fixing it, and Tickets and Events are commercial
surfaces that should not sit in an overflow menu. If two days is too much for
this cycle, do A now and treat it as a staging step toward B; the `SiteNavItem`
shape added in this pass already carries the icon key that either structure
needs.

**Admin sidebar: option A.** The rail's structure is sound; it just shows too
much at once. Collapsible groups are a contained change that also gives the
misleading chevron a correct job.

**Worth doing first, regardless of which option is chosen:**

- Delete the `/tickets` clause in `isNavItemActive` once Tickets has its own
  entry.
- Make `Footer.tsx` derive from `lib/site.ts` instead of keeping its own lists.
- Remove the per-row chevron from `AdminNavigationItem`.

These three are cheap, independent of the restructuring decision, and each one
removes a known defect.

## Already implemented in this pass

- Public header: dropped the "QUEST" wordmark under the logo (the logo already
  reads QUEST; `aria-label="Quest home"` preserves the accessible name) and
  enlarged the mark slightly to hold the space.
- Account dropdown: moved the "Verified account / Verification pending" line off
  the always-visible trigger and into the panel beside the email, so the bar
  itself carries one line instead of two.
- Admin sidebar: dropped the "Operations console" eyebrow under "QUEST ADMIN".
- Icons added to the mobile menu rows, the account dropdown (Profile, Admin
  Panel, Logout), and the mobile Admin Panel and Logout rows.
- Icon paths consolidated into [`frontend/lib/icons.ts`](../../../frontend/lib/icons.ts)
  and rendered through [`frontend/components/ui/icon.tsx`](../../../frontend/components/ui/icon.tsx),
  replacing the table that previously lived inside `AdminShell.tsx`. Both shells
  now draw from one set.
- [`frontend/tests/unit/navigation-icons.test.ts`](../../../frontend/tests/unit/navigation-icons.test.ts)
  asserts every public and admin nav entry resolves to a non-empty icon path.
