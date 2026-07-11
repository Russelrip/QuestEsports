import MembersContent from "@/components/members/MembersContent";
import JoinQuestSection from "@/components/home/JoinQuestSection";
import PageLayout from "@/components/PageLayout";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Members",
  description: defaultPageDescriptions.members,
  path: "/members",
  keywords: [
    "Quest E-sports team",
    "Quest E-sports members",
    "Sri Lanka e-sports organizers",
  ],
});

export default function MembersPage() {
  return (
    <PageLayout
      title="Meet the Members"
      description=""
      showEyebrow={false}
    >
      <MembersContent />
      <JoinQuestSection />
    </PageLayout>
  );
}
