import { Suspense } from "react";
import PageLayout from "@/components/PageLayout";
import ValorantRegistration from "@/components/valorant/ValorantRegistration";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Valorant Leaderboard Registration",
  description:
    "Connect your Discord account and add your Valorant profile to Quest E-sports Sri Lanka's player leaderboard.",
  path: "/valorant-leaderboard/register",
});

export default function ValorantLeaderboardRegisterPage() {
  return (
    <PageLayout
      title="Valorant Leaderboard Registration"
      description={defaultPageDescriptions.valorantLeaderboard}
    >
      <Suspense fallback={null}>
        <ValorantRegistration />
      </Suspense>
    </PageLayout>
  );
}
