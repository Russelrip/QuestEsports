import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("VALORANT admin UI boundaries", () => {
  it("registers the VALORANT navigation group as a single management entry", () => {
    const lib = read("lib/admin.ts");
    expect(lib).toContain('label: "VALORANT"');
    expect(lib).toContain('label: "Valorant Management"');
    expect(lib).toContain('{ href: "/admin/valorant"');
    expect(lib).not.toContain('href: "/admin/valorant/teams"');
    expect(lib).not.toContain('href: "/admin/valorant/discover"');
    expect(lib).not.toContain('href: "/admin/valorant/series"');
    expect(lib).not.toContain('href: "/admin/valorant/rankings"');
    expect(lib).not.toContain('href: "/admin/valorant/reconciliation"');
  });

  it("never references the FastAPI service or Henrik from the frontend", () => {
    const files = [
      "lib/valorant.ts",
      "lib/valorant-api.ts",
      "components/admin/valorant/ValorantManagementPage.tsx",
      "components/admin/valorant/ValorantStatusBadge.tsx",
      "components/admin/valorant/ValorantOperationBanner.tsx",
      "components/admin/valorant/ValorantErrorAlert.tsx",
      "components/admin/valorant/ValorantEmptyState.tsx",
      "components/admin/valorant/ValorantLoadingState.tsx",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/localhost:8000|valorant-platform-backend|api\.henrikdev|X-Admin-Key|VALORANT_SERVICE_SECRET/);
    }
  });

  it("bind form batch-binds unbound SavedTeams via checkboxes and the grid only shows active bindings", () => {
    const teamsManager = read("components/admin/valorant/ValorantTeamsManager.tsx");
    const bindingForm = read("components/admin/valorant/ValorantBindingForm.tsx");
    expect(teamsManager).toContain("useAdminTeams");
    expect(teamsManager).not.toContain("useTeams");
    expect(teamsManager).toContain('status === "active"');
    expect(teamsManager).toContain(".filter(");
    expect(bindingForm).toContain('type="checkbox"');
    expect(bindingForm).toContain("Bind selected");
    expect(bindingForm).toContain("bindValorantTeam");
    expect(bindingForm).toContain("<fieldset");
    expect(bindingForm).toContain("<legend");
    expect(bindingForm).toContain("Saved team to bind");
    expect(bindingForm).toContain("All of your SavedTeams are already bound.");
    expect(teamsManager).toContain("Detach binding");
    expect(teamsManager).toContain("Detaching never deletes VALORANT teams, series, or rating history.");
    expect(teamsManager).not.toContain("Re-activate");
  });

  it("shows loading, empty, and error states on the teams screen", () => {
    const manager = read("components/admin/valorant/ValorantTeamsManager.tsx");
    expect(manager).toContain("ValorantLoadingState");
    expect(manager).toContain("ValorantEmptyState");
    expect(manager).toContain("ValorantErrorAlert");
  });

  it("inline discovery in the series detail attaches candidates via matchId or an import, never labeling sides Red/Blue", () => {
    const detail = read("components/admin/valorant/ValorantSeriesDetail.tsx");
    expect(detail).toContain("discoverValorant");
    expect(detail).toContain("importValorantMatch");
    expect(detail).toContain("attachValorantGame");
    expect(detail).toContain("nextGameNumber");
    expect(detail).not.toContain("Red");
    expect(detail).not.toContain("Blue");
  });

  it("series create form covers BO1/BO3/BO5, playedAt, Rated/Unrated preference, and per-team anchor dropdowns from roster members", () => {
    const form = read("components/admin/valorant/ValorantSeriesForm.tsx");
    for (const value of ["bo1", "bo3", "bo5"]) expect(form).toContain(value);
    expect(form).toContain('type="datetime-local"');
    expect(form).toContain("ratingModePreference");
    expect(form).toContain('value="normal"');
    expect(form).toContain('value="unrated"');
    expect(form).toContain("Anchor player A");
    expect(form).toContain("Anchor player B");
    expect(form).toContain("fetchAdminTeamMembers");
    expect(form).toContain('id="anchor-player-a"');
    expect(form).toContain('id="anchor-player-b"');
    expect(form).toContain("{member.name} — {member.riotId}");
    expect(form).toContain("parseStoredRiotId");
    expect(form).toContain("anchorPlayerA: anchorA");
    expect(form).toContain("anchorPlayerB: anchorB");
    expect(form).toContain('id="series-tournament"');
    expect(form).toContain("No tournament");
    expect(form).toContain("tournamentId");
    expect(form).toContain("tournamentId: tournamentId || null");
    expect(form).toContain("useAdminTournamentOptions");
    expect(form).not.toContain("parseRiotIdInput");
    expect(form).not.toContain("Name#Tag");
    expect(form).toContain("Both teams must have an active VALORANT binding");
  });

  it("series list shows status, format, teams, tournament column, and a client-side tournament filter", () => {
    const manager = read("components/admin/valorant/ValorantSeriesManager.tsx");
    expect(manager).toContain("New series");
    expect(manager).toContain("ValorantStatusBadge");
    expect(manager).toContain("onCreateSeries");
    expect(manager).toContain("onViewSeries");
    expect(manager).toContain("formatAdminCompactDateTime");
    expect(manager).toContain('>Tournament</th>');
    expect(manager).toContain('item.tournament?.title ?? "—"');
    expect(manager).toContain('aria-label="Filter by tournament"');
    expect(manager).toContain("All tournaments");
    expect(manager).toContain("filteredSeries");
  });

  it("reorder control submits the full absolute desired order and validates a permutation", () => {
    const control = read("components/admin/valorant/ValorantReorderControl.tsx");
    const detail = read("components/admin/valorant/ValorantSeriesDetail.tsx");
    expect(control).toContain("validateDesiredOrder");
    expect(control).toContain("Save order");
    expect(control).toContain("mapName");
    expect(control).toContain("Unknown map");
    expect(control).toContain('aria-label="Map position');
    expect(detail).toContain("setValorantGameOrder");
  });

  it("game rows show team labels and a draft-only remove", () => {
    const row = read("components/admin/valorant/ValorantGameRow.tsx");
    const detail = read("components/admin/valorant/ValorantSeriesDetail.tsx");
    expect(row).toContain("teamALabel");
    expect(row).toContain("teamBLabel");
    expect(row).toContain("Remove");
    expect(row).not.toContain("Red");
    expect(row).not.toContain("Blue");
    expect(detail).toContain("removeValorantGame");
  });

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
    const form = read("components/admin/valorant/ValorantFinalizeForm.tsx");
    expect(detail).toContain("Re-check status");
    expect(detail).toContain("never retries automatically");
    expect(form).toContain("SERIES_ALREADY_FINALIZED");
    expect(form).toContain("ANCHOR_MISMATCH");
    expect(form).toContain("BACKDATED_SERIES_REJECTED");
  });

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
    expect(panel).toContain("useValorantRatingHistory");
    expect(panel).toContain("useValorantTeamSeries");
    expect(panel).toContain("formatEloDelta");
    expect(panel).toContain("calculationDetails");
    expect(panel).toContain("No rating events yet");
  });

  it("reconciliation page surfaces every report class as read-only", () => {
    const manager = read("components/admin/valorant/ValorantReconciliationManager.tsx");
    expect(manager).toContain("useValorantReconciliation");
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
    for (const status of ["draft", "finalized", "reconciliation_required"]) {
      expect(detail).toContain(status);
    }
    expect(badge).toContain("operationStatusLabel");
    expect(badge).toContain("seriesStatusLabel");
    expect(badge).not.toContain("finalizing");
  });

  it("every VALORANT manager ships loading, empty, and error surfaces", () => {
    for (const file of [
      "ValorantTeamsManager.tsx",
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
    const page = read("components/admin/valorant/ValorantManagementPage.tsx");
    expect(page).toContain("<AdminShell");
    expect(page).toContain('role="tablist"');
    expect(page).toContain('role="tabpanel"');
    for (const file of [
      "ValorantTeamsManager.tsx",
      "ValorantSeriesManager.tsx",
      "ValorantSeriesDetail.tsx",
      "ValorantRankingsManager.tsx",
      "ValorantReconciliationManager.tsx",
      "ValorantManagementPage.tsx",
    ]) {
      const source = read(`components/admin/valorant/${file}`);
      expect(source, file).toContain("min-w-0");
      expect(source, file).toMatch(/overflow-x-auto|md:grid-cols-2|lg:grid-cols-2|xl:grid-cols-3|flex-wrap/);
    }
  });

  it("never calls the platform directly from any VALORANT component", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync } = require("node:fs");
    const dir = resolve(process.cwd(), "components/admin/valorant");
    for (const file of readdirSync(dir)) {
      const source = read(`components/admin/valorant/${file}`);
      expect(source, file).not.toMatch(/localhost:8000|valorant-platform-backend|api\.henrikdev|X-Admin-Key|VALORANT_SERVICE_SECRET|window\.fetch/);
    }
  });
});
