// Where a roster's unaccepted invitations stand, for telling a captain what is
// holding their registration up.
//
// Pending and expired are counted apart because they ask different things of
// the captain: a pending invitation is waiting on the invitee, an expired one
// is waiting on the captain to send it again. Folding expired into nothing made
// a roster that could not verify report "0 roster invitations are still
// pending".
//
// An invitation past its deadline counts as expired even while its row still
// says pending. Marking it expired is a periodic cleanup, and the captain
// should not be told to wait on an invitation nobody can accept any more.
const countOutstandingInvites = (members = [], now = new Date()) => {
  let pendingInviteCount = 0;
  let expiredInviteCount = 0;

  for (const member of members) {
    if (member.role === "CAPTAIN") continue;
    const lapsed =
      member.inviteStatus === "expired" ||
      (member.inviteStatus === "pending" &&
        member.inviteExpiresAt &&
        new Date(member.inviteExpiresAt) <= now);
    if (lapsed) expiredInviteCount += 1;
    else if (member.inviteStatus === "pending") pendingInviteCount += 1;
  }

  return { pendingInviteCount, expiredInviteCount };
};

module.exports = { countOutstandingInvites };
