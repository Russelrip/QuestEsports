import PageLayout from "@/components/PageLayout";
import RulebookContent from "@/components/rulebook/RulebookContent";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Quest Esports Rulebook",
  description: defaultPageDescriptions.rulebook,
  path: "/rulebook",
  keywords: [
    "VALORANT rules",
    "tournament rulebook",
    "esports policy",
    "competitive gaming guidelines",
  ],
});

export default function RulebookPage() {
  return (
    <PageLayout
      title="Quest Esports Rulebook"
      description={defaultPageDescriptions.rulebook}
    >
      <RulebookContent />
    </PageLayout>
  );
}
