import MatchVideosContent from "@/components/match-videos/MatchVideosContent";
import PageHeader from "@/components/PageHeader";

export default function MatchVideosPage() {
  return (
    <>
      <PageHeader
        title="Match Videos"
        description="Watch official Quest Esports tournament uploads and live matches"
      />
      <MatchVideosContent />
    </>
  );
}
