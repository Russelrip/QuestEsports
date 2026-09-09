import { Suspense } from "react";
import PageLayout from "@/components/PageLayout";
import TeamInviteOnboarding from "@/components/auth/TeamInviteOnboarding";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Team Invitation",
  defaultPageDescriptions.teamInvite,
  "/team-invite"
);

// The link a captain sends when nothing else reached somebody.
//
// It used to be an emailed token, and then, once invitations stopped being
// answered by tokens, a bare redirect to the invitations tab — which sent
// anyone who did not already have a Quest account to a login screen with no
// explanation of what they were being asked to log in to.
//
// This page is that explanation, and it is all it is: generic onboarding text
// and two buttons. It resolves nothing anonymously, names no team, no captain
// and no address, and the member reference it carries through is a routing
// hint, not a credential. Whoever ends up here still has to sign in as the
// person the invitation was addressed to before there is anything to see.
export default function TeamInvitePage() {
  return (
    <PageLayout
      title="Team Invitation"
      description={defaultPageDescriptions.teamInvite}
      showEyebrow={false}
    >
      <Suspense fallback={null}>
        <TeamInviteOnboarding />
      </Suspense>
    </PageLayout>
  );
}
