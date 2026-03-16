import PageHeader from "@/components/PageHeader";
import TournamentsContent from "@/components/tournaments/TournamentsContent";

export default function TournamentsPage() {
  return (
    <>
      <PageHeader
        title="Tournaments"
        description="Explore Quest Esports events and upcoming competitions"
      />
      <TournamentsContent />
    </>
  );
}
