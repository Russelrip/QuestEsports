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
    mockedRequest.mockResolvedValueOnce(unwrap({ seriesId: "s-1", status: "finalized", operationId: "op-1" }));
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

  it("sends the detach DELETE for a binding and never calls a delete on VALORANT data", async () => {
    mockedRequest.mockResolvedValueOnce(unwrap({ binding: { id: "b-1", status: "detached" } }));
    const { detachValorantBinding } = await import("../../lib/valorant-api");
    await detachValorantBinding("b-1");
    expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/teams/b-1/detach", { method: "DELETE" });
  });

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

  it("sends a manual-override body with winner and reason", async () => {
    mockedRequest.mockResolvedValueOnce(unwrap({ seriesId: "s-1", status: "finalized", operationId: "op-2" }));
    const { finalizeValorantSeries } = await import("../../lib/valorant-api");
    await finalizeValorantSeries("s-1", { ratingMode: "manual_override", officialWinnerTeamId: "val-team-1", overrideReason: "Anchor mismatch override" });
    expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/series/s-1/finalize", {
      method: "POST",
      json: { ratingMode: "manual_override", officialWinnerTeamId: "val-team-1", overrideReason: "Anchor mismatch override" },
    });
  });

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

  it("reads the reconciliation report as a read-only endpoint", async () => {
    mockedRequest.mockResolvedValueOnce(unwrap({ report: { orphaned: [], unprojected: [], teamMissing: [], matchMissing: [], stuckOperations: [] } }));
    const { fetchValorantReconciliation } = await import("../../lib/valorant-api");
    const result = await fetchValorantReconciliation();
    expect(result.report.stuckOperations).toEqual([]);
    expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/reconciliation");
  });
});
