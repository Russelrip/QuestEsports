import PageHeader from "@/components/PageHeader";
import RulebookContent from "@/components/rulebook/RulebookContent";

export default function RulebookPage() {
  return (
    <>
      <PageHeader
        title="Quest Esports Rulebook"
        description="Official VALORANT Tournament Rules"
      />
      <RulebookContent />
    </>
  );
}
