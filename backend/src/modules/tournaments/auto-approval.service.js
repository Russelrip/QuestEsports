const { recordAuditInTransaction } = require("../../lib/audit");
const { snapshotAndLockRoster } = require("../game-accounts/roster-snapshot.service");

// Automatic approval for tournaments that opted out of a manual review.
//
// The manual path and this one must produce the SAME record: approval is the
// moment a roster is committed, so an auto-approved registration still gets its
// identity snapshot and its audit row. What this path deliberately does not do
// is force anything. An admin approving a team can accept its outstanding
// invitations on the team's behalf; automation cannot, because nobody decided
// to. So this only ever approves a registration with nothing left to wait on:
// the roster has verified itself and the fee, if there is one, is already
// provider-confirmed.
//
// Runs inside the caller's transaction, next to the write that made the
// registration ready, so a registration can never be left waiting for an
// approval nobody is going to perform.
const maybeAutoApproveRegistration = async ({
  tx,
  registrationId,
  requestId = null,
  ipAddress = null,
}) => {
  // Some transaction scopes are narrow client projections that cannot read a
  // registration back. Approval is an addition to whatever the caller was
  // doing, never a precondition for it, so a scope that cannot look one up
  // leaves the registration pending rather than failing the caller's write.
  if (typeof tx?.teamRegistration?.findUnique !== "function") return null;

  const registration = await tx.teamRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true,
      status: true,
      entryType: true,
      paymentStatus: true,
      verificationStatus: true,
      tournament: {
        select: { game: true, autoApproveRegistrations: true },
      },
    },
  });

  if (!registration?.tournament?.autoApproveRegistrations) return null;
  // Only a pending registration is waiting on an approval. A waitlisted or
  // rejected one is waiting on a decision, which stays with an admin.
  if (registration.status !== "pending") return null;
  if (registration.paymentStatus !== "paid") return null;
  if (registration.entryType === "team" && registration.verificationStatus !== "verified") {
    return null;
  }

  await snapshotAndLockRoster({
    tx,
    registrationId: registration.id,
    tournamentGame: registration.tournament.game,
    actorUserId: null,
    requestId,
    ipAddress,
  });

  const approved = await tx.teamRegistration.update({
    where: { id: registration.id },
    data: { status: "approved" },
  });

  await recordAuditInTransaction(tx, {
    // No actor: nobody approved this, the tournament's configuration did.
    actorUserId: null,
    action: "team_registration.status_changed",
    targetType: "TeamRegistration",
    targetId: registration.id,
    beforeData: { status: registration.status },
    afterData: { status: "approved" },
    requestId,
    ipAddress,
    source: "system",
    reason: "Approved automatically; the tournament does not review registrations.",
  });

  return approved;
};

module.exports = {
  maybeAutoApproveRegistration,
};
