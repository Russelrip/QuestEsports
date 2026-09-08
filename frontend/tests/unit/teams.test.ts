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

    // The saved team is who is on it. An older one may still carry a handle or
    // a game id somebody typed into a previous version of the roster form, and
    // the draft deliberately drops both: a Discord handle is resolved from the
    // player's connected account at submission, and a game id belongs to the
    // tournament that asked for it. Replaying one would arrive as a wrong
    // answer already filled in the next time this roster enters a different
    // game — and a wrong value somebody has to notice is worse than a blank
    // field they have to fill.
    expect(draft.coach).toEqual({
      name: "Coach",
      email: "coach@example.com",
      phone: "",
      gameId: "",
    });
    expect(draft.coachSelected).toBe(true);
    expect(draft.members).toHaveLength(2);
    expect(draft.members.map((member) => member.role)).toEqual(["PLAYER", "SUBSTITUTE"]);
    expect(draft.members.map((member) => member.gameId)).toEqual(["", ""]);
    expect(draft.members.some((member) => member.name === "Coach")).toBe(false);
  });
});
