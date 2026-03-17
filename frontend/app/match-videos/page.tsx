import MatchVideosContent from "@/components/match-videos/MatchVideosContent";
import PageLayout from "@/components/PageLayout";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Match Videos",
  description: defaultPageDescriptions.matchVideos,
  path: "/match-videos",
  keywords: [
    "YouTube esports videos",
    "tournament highlights",
    "match replays",
    "live stream archives",
  ],
});

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
