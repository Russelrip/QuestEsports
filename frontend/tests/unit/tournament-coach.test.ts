import { describe, expect, it } from "vitest";
import {
  emptyCoachDraft,
  getCoachValidationMessage,
  isCoachEmpty,
} from "../../lib/tournament-coach";

describe("tournament coach validation", () => {
  it("accepts an empty optional coach and identifies the empty draft", () => {
    expect(isCoachEmpty(emptyCoachDraft)).toBe(true);
    expect(getCoachValidationMessage(emptyCoachDraft, false)).toBe("");
  });

  it("requires every field for a partially populated coach", () => {
    expect(getCoachValidationMessage({ ...emptyCoachDraft, name: "Coach" }, false)).toBe(
      "Complete all coach details or leave the coach section empty."
    );
  });

  it("requires every field when the tournament requires a coach", () => {
    expect(getCoachValidationMessage(emptyCoachDraft, true)).toBe(
      "A coach is required. Complete all coach details."
    );
  });

  it("accepts a complete coach", () => {
    expect(getCoachValidationMessage({
      name: "Coach",
      email: "coach@example.com",
      phone: "+94770000000",
      discord: "coach#1234",
      gameId: "CoachIGN",
    }, true)).toBe("");
  });
});
