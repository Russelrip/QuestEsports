import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("keeps the lightweight candidate type free of winningSide and roster", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/valorant.ts"), "utf8");
    const candidateType = source.slice(source.indexOf("export type MatchCandidate"), source.indexOf("export type MatchPlayer"));
    expect(candidateType).not.toContain("winningSide");
    expect(candidateType).not.toContain("roster");
    expect(candidateType).toContain("alreadyImported");
  });

  it("labels every rating mode for the finalize UX", () => {
    expect(ratingModeLabel("normal")).toBe("Rated");
    expect(ratingModeLabel("unrated")).toBe("Unrated");
    expect(ratingModeLabel("forfeit_no_rating")).toBe("Forfeit — no rating");
    expect(ratingModeLabel("forfeit_result_only")).toBe("Forfeit — result only");
    expect(ratingModeLabel("manual_override")).toBe("Manual override");
    expect(ratingModeLabel(null)).toBe("Not set");
  });
});
