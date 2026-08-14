const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const servicePath = path.join(__dirname, "../src/modules/match-rooms/match-room.service.js");
const prismaPath = path.join(__dirname, "../src/lib/prisma.js");
const notificationPath = path.join(__dirname, "../src/modules/notifications/notification.service.js");
const realtimePath = path.join(__dirname, "../src/modules/realtime/realtime.service.js");

const loadService = () => loadModuleWithMocks(servicePath, {
  [prismaPath]: { prisma: {} },
  [notificationPath]: { createNotification: async () => null },
  [realtimePath]: { publishRealtimeEvent: () => null },
});

test("room roster promotes captains and staff without duplicate memberships", () => {
  const { module: service, restore } = loadService();
  try {
    const captain = { id: "captain-1" };
    const player = { id: "player-1" };
    const match = {
      assignedStaff: { id: "staff-1" },
      tournament: { staffAssignments: [{ userId: "staff-2" }] },
      participants: [{
        slot: 1,
        registration: {
          user: captain,
          savedTeam: { captainUser: captain, members: [{ role: "PLAYER", user: player }] },
          members: [{ role: "CAPTAIN", user: player }],
        },
      }, { slot: 2, registration: null }],
    };
    const members = service.collectRoomMembers(match);
    assert.deepEqual(members.find((entry) => entry.userId === captain.id), { userId: captain.id, role: "captain", teamSlot: 1 });
    assert.deepEqual(members.find((entry) => entry.userId === player.id), { userId: player.id, role: "captain", teamSlot: 1 });
    assert.equal(members.filter((entry) => entry.userId === captain.id).length, 1);
    assert.equal(members.filter((entry) => entry.role === "staff").length, 2);
  } finally { restore(); }
});
