// Where an invitation is found, and the reference that points at one.
//
// The reference is a routing hint and nothing else. No endpoint accepts it as
// authority, it names neither the team nor the invitee, and it is not enough to
// read anything: signed out it reaches a page of generic onboarding
// instructions, and signed in it only decides which of the invitations that
// already belong to that account gets scrolled to.
//
// That is what makes it safe to forward — which matters, because forwarding is
// exactly what will happen to it. It is a link a captain pastes into whatever
// chat they already share with the person they are waiting on.

export const MEMBER_REFERENCE_PARAM = "member";
export const INVITATIONS_PATH = "/profile?tab=invitations";
export const ONBOARDING_PATH = "/team-invite";

export function invitationsPath(memberReference?: string | null): string {
  return memberReference
    ? `${INVITATIONS_PATH}&${MEMBER_REFERENCE_PARAM}=${encodeURIComponent(memberReference)}`
    : INVITATIONS_PATH;
}

// The one a captain copies and sends. It starts at the onboarding page rather
// than at the invitations tab because the person who needs it is usually the
// person with no Quest account yet, and the tab would only bounce them to a
// login screen they were given no explanation for.
export function onboardingPath(memberReference?: string | null): string {
  return memberReference
    ? `${ONBOARDING_PATH}?${MEMBER_REFERENCE_PARAM}=${encodeURIComponent(memberReference)}`
    : ONBOARDING_PATH;
}

export function onboardingUrl(origin: string, memberReference?: string | null): string {
  return `${origin}${onboardingPath(memberReference)}`;
}
