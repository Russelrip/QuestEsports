const { createOperation } = require("./helpers");

const valorantAndStaffPaths = {
  "/api/v1/admin/valorant/teams": {
    get: createOperation("valorant", "List VALORANT team bindings with their FastAPI teams", { authenticated: true }),
  },
  "/api/v1/admin/valorant/teams/bind": {
    post: createOperation("valorant", "Bind a SavedTeam to a VALORANT team (create-or-get by quest_saved_team_id)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/teams/{bindingId}/detach": {
    delete: createOperation("valorant", "Detach a VALORANT team binding (Quest-local, never touches VALORANT data)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/discover": {
    post: createOperation("valorant", "Run a two-player VALORANT match search", { authenticated: true }),
  },
  "/api/v1/admin/valorant/matches/import": {
    post: createOperation("valorant", "Import a selected Henrik match (idempotent, created=true/false)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/matches/by-henrik-id/{henrikMatchId}": {
    get: createOperation("valorant", "Get a match detail by Henrik match id", { authenticated: true }),
  },
  "/api/v1/admin/valorant/matches": {
    get: createOperation("valorant", "List VALORANT matches", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series": {
    post: createOperation("valorant", "Create a draft VALORANT series with anchors and external key", { authenticated: true }),
    get: createOperation("valorant", "List Quest VALORANT series projections", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/manual": {
    post: createOperation("valorant", "Create and finalize a manual-result VALORANT series (no games; idempotent by external key)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}": {
    get: createOperation("valorant", "Get a Quest VALORANT series projection", { authenticated: true }),
    delete: createOperation("valorant", "Delete a draft VALORANT series", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{seriesId}": {
    patch: createOperation("valorant", "Update a draft VALORANT series playedAt", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{seriesId}/matches": {
    get: createOperation("valorant", "List matches relevant to a series (anchor-aware, with anchor side)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/games": {
    post: createOperation("valorant", "Attach an imported match as a game with side mapping", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/games/order": {
    put: createOperation("valorant", "Set the absolute desired game order (draft only, idempotent)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/games/{gameId}": {
    delete: createOperation("valorant", "Remove a game from a draft series", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/preview": {
    get: createOperation("valorant", "Preview a series validity and calculated winner", { authenticated: true }),
  },
  "/api/v1/admin/valorant/series/{id}/finalize": {
    post: createOperation("valorant", "Finalize a series with a rating mode and optional override", { authenticated: true }),
  },
  "/api/v1/admin/valorant/leaderboard/players": {
    get: createOperation("valorant", "List every VALORANT leaderboard registration, including players the public board hides (admin or valorant_leaderboard staff permission)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/leaderboard/players/{puuid}": {
    delete: createOperation("valorant", "Remove a player from the VALORANT leaderboard (reason required, audited; admin or valorant_leaderboard staff permission)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/leaderboard/removals": {
    get: createOperation("valorant", "List removed VALORANT leaderboard players, newest first, with whether each can be restored (admin or valorant_leaderboard staff permission)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/leaderboard/removals/{removalId}/restore": {
    post: createOperation("valorant", "Restore a removed VALORANT leaderboard player exactly as they were (reason required, audited; 409 when registered again; admin or valorant_leaderboard staff permission)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/leaderboard/players/{puuid}/hide": {
    post: createOperation("valorant", "Hide a registered VALORANT leaderboard player from the public board, search and stats; they stay registered and connected and see the reason on their profile (reason required, audited; 409 when already hidden; admin or valorant_leaderboard staff permission)", { authenticated: true }),
    delete: createOperation("valorant", "Show a hidden VALORANT leaderboard player on the public board again (reason required, audited; 409 when not hidden; admin or valorant_leaderboard staff permission)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/leaderboard/players/{puuid}/ban": {
    post: createOperation("valorant", "Ban a registered VALORANT leaderboard player's Riot and Discord accounts from registering, removing every registration either holds (reason required, audited; admin or valorant_leaderboard staff permission)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/leaderboard/removals/{removalId}/ban": {
    post: createOperation("valorant", "Ban a removed VALORANT leaderboard player's Riot and Discord accounts from registering, removing anything registered under either since (reason required, audited; 409 when already banned; admin or valorant_leaderboard staff permission)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/leaderboard/bans": {
    get: createOperation("valorant", "List VALORANT leaderboard bans, newest first: active, lifted or all (admin or valorant_leaderboard staff permission)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/leaderboard/bans/{banId}/lift": {
    post: createOperation("valorant", "Lift a VALORANT leaderboard ban so the player can register again; the ban is kept as history (reason required, audited; 409 when already lifted; admin or valorant_leaderboard staff permission)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/leaderboard/server-checks": {
    get: createOperation("valorant", "List leaderboard players the server check flags for review (mostly playing away from the Singapore/Mumbai servers, or a Riot account off the AP shard), or those already cleared (admin or valorant_leaderboard staff permission)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/leaderboard/server-checks/{puuid}/clear": {
    post: createOperation("valorant", "Keep a flagged leaderboard player; only later matches can flag them again (reason required, audited; 409 when not flagged; admin or valorant_leaderboard staff permission)", { authenticated: true }),
    delete: createOperation("valorant", "Reopen a cleared leaderboard server check (reason required, audited; 409 when not cleared; admin or valorant_leaderboard staff permission)", { authenticated: true }),
  },
  "/api/v1/admin/audit-logs": {
    get: createOperation("Admin", "List audit log entries, newest first, filtered by action, target, actor, source and date range (admin only)", { authenticated: true }),
  },
  "/api/v1/admin/audit-logs/facets": {
    get: createOperation("Admin", "List the distinct audit actions and target types with counts, for filter menus (admin only)", { authenticated: true }),
  },
  "/api/v1/admin/staff-roles": {
    get: createOperation("Admin", "List staff roles with their admin areas and member counts, plus the area catalog (admin only)", { authenticated: true }),
    post: createOperation("Admin", "Create a staff role (super admin only, audited)", { authenticated: true }),
  },
  "/api/v1/admin/staff-roles/{roleId}": {
    get: createOperation("Admin", "Get a staff role with the users who hold it (admin only)", { authenticated: true }),
    patch: createOperation("Admin", "Rename a staff role or change its colour, description or admin areas (super admin only, audited)", { authenticated: true }),
    delete: createOperation("Admin", "Delete a staff role and remove it from everyone who holds it (super admin only, audited)", { authenticated: true }),
  },
  "/api/v1/admin/users/{userId}/staff-roles": {
    get: createOperation("Admin", "List the staff roles a user holds (admin only)", { authenticated: true }),
    put: createOperation("Admin", "Replace the staff roles a user holds (super admin only, audited)", { authenticated: true }),
  },
  "/api/v1/admin/valorant/rankings": {
    get: createOperation("valorant", "List VALORANT team rankings", { authenticated: true }),
  },
  "/api/v1/admin/valorant/teams/{teamId}/rating-history": {
    get: createOperation("valorant", "Get a VALORANT team rating history", { authenticated: true }),
  },
  "/api/v1/admin/valorant/teams/{teamId}/series": {
    get: createOperation("valorant", "List a VALORANT team's series", { authenticated: true }),
  },
  "/api/v1/admin/valorant/reconciliation": {
    get: createOperation("valorant", "Get the VALORANT reconciliation report", { authenticated: true }),
  },
  "/api/v1/valorant/leaderboard": {
    get: createOperation("valorant", "List the public VALORANT player leaderboard (paginated, ELO-desc)"),
  },
  "/api/v1/valorant/leaderboard/search": {
    get: createOperation("valorant", "Search the public VALORANT player leaderboard by Riot name, tag, or name#tag"),
  },
  "/api/v1/valorant/leaderboard/register/check-puuid": {
    post: createOperation("valorant", "Check whether a PUUID is already registered for the leaderboard", { authenticated: true }),
  },
  "/api/v1/valorant/leaderboard/register/preview": {
    post: createOperation("valorant", "Preview leaderboard registration for a PUUID-only request", { authenticated: true }),
  },
  "/api/v1/valorant/leaderboard/register/submit": {
    post: createOperation("valorant", "Submit leaderboard registration for a PUUID-only request; Discord identity comes from the session", { authenticated: true }),
  },
};

module.exports = { valorantAndStaffPaths };
