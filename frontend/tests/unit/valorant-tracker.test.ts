import { describe, expect, it } from "vitest";
import { buildValorantTrackerProfileUrl } from "../../lib/valorant";

describe("buildValorantTrackerProfileUrl", () => {
  it("encodes the complete Riot ID as one Tracker path segment", () => {
    expect(buildValorantTrackerProfileUrl("Jiren Prime", "JAANU"))
      .toBe("https://tracker.gg/valorant/profile/riot/Jiren%20Prime%23JAANU/overview");
  });

  it("trims Riot ID components before building the profile URL", () => {
    expect(buildValorantTrackerProfileUrl(" Jiren Prime ", " JAANU "))
      .toBe(buildValorantTrackerProfileUrl("Jiren Prime", "JAANU"));
  });

  it("encodes unicode and reserved characters", () => {
    expect(buildValorantTrackerProfileUrl("A/B", "täg"))
      .toBe("https://tracker.gg/valorant/profile/riot/A%2FB%23t%C3%A4g/overview");
  });

  it("returns null when either Riot ID component is empty", () => {
    expect(buildValorantTrackerProfileUrl("", "TAG")).toBeNull();
    expect(buildValorantTrackerProfileUrl("Name", " ")).toBeNull();
  });
});
