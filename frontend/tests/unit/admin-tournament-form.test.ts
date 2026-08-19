import { describe, expect, it } from "vitest";
import {
  buildTournamentFormData,
  initialTournamentFormValues,
} from "../../lib/admin";

describe("tournament admin coach settings", () => {
  it("serializes both coach settings in multipart submissions", () => {
    const enabled = buildTournamentFormData({
      ...initialTournamentFormValues,
      allowCoach: true,
      coachRequired: true,
    });
    expect(enabled.get("allowCoach")).toBe("true");
    expect(enabled.get("coachRequired")).toBe("true");

    const disabled = buildTournamentFormData({
      ...initialTournamentFormValues,
      allowCoach: false,
      coachRequired: false,
    });
    expect(disabled.get("allowCoach")).toBe("false");
    expect(disabled.get("coachRequired")).toBe("false");
  });

  it("serializes the tournament-level public bracket visibility setting", () => {
    expect(initialTournamentFormValues.showBracketPublicly).toBe(true);
    expect(
      buildTournamentFormData(initialTournamentFormValues).get("showBracketPublicly"),
    ).toBe("true");

    const hidden = {
      ...initialTournamentFormValues,
      showBracketPublicly: false,
    };
    expect(buildTournamentFormData(hidden).get("showBracketPublicly")).toBe("false");
  });
});
