import PageLayout from "@/components/PageLayout";
import RecruitmentForm from "@/components/recruitment/RecruitmentForm";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Join Quest",
  description: defaultPageDescriptions.join,
  path: "/join",
  keywords: [
    "join Quest E-sports",
    "e-sports recruitment Sri Lanka",
    "find Valorant teammates Sri Lanka",
  ],
});

export default function JoinPage() {
  return (
    <PageLayout
      title="Join Quest"
      description={defaultPageDescriptions.join}
      eyebrow="Recruitment Now Open"
    >
      <RecruitmentForm />
    </PageLayout>
  );
}
