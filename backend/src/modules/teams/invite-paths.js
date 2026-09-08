const { env } = require("../../config/env");

// Where an invitation is found, and the reference that points at one.
//
// The reference is a routing hint and nothing else. No endpoint accepts it as
// authority, it names neither the team nor the invitee, and it is not enough to
// read anything: signed out it reaches a page of generic onboarding
// instructions, and signed in it only decides which of the invitations that
// already belong to that account gets scrolled to. That is what makes it safe
// to forward — which matters, because forwarding is exactly what will happen to
// it. It is a link a captain pastes into whatever chat they already share.
//
// Kept in its own module because both notice channels need it and one of them
// requires the other.

const INVITATIONS_PATH = "/profile?tab=invitations";
const ONBOARDING_PATH = "/team-invite";
const MEMBER_REFERENCE_PARAM = "member";

const invitationsPath = (invitationId) =>
  invitationId
    ? `${INVITATIONS_PATH}&${MEMBER_REFERENCE_PARAM}=${encodeURIComponent(invitationId)}`
    : INVITATIONS_PATH;

const onboardingPath = (invitationId) =>
  invitationId
    ? `${ONBOARDING_PATH}?${MEMBER_REFERENCE_PARAM}=${encodeURIComponent(invitationId)}`
    : ONBOARDING_PATH;

// The one a captain copies and sends. It starts at the onboarding page because
// the person who needs it is usually the person who has no Quest account yet,
// and the invitations tab would only bounce them to a login they were given no
// explanation for.
const buildInvitationUrl = (invitationId) =>
  `${env.APP_URL || "https://questesports.lk"}${
    invitationId ? onboardingPath(invitationId) : INVITATIONS_PATH
  }`;

module.exports = {
  INVITATIONS_PATH,
  ONBOARDING_PATH,
  MEMBER_REFERENCE_PARAM,
  invitationsPath,
  onboardingPath,
  buildInvitationUrl,
};
