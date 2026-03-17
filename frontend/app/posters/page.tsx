import PageLayout from "@/components/PageLayout";
import PostersContent from "@/components/Posters/PostersContent";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Posters",
  description: defaultPageDescriptions.posters,
  path: "/posters",
  keywords: [
    "Instagram esports posters",
    "TikTok promo visuals",
    "gaming event creatives",
    "shareable tournament graphics",
  ],
});

export default function PostersPage() {
  return (
    <PageLayout title="Posters" description={defaultPageDescriptions.posters}>
      <PostersContent />
    </PageLayout>
  );
}
