import { describe, expect, it } from "vitest";
import { mapSavedTeamToRegistrationDraft } from "../../lib/teams";

describe("saved team registration mapping", () => {
  it("hydrates a saved coach separately while preserving player and substitute members", () => {
    const draft = mapSavedTeamToRegistrationDraft({
      members: [
        { id: "captain", role: "CAPTAIN", memberOrder: 0, name: "Captain", email: "captain@example.com", inviteStatus: "accepted" },
        { id: "player", role: "PLAYER", memberOrder: 1, name: "Player", email: "player@example.com", phone: null, discord: "player-discord", riotId: "Player#001", inviteStatus: "accepted" },
        { id: "substitute", role: "SUBSTITUTE", memberOrder: 1, name: "Substitute", email: "substitute@example.com", phone: null, discord: "sub-discord", riotId: "Sub#001", inviteStatus: "pending" },
        { id: "coach", role: "COACH", memberOrder: 1, name: "Coach", email: "coach@example.com", phone: "0771111111", discord: "coach-discord", riotId: "Coach#001", inviteStatus: "accepted" },
      ],
    });

    // The saved team still carries the handle it was registered with, but the
    // draft deliberately drops it: a re-registration resolves every roster
    // Discord from connected accounts rather than replaying a stored string.
    expect(draft.coach).toEqual({
      name: "Coach",
      email: "coach@example.com",
      phone: "0771111111",
      gameId: "Coach#001",
    });
    expect(draft.coachSelected).toBe(true);
    expect(draft.members).toHaveLength(2);
    expect(draft.members.map((member) => member.role)).toEqual(["PLAYER", "SUBSTITUTE"]);
    expect(draft.members.some((member) => member.name === "Coach")).toBe(false);
  });
});
