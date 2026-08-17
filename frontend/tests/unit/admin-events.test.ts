import { describe, expect, it } from "vitest";
import { buildAdminEventFormData, getAdminEventArchiveLabel, getAdminEventStatusLabel, initialAdminEventFormValues } from "../../lib/admin";
import { buildTournamentFormData, initialTournamentFormValues } from "../../lib/admin";

describe("admin event form", () => {
  it("has safe draft defaults and serializes dates and booleans", () => {
    expect(initialAdminEventFormValues.isPublished).toBe(false);
    const body = buildAdminEventFormData({ ...initialAdminEventFormValues, title: "Quest Ascension", startDate: "2026-09-01T10:00" });
    expect(body.get("title")).toBe("Quest Ascension");
    expect(body.get("isPublished")).toBe("false");
    expect(body.get("startDate")).toBe("2026-09-01T04:30:00.000Z");
  });
  it("uses clear archive and status labels", () => {
    expect(getAdminEventArchiveLabel("Quest Ascension")).toBe("Archive Quest Ascension");
    expect(getAdminEventStatusLabel("open")).toBe("Open");
    expect(getAdminEventStatusLabel("draft")).toBe("Draft");
  });
  it("serializes waitlist settings with the existing tournament multipart fields", () => {
    const body = buildTournamentFormData({ ...initialTournamentFormValues, waitlistEnabled: true });
    expect(body.get("waitlistEnabled")).toBe("true");
  });
});
