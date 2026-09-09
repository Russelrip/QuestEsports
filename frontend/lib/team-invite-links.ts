// Where an invitation is found.
//
// There is no per-member link. There was: a captain copied a URL carrying a
// reference to one roster row, and the invitations page used it to focus that
// invitation. It never granted anything — the invitations were selected by
// identity either way — but it could still be wrong, and wrong in the worst
// direction. The reference names a row, and the row is replaced whenever a
// captain corrects an email or re-adds somebody, so an older link resolved to
// nothing and the page told the reader the invitation was not for their
// account: accusatory, plausible, and sometimes sitting directly above the
// invitation they had come to accept.
//
// What replaced it is what was underneath all along. Sign in, and the
// invitations addressed to you are listed. Nothing to resolve means nothing to
// resolve wrongly.

export const INVITATIONS_PATH = "/profile?tab=invitations";
export const ONBOARDING_PATH = "/team-invite";

// The link a captain copies for somebody who cannot be reached any other way.
// It starts at onboarding rather than the invitations tab because the person
// who needs it usually has no Quest account yet, and the tab would only bounce
// them to a login they were given no explanation for.
export function onboardingUrl(origin: string): string {
  return `${origin}${ONBOARDING_PATH}`;
}
