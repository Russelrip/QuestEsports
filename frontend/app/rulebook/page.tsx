import PageLayout from "@/components/PageLayout";
import RulebookContent from "@/components/rulebook/RulebookContent";
import { defaultPageDescriptions } from "@/lib/site";

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
