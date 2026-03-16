import PageHeader from "@/components/PageHeader";
import RulebookContent from "@/components/rulebook/RulebookContent";

export default function RulebookPage() {
  return (
    <>
      {/* The dedicated rulebook page combines a shared heading with the long-form policy content. */}
      <PageHeader
        title="Quest Esports Rulebook"
        description="Official VALORANT Tournament Rules"
      />
      <RulebookContent />
    </>
  );
}
