import PostersContent from "@/components/Posters/PostersContent";
import PageHeader from "@/components/PageHeader";

export default function PostersPage() {
  return (
    <>
      {/* Reuse the shared page header component for consistent inner-page branding. */}
      <PageHeader
        title="Posters"
        description="Tournament posters, highlights, and community event visuals"
      />
      <PostersContent />
    </>
  );
}
