import { afterEach, describe, expect, it, vi } from "vitest";
import { adminRequest } from "../../lib/admin";
import { fetchApiJson } from "../../lib/api";

vi.mock("../../lib/admin", () => ({ adminRequest: vi.fn() }));
const mockedRequest = vi.mocked(adminRequest);

vi.mock("../../lib/api", () => ({
  fetchApiJson: vi.fn(),
  buildApiUrl: (path: string) => path,
}));
const mockedFetchApiJson = vi.mocked(fetchApiJson);

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

  it("returns series-scoped matches as camelCase from the BFF", async () => {
    mockedRequest.mockResolvedValueOnce(unwrap({
      matches: [
        { matchId: "m-1", henrikMatchId: "h-1", affinity: "eu", platform: "pc", mapName: "Ascent", startedAt: "2026-08-01T14:30:00Z", isCompleted: true, redScore: 13, blueScore: 8, winningSide: "red", anchorASide: "blue" },
      ],
    }));
    const { fetchValorantSeriesMatches } = await import("../../lib/valorant-api");
    const result = await fetchValorantSeriesMatches("series-1");
    expect(result.matches[0].matchId).toBe("m-1");
    expect(result.matches[0].anchorASide).toBe("blue");
    expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/series/series-1/matches");
  });

  it("attaches without teamASide when the backend derives it from anchors", async () => {
    mockedRequest.mockResolvedValueOnce(unwrap({ game: { id: "game-1", teamASide: "red", teamBSide: "blue" } }));
    const { attachValorantGame } = await import("../../lib/valorant-api");
    await attachValorantGame("quest-series-1", { gameNumber: 2, matchId: "val-match-1" });
    expect(mockedRequest).toHaveBeenCalledWith("/api/v1/admin/valorant/series/quest-series-1/games", {
      method: "POST", json: { gameNumber: 2, matchId: "val-match-1" },
    });
  });
});

describe("VALORANT public leaderboard API client", () => {
  it("fetches the paginated leaderboard via the public proxy", async () => {
    mockedFetchApiJson.mockResolvedValueOnce({
      success: true,
      data: { entries: [], total: 0, page: 2, perPage: 25, totalPages: 1 },
    } as never);
    const { fetchPublicValorantLeaderboard } = await import("../../lib/valorant-api");
    const result = await fetchPublicValorantLeaderboard(2, 25);
    expect(result.entries).toEqual([]);
    expect(result.perPage).toBe(25);
    expect(mockedFetchApiJson).toHaveBeenCalledWith(
      "/api/v1/valorant/leaderboard?page=2&per_page=25",
      { next: { revalidate: 60 } },
      "Leaderboard request failed.",
    );
  });

  it("search unwraps the ranked entries from the envelope", async () => {
    mockedFetchApiJson.mockResolvedValueOnce({
      success: true,
      data: {
        entries: [
          { puuid: "p-1", name: "Sahan", tag: "QST", rank: 4 },
          { puuid: "p-2", name: "Sahani", tag: "LKA", rank: 12 },
        ],
      },
    } as never);
    const { searchPublicValorantLeaderboard } = await import("../../lib/valorant-api");
    const result = await searchPublicValorantLeaderboard("sahan", 10);
    expect(result.map((entry) => entry.puuid)).toEqual(["p-1", "p-2"]);
    expect(result[0].rank).toBe(4);
    expect(mockedFetchApiJson).toHaveBeenCalledWith(
      "/api/v1/valorant/leaderboard/search?q=sahan&limit=10",
      { next: { revalidate: 60 } },
      "Leaderboard request failed.",
    );
  });

  it("search returns an empty list when the envelope carries no entries", async () => {
    mockedFetchApiJson.mockResolvedValueOnce({ success: true, data: {} } as never);
    const { searchPublicValorantLeaderboard } = await import("../../lib/valorant-api");
    expect(await searchPublicValorantLeaderboard("nobody")).toEqual([]);
  });
});

