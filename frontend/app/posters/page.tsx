import PageLayout from "@/components/PageLayout";
import PostersContent from "@/components/Posters/PostersContent";
import { fetchPublicPosters, type Poster } from "@/lib/media";
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

export default async function PostersPage() {
  let initialPosters: Poster[] = [];

  try {
    const postersData = await fetchPublicPosters();
    initialPosters = postersData.posters;
  } catch {
    initialPosters = [];
  }

  return (
    <PageLayout title="Posters" description={defaultPageDescriptions.posters}>
      <PostersContent initialPosters={initialPosters} />
    </PageLayout>
  );
}
