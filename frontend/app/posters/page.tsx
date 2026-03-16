import PageLayout from "@/components/PageLayout";
import PostersContent from "@/components/Posters/PostersContent";
import { defaultPageDescriptions } from "@/lib/site";

export default function PostersPage() {
  return (
    <PageLayout title="Posters" description={defaultPageDescriptions.posters}>
      <PostersContent />
    </PageLayout>
  );
}
