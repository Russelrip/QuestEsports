import { describe, expect, it } from "vitest";
import {
  buildTournamentFormData,
  initialTournamentFormValues,
} from "../../lib/admin";
import { mapTournamentToFormValues } from "../../components/admin/tournament-editor-model";
import type { Tournament } from "../../lib/tournaments";

describe("tournament admin coach settings", () => {
  it("defaults Discord identity requirement to false", () => {
    expect(initialTournamentFormValues.discordRequired).toBe(false);
  });

  it("serializes the Discord identity requirement", () => {
    expect(
      buildTournamentFormData({
        ...initialTournamentFormValues,
        discordRequired: true,
      }).get("discordRequired"),
    ).toBe("true");

    expect(
      buildTournamentFormData({
        ...initialTournamentFormValues,
        discordRequired: false,
      }).get("discordRequired"),
    ).toBe("false");
  });

  it("maps the tournament Discord identity requirement into the editor", () => {
    const values = mapTournamentToFormValues({
      title: "Discord Cup",
      slug: "discord-cup",
      game: "valorant",
      gameCategory: null,
      organizer: "Quest E-sports",
      country: "Sri Lanka",
      location: "Colombo",
      displayPriority: 100,
      shortDescription: "",
      fullDescription: "",
      rules: null,
      rulebook: null,
      registrationOpenAt: null,
      startDate: null,
      startDateStatus: "scheduled",
      endDate: null,
      endDateStatus: "scheduled",
      registrationDeadline: null,
      registrationDeadlineStatus: "scheduled",
      format: "",
      registrationMode: "open_entry",
      entryType: "team",
      series: null,
      seriesOrder: 100,
      teamSize: 5,
      minRosterSize: 5,
      maxRosterSize: 5,
      maxSubstitutes: 2,
      allowCoach: true,
      coachRequired: false,
      discordRequired: true,
      waitlistEnabled: false,
      registrationFields: [],
      paymentMethod: "free",
      registrationFee: { amount: 0, currency: "LKR" },
      registrationFeeTiers: [],
      registrationPaymentAvailable: false,
      reservationMinutes: 1440,
      bankTransferReviewMinutes: 1440,
      maxTeams: 10,
      prizePool: "",
      status: "draft",
      isPublished: false,
      showBracketPublicly: true,
      bracketLink: null,
      contactLink: null,
      isFeatured: false,
      scheduleData: null,
    } as Tournament);

    expect(values.discordRequired).toBe(true);
  });

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
