import MatchVideosContent from "@/components/match-videos/MatchVideosContent";
import PageLayout from "@/components/PageLayout";
import { defaultPageDescriptions } from "@/lib/site";

export default function MatchVideosPage() {
  return (
    <PageLayout
      title="Match Videos"
      description={defaultPageDescriptions.matchVideos}
    >
      <MatchVideosContent />
    </PageLayout>
  );
}
