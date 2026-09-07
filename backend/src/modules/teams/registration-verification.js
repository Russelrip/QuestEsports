const { maybeAutoApproveRegistration } = require("../tournaments/auto-approval.service");

// Recomputed from the invitations themselves rather than tracked alongside them,
// so the roster's state cannot drift from the answers it is made of.
//
// Shared because two callers settle an invitation: the captain-side roster
// writes in `team.service.js`, and the invitee answering in
// `invitation.service.js`. Keeping one implementation is what stops "verified"
// from meaning two slightly different things depending on who moved last.
const refreshRegistrationVerificationStatus = async ({ tx, registrationId }) => {
  const members = await tx.registrationMember.findMany({
    where: { registrationId, role: { not: "CAPTAIN" } },
    select: { inviteStatus: true },
  });
  // An invitation that ran out of time is outstanding, not settled: the roster
  // is no more confirmed than it was while the deadline was still running.
  const verificationStatus = members.some((member) => member.inviteStatus === "declined")
    ? "flagged"
    : members.every((member) => member.inviteStatus === "accepted")
      ? "verified"
      : "pending";

  await tx.teamRegistration.update({
    where: { id: registrationId },
    data: { verificationStatus },
  });

  if (verificationStatus === "verified") {
    // The last outstanding invitation was the only thing this registration was
    // waiting on. A tournament that does not review registrations approves it
    // here; one that does is left untouched.
    await maybeAutoApproveRegistration({ tx, registrationId });
  }

  return verificationStatus;
};

module.exports = { refreshRegistrationVerificationStatus };
