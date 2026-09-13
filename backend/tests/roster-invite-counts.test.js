const test = require("node:test");
const assert = require("node:assert/strict");

const { countOutstandingInvites } = require("../src/modules/teams/roster-invite-counts");

const now = new Date("2026-09-14T00:00:00.000Z");

test("counts waiting and expired invitations apart, ignoring the captain and answered ones", () => {
  assert.deepEqual(
    countOutstandingInvites(
      [
        { role: "CAPTAIN", inviteStatus: "pending" },
        { role: "PLAYER", inviteStatus: "accepted" },
        { role: "PLAYER", inviteStatus: "declined" },
        { role: "PLAYER", inviteStatus: "pending", inviteExpiresAt: new Date("2026-09-15T00:00:00.000Z") },
        { role: "COACH", inviteStatus: "expired" },
      ],
      now
    ),
    { pendingInviteCount: 1, expiredInviteCount: 1 }
  );
});

test("an invitation past its deadline is expired before the cleanup marks it", () => {
  assert.deepEqual(
    countOutstandingInvites(
      [
        { role: "COACH", inviteStatus: "pending", inviteExpiresAt: "2026-09-13T23:59:59.000Z" },
        { role: "PLAYER", inviteStatus: "pending", inviteExpiresAt: null },
      ],
      now
    ),
    { pendingInviteCount: 1, expiredInviteCount: 1 }
  );
});

test("an empty roster has nothing outstanding", () => {
  assert.deepEqual(countOutstandingInvites(undefined, now), { pendingInviteCount: 0, expiredInviteCount: 0 });
});
