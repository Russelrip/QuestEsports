import { describe, expect, it } from "vitest";
import { renamedTournamentSlug } from "@/lib/tournament-slug-aliases";

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
