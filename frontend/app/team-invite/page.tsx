import { Suspense } from "react";
import PageLayout from "@/components/PageLayout";
import TeamInviteContent from "@/components/auth/TeamInviteContent";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Team Invite",
  "Review and respond to your Quest E-sports team invitation.",
  "/team-invite"
);

export default function TeamInvitePage() {
  return (
    <PageLayout
      title="Team Invite"
      description="Accept or decline your Quest E-sports team invitation."
      showEyebrow={false}
    >
      <Suspense fallback={null}>
        <TeamInviteContent />
      </Suspense>
    </PageLayout>
  );
}
