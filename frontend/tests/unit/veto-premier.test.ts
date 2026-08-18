import { describe, expect, it } from "vitest";
import { getPremierBanSlotLabel, getPremierMapPresentation } from "@/lib/veto-premier";

describe("Premier map presentation", () => {
  it("allows only the active team to ban an available map", () => {
    expect(getPremierMapPresentation(null, null, true)).toMatchObject({ disabled: false, label: "Select to ban" });
    expect(getPremierMapPresentation(null, null, false)).toMatchObject({ disabled: true, label: "Available" });
  });

  it("marks banned maps and the automatic decider distinctly", () => {
    expect(getPremierMapPresentation("ban", "B", true)).toMatchObject({ disabled: true, label: "Banned · Team B", actorLabel: "Team B", bannedBy: "B" });
    expect(getPremierMapPresentation("decider", null, false)).toMatchObject({ disabled: true, locked: true, label: "Map locked" });
  });

  it("does not expose side-selection presentation", () => {
    expect(getPremierMapPresentation("side", "A", true)).toMatchObject({ disabled: true, locked: false, label: "Available" });
  });

  it("keeps actor labels on completed ban slots", () => {
    expect(getPremierBanSlotLabel(true, false, "A")).toBe("Team A · Complete");
    expect(getPremierBanSlotLabel(true, false, "B")).toBe("Team B · Complete");
  });
});
