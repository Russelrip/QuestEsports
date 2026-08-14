# VALORANT admin UI verification (Playwright MCP / manual)

Browser install is deferred; verify with Playwright MCP or a manual browser
against `http://localhost:3000` with both services running (see
`docs/setup-and-deployment.md` — VALORANT local commands). Use scrubbed fixture
data; never capture real Riot IDs or real matches. Save screenshots to the
operational record, not the repository.

## Flows (each recorded as passed/failed with a screenshot)

1. **Team binding** — `/admin/valorant`: pick an existing SavedTeam, bind it,
   confirm the VALORANT team UUID is shown as an opaque id; bind a second team;
   attempt to bind one team twice and confirm the duplicate is rejected.
2. **Discovery + explicit selection** — `/admin/valorant/discover`: enter two
   Riot IDs; confirm the candidate list shows only the `MatchCandidate` fields
   (no winning side/roster); confirm a no-overlap search returns an empty list,
   not an error; confirm selecting a candidate is explicit (nothing auto-imports).
3. **Series create** — `/admin/valorant/series`: create a BO3 draft with
   Rated/Unrated preference and the two anchor Riot IDs; confirm the draft
   status is shown.
4. **Attach / reorder / remove with side mapping** — attach three imported
   games, set the absolute desired order, remove one game, and confirm each game
   row shows the Red/Blue side assigned to Team A/Team B.
5. **Preview panel** — confirm `valid`, per-game winners, maps won, calculated
   winner, and the anchor identities.
6. **Finalize** — finalize rated; confirm the audit banner (actor + operation
   id) and the two rating events; confirm a second finalize shows the committed
   state with no re-apply.
7. **Anchor-mismatch prompt** — finalize a series whose games do not contain
   both anchors on opposing sides; confirm the `ANCHOR_MISMATCH` surface and the
   override-reason path.
8. **Orphan / reconciliation banner** — with one Quest series left in
   `reconciliation_required`, confirm the admin surface lists it and offers
   controlled re-sync/adoption.
9. **Rankings page** — `/admin/valorant/rankings`: confirm the table reflects
   the finalized series (binding display names joined with FastAPI rankings).
