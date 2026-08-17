const buildActiveRegistrationWhere = ({ now = new Date(), approvedOnly = false } = {}) => ({
  ...(approvedOnly
    ? { status: "approved" }
    : { status: { notIn: ["rejected", "waitlisted"] } }),
  OR: [
    { paymentStatus: "paid" },
    {
      paymentStatus: "pending",
      reservedUntil: { gt: now },
    },
  ],
});

const isRegistrationActive = (registration, now = new Date()) =>
  !["rejected", "waitlisted"].includes(registration.status) &&
  (registration.paymentStatus === "paid" ||
    (registration.paymentStatus === "pending" &&
      registration.reservedUntil &&
      new Date(registration.reservedUntil) > now));

const allocateLowestAvailableSlot = async ({
  tx,
  tournamentId,
  maxTeams,
  excludeRegistrationId,
  now = new Date(),
}) => {
  const [activeRegistrations, adminHolds] = await Promise.all([
    tx.teamRegistration.findMany({
      where: {
        tournamentId,
        ...(excludeRegistrationId ? { id: { not: excludeRegistrationId } } : {}),
        assignedSlotNumber: { not: null },
        ...buildActiveRegistrationWhere({ now }),
      },
      select: { assignedSlotNumber: true },
    }),
    tx.adminSlotReservation?.findMany
      ? tx.adminSlotReservation.findMany({
          where: {
            tournamentId,
            ...(excludeRegistrationId
              ? { registrationId: { not: excludeRegistrationId } }
              : {}),
          },
          select: { assignedSlotNumber: true },
        })
      : Promise.resolve([]),
  ]);
  const usedSlots = new Set(
    [...activeRegistrations, ...adminHolds]
      .map((entry) => entry.assignedSlotNumber)
      .filter(Number.isInteger)
  );
  for (let slotNumber = 1; slotNumber <= maxTeams; slotNumber += 1) {
    if (!usedSlots.has(slotNumber)) return slotNumber;
  }
  throw new HttpError(409, "Registration slots are full.");
};

const countTournamentCapacityUsage = async ({ tx, tournamentId, excludeRegistrationId, now = new Date() }) => {
  const [registrationCount, adminHoldCount, activeHeldRegistrationCount] = await Promise.all([
    tx.teamRegistration.count({
      where: {
        tournamentId,
        ...(excludeRegistrationId ? { id: { not: excludeRegistrationId } } : {}),
        ...buildActiveRegistrationWhere({ now }),
      },
    }),
    tx.adminSlotReservation?.count ? tx.adminSlotReservation.count({
      where: {
        tournamentId,
        ...(excludeRegistrationId ? { registrationId: { not: excludeRegistrationId } } : {}),
      },
    }) : Promise.resolve(0),
    tx.teamRegistration.count({
      where: {
        tournamentId,
        ...(excludeRegistrationId ? { id: { not: excludeRegistrationId } } : {}),
        adminSlotReservation: { isNot: null },
        ...buildActiveRegistrationWhere({ now }),
      },
    }),
  ]);
  return registrationCount + adminHoldCount - activeHeldRegistrationCount;
};

const getNextWaitlistPosition = async ({ tx, tournamentId }) => {
  const latest = await tx.teamRegistration.findFirst({
    where: { tournamentId, status: "waitlisted" },
    orderBy: { waitlistPosition: "desc" },
    select: { waitlistPosition: true },
  });
  return (latest?.waitlistPosition || 0) + 1;
};

const compactWaitlistPositions = async ({ tx, tournamentId, position }) => {
  if (!Number.isInteger(position)) return;
  await tx.teamRegistration.updateMany({
    where: {
      tournamentId,
      status: "waitlisted",
      waitlistPosition: { gt: position },
    },
    data: { waitlistPosition: { decrement: 1 } },
  });
};

module.exports = {
  allocateLowestAvailableSlot,
  buildActiveRegistrationWhere,
  isRegistrationActive,
  countTournamentCapacityUsage,
  getNextWaitlistPosition,
  compactWaitlistPositions,
};
const { HttpError } = require("../../lib/http-error");
