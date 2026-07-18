const buildActiveRegistrationWhere = ({ now = new Date(), approvedOnly = false } = {}) => ({
  ...(approvedOnly ? { status: "approved" } : { status: { not: "rejected" } }),
  OR: [
    { paymentStatus: "paid" },
    {
      paymentStatus: "pending",
      reservedUntil: { gt: now },
    },
  ],
});

const isRegistrationActive = (registration, now = new Date()) =>
  registration.status !== "rejected" &&
  (registration.paymentStatus === "paid" ||
    (registration.paymentStatus === "pending" &&
      registration.reservedUntil &&
      new Date(registration.reservedUntil) > now));

const countTournamentCapacityUsage = async ({ tx, tournamentId, excludeRegistrationId, now = new Date() }) => {
  const [registrationCount, adminHoldCount] = await Promise.all([
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
  ]);
  return registrationCount + adminHoldCount;
};

module.exports = {
  buildActiveRegistrationWhere,
  isRegistrationActive,
  countTournamentCapacityUsage,
};
