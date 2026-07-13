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

module.exports = {
  buildActiveRegistrationWhere,
  isRegistrationActive,
};
