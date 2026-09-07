const crypto = require("crypto");
const { hasAvailableCapacity } = require("./registration-eligibility");

const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const normalizeOverride = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["open", "registration_open", "force_open"].includes(normalized)) return "open";
  if (["closed", "registration_closed", "force_closed"].includes(normalized)) return "closed";
  return null;
};

const getTournamentRegistrationState = ({
  tournament = {},
  capacityUsed = 0,
  now = new Date(),
  existingRegistration = null,
} = {}) => {
  if (existingRegistration) {
    return {
      state: "already_registered",
      action: existingRegistration.status === "waitlisted" ? "waitlisted" : "registered",
      label: existingRegistration.status === "waitlisted"
        ? "You are on the waitlist"
        : "Already registered",
      canRegister: false,
      canWaitlist: false,
    };
  }

  const override = normalizeOverride(
    tournament.registrationStatusOverride || tournament.series?.registrationStatusOverride
  );
  const currentTime = new Date(now).getTime();
  const opensAt = tournament.registrationOpenAt ? new Date(tournament.registrationOpenAt).getTime() : null;
  const closesAt = tournament.registrationDeadline ? new Date(tournament.registrationDeadline).getTime() : null;
  const parentOpensAt = tournament.series?.registrationOpenAt ? new Date(tournament.series.registrationOpenAt).getTime() : null;
  const parentClosesAt = tournament.series?.registrationCloseAt ? new Date(tournament.series.registrationCloseAt).getTime() : null;
  const parentWindowOpen =
    (!parentOpensAt || parentOpensAt <= currentTime) &&
    (!parentClosesAt || parentClosesAt >= currentTime);
  const isOpen = parentWindowOpen && (override === "open" || (
    override !== "closed" &&
    tournament.isPublished !== false &&
    tournament.status === "registration_open" &&
    (!opensAt || opensAt <= currentTime) &&
    (!closesAt || closesAt >= currentTime)
  ));

  if (!isOpen) {
    return {
      state: "registration_closed",
      action: "closed",
      label: "Registration closed",
      canRegister: false,
      canWaitlist: false,
    };
  }

  if (hasAvailableCapacity(tournament, capacityUsed)) {
    return {
      state: "registration_open",
      action: "register",
      label: "Register now",
      canRegister: true,
      canWaitlist: false,
    };
  }

  if (tournament.waitlistEnabled) {
    return {
      state: "waitlist_open",
      action: "waitlist",
      label: "Join waitlist",
      canRegister: false,
      canWaitlist: true,
    };
  }

  return {
    state: "slots_full",
    action: "closed",
    label: "Registration full",
    canRegister: false,
    canWaitlist: false,
  };
};

const encodeReference = (bytes) => {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let result = "";
  for (let index = 0; index < 8; index += 1) {
    result = REFERENCE_ALPHABET[Number(value & 31n)] + result;
    value >>= 5n;
  }
  return result;
};

const buildPublicReference = () => `QES-${encodeReference(crypto.randomBytes(5))}`;

const getRegistrationPublicReference = (registration) => {
  if (registration?.publicReference) return registration.publicReference;
  const digest = crypto.createHash("sha256").update(String(registration?.id || "legacy")).digest();
  return `QES-${encodeReference(digest.subarray(0, 5))}`;
};

module.exports = {
  buildPublicReference,
  getRegistrationPublicReference,
  getTournamentRegistrationState,
};
