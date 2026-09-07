import { describe, expect, it } from "vitest";
import {
  emptyCoachDraft,
  getCoachPayload,
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
      gameId: "CoachIGN",
    }, true)).toBe("");
  });

  it("requires a complete coach when an optional coach is selected", () => {
    expect(getCoachValidationMessage(emptyCoachDraft, false, true)).toBe(
      "Complete all coach details."
    );
    expect(getCoachValidationMessage({ ...emptyCoachDraft, name: "Coach" }, false, true)).toBe(
      "Complete all coach details."
    );
  });

  it("does not create a coach payload unless the allowed opt-in is complete", () => {
    expect(getCoachPayload(emptyCoachDraft, false, true)).toBeNull();
    expect(getCoachPayload(emptyCoachDraft, true, false)).toBeNull();
    expect(getCoachPayload({ ...emptyCoachDraft, name: "Coach" }, true, true)).toBeNull();
    expect(getCoachPayload({
      name: " Coach ",
      email: "coach@example.com",
      phone: "+94770000000",
      gameId: "CoachIGN",
    }, true, true)).toEqual({
      name: "Coach",
      email: "coach@example.com",
      phone: "+94770000000",
      gameId: "CoachIGN",
    });
  });
});
