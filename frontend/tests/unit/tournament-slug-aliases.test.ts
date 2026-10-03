import { describe, expect, it } from "vitest";
import { renamedTournamentPath, renamedTournamentSlug } from "@/lib/tournament-slug-aliases";

describe("renamedTournamentSlug", () => {
  it("maps a retired slug to the one that replaced it", () => {
    expect(renamedTournamentSlug("quest-acension-valorant-dm")).toBe("quest-ascension-valorant-dm");
  });

  it("leaves a slug that was never renamed alone, so it still reaches notFound", () => {
    expect(renamedTournamentSlug("quest-ascension-pubgm")).toBeNull();
  });

  it("never maps a slug onto itself, which would redirect in a loop", () => {
    expect(renamedTournamentSlug("quest-ascension-valorant-dm")).toBeNull();
  });

  it("does not inherit Object prototype keys as if they were renames", () => {
    expect(renamedTournamentSlug("constructor")).toBeNull();
    expect(renamedTournamentSlug("toString")).toBeNull();
  });
});

describe("renamedTournamentPath", () => {
  it("is null for a slug that was never renamed, so the route still 404s", () => {
    expect(renamedTournamentPath("quest-ascension-pubgm")).toBeNull();
  });

  it("builds the bare path when there is no query to carry", () => {
    expect(renamedTournamentPath("quest-acension-valorant-dm")).toBe(
      "/tournaments/quest-ascension-valorant-dm",
    );
  });

  it("keeps the sub-route segment", () => {
    expect(renamedTournamentPath("quest-acension-valorant-dm", "/register")).toBe(
      "/tournaments/quest-ascension-valorant-dm/register",
    );
  });

  it("carries the query through, so a link's state survives the redirect", () => {
    expect(renamedTournamentPath("quest-acension-valorant-dm", "", { payment: "ok" })).toBe(
      "/tournaments/quest-ascension-valorant-dm?payment=ok",
    );
  });

  it("keeps a repeated parameter's every value rather than the last one", () => {
    expect(renamedTournamentPath("quest-acension-valorant-dm", "", { tag: ["a", "b"] })).toBe(
      "/tournaments/quest-ascension-valorant-dm?tag=a&tag=b",
    );
  });

  it("escapes values rather than pasting them into the URL", () => {
    expect(renamedTournamentPath("quest-acension-valorant-dm", "", { ref: "a b&c=d" })).toBe(
      "/tournaments/quest-ascension-valorant-dm?ref=a+b%26c%3Dd",
    );
  });

  it("adds no question mark for an empty or all-undefined query", () => {
    expect(renamedTournamentPath("quest-acension-valorant-dm", "", {})).toBe(
      "/tournaments/quest-ascension-valorant-dm",
    );
    expect(renamedTournamentPath("quest-acension-valorant-dm", "", { payment: undefined })).toBe(
      "/tournaments/quest-ascension-valorant-dm",
    );
  });
});
