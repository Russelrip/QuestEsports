const test = require("node:test");
const assert = require("node:assert/strict");

const {
  allocateLowestAvailableSlot,
  countTournamentCapacityUsage,
} = require("../src/modules/tournaments/registration-eligibility");

test("slot allocation treats active registrations and private admin holds as occupied", async () => {
  const slot = await allocateLowestAvailableSlot({
    tx: {
      teamRegistration: {
        findMany: async () => [
          { assignedSlotNumber: 1 },
          { assignedSlotNumber: 3 },
        ],
      },
      adminSlotReservation: {
        findMany: async () => [{ assignedSlotNumber: 2 }],
      },
    },
    tournamentId: "tournament-1",
    maxTeams: 5,
  });
  assert.equal(slot, 4);
});

test("capacity does not count an active registration and its stale hold twice", async () => {
  const counts = [];
  const usage = await countTournamentCapacityUsage({
    tx: {
      teamRegistration: {
        count: async ({ where }) => {
          counts.push(where);
          return where.adminSlotReservation ? 1 : 4;
        },
      },
      adminSlotReservation: { count: async () => 2 },
    },
    tournamentId: "tournament-1",
  });
  assert.equal(usage, 5);
  assert.equal(counts.length, 2);
});