describe("VALORANT registration API client", () => {
  const jsonResponse = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  afterEach(() => vi.unstubAllGlobals());

  it("requests the Discord login URL via the public register endpoint", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { url: "https://discord.com/oauth2/authorize?..." }, meta: { serverNow: "2026-08-15T00:00:00.000Z" } }));
    vi.stubGlobal("fetch", mockFetch);
    const { requestDiscordLogin } = await import("../../lib/valorant-api");
    const result = await requestDiscordLogin();
    expect(result.url).toBe("https://discord.com/oauth2/authorize?...");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/valorant/leaderboard/register/discord/login",
      {},
    );
  });

  it("exchanges the OAuth code via the callback endpoint", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { user: { discord_id: "1" }, exists: false, existing_data: null }, meta: { serverNow: "2026-08-15T00:00:00.000Z" } }));
    vi.stubGlobal("fetch", mockFetch);
    const { requestDiscordCallback } = await import("../../lib/valorant-api");
    const result = await requestDiscordCallback("abc123");
    expect(result.exists).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/valorant/leaderboard/register/discord/callback?code=abc123",
      {},
    );
  });

  it("posts the PUUID check with a JSON body", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { exists: true, user: { name: "Sahan", tag: "QST", discord_username: "sahan" } }, meta: { serverNow: "2026-08-15T00:00:00.000Z" } }));
    vi.stubGlobal("fetch", mockFetch);
    const { checkPuuidRegistered } = await import("../../lib/valorant-api");
    const result = await checkPuuidRegistered("p-1");
    expect(result.exists).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/valorant/leaderboard/register/check-puuid",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ puuid: "p-1" }),
      },
    );
  });

  it("posts the preview request and returns the snake_case player data", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: { puuid: "p-1", name: "Sahan", tag: "QST", current_rank: "Diamond 2", elo: 1850, peak_rank: "Ascendant 1", peak_season: "EP 9 ACT 1", last_played: "2026-08-01T14:30:00Z" }, meta: { serverNow: "2026-08-15T00:00:00.000Z" } }),
    );
    vi.stubGlobal("fetch", mockFetch);
    const { previewValorantRegistration } = await import("../../lib/valorant-api");
    const result = await previewValorantRegistration("p-1");
    expect(result.current_rank).toBe("Diamond 2");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/valorant/leaderboard/register/preview",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ puuid: "p-1" }),
      },
    );
  });

  it("submits registration with the discord id, username, and puuid", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { success: true, message: "Registered", player: { puuid: "p-1", name: "Sahan", tag: "QST" } }, meta: { serverNow: "2026-08-15T00:00:00.000Z" } }));
    vi.stubGlobal("fetch", mockFetch);
    const { submitValorantRegistration } = await import("../../lib/valorant-api");
    const result = await submitValorantRegistration({ discord_id: "12345", discord_username: "sahan", puuid: "p-1" });
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/valorant/leaderboard/register/submit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discord_id: "12345", discord_username: "sahan", puuid: "p-1" }),
      },
    );
  });

  it("preserves a Discord snowflake as an exact string beyond Number.MAX_SAFE_INTEGER", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: { success: true, message: "Registered", player: { puuid: "p-1", name: "Sahan", tag: "QST" } }, meta: { serverNow: "2026-08-15T00:00:00.000Z" } }));
    vi.stubGlobal("fetch", mockFetch);
    const { submitValorantRegistration } = await import("../../lib/valorant-api");
    const discordId = "1134567890123456789";

    await submitValorantRegistration({ discord_id: discordId, discord_username: "sahan", puuid: "p-1" });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/valorant/leaderboard/register/submit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discord_id: discordId, discord_username: "sahan", puuid: "p-1" }),
      },
    );
  });

  it("throws with the HTTP status on a 409 conflict so the client can branch", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: false, message: "Player already registered", error: "conflict", meta: {} }, 409));
    vi.stubGlobal("fetch", mockFetch);
    const { submitValorantRegistration } = await import("../../lib/valorant-api");
    await expect(
      submitValorantRegistration({ discord_id: "1", discord_username: "sahan", puuid: "p-1" }),
    ).rejects.toMatchObject({ status: 409, message: "Player already registered" });
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("Service Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", mockFetch);
    const { previewValorantRegistration } = await import("../../lib/valorant-api");
    await expect(previewValorantRegistration("p-1")).rejects.toMatchObject({
      status: 503,
      message: "Request failed with status 503.",
    });
  });
});
